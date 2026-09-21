package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
)

// Deliberately use the SAME upstream model key in both catalogues. A Skill
// step must still use market_model's flat price and the generation relay,
// never the resale provider's token price, credential or reservation ledger.
func TestSkillTextAndAssistantBillingStayIsolatedFromChatProviders(t *testing.T) {
	for _, mode := range []string{"assistant", "site-skill", "mcp-skill"} {
		t.Run(mode, func(t *testing.T) {
			db := concurrencyTestDB(t)
			pool, _ := db.DB()
			pool.SetMaxOpenConns(1)
			defer pool.Close()
			if err := db.AutoMigrate(&model.MarketModel{}, &model.ChatModel{}, &model.ChatProvider{}, &model.ChatEndpoint{}, &model.ModelGatewayRequest{}, &model.AiGenerationLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.SkillRun{}, &model.SkillRunStep{}); err != nil {
				t.Fatal(err)
			}
			var relayCalls, resaleCalls atomic.Int32
			resale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { resaleCalls.Add(1); w.WriteHeader(500) }))
			defer resale.Close()
			relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				relayCalls.Add(1)
				if r.Header.Get("Authorization") != "Bearer generation-relay-key" {
					t.Error("wrong generation credential")
				}
				var input map[string]any
				_ = json.NewDecoder(r.Body).Decode(&input)
				if input["model"] != "same-model" {
					t.Error("wrong generation model")
				}
				// Expensive-looking usage must not change a flat-priced step.
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"result\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":1000000,\"completion_tokens\":1000000}}\n\ndata: [DONE]\n\n")
			}))
			defer relay.Close()
			user := model.User{ID: idgen.Next(), Username: "owner", Email: "owner@test", Status: 1, Points: 20}
			market := model.MarketModel{ModelKey: "same-model", Name: "站内文本", Type: "text", Status: 1, Price: decimal.NewFromInt(7), Config: `{"supportedHandlers":["assistant_chat","skill_text_completion"]}`}
			provider := model.ChatProvider{Name: "独立中转", Enabled: true, PriceMultiplier: "99"}
			for _, value := range []any{&user, &market, &provider} {
				if err := db.Create(value).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Create(&model.ChatModel{ProviderID: provider.ID, ModelKey: "same-model", Enabled: true, Pricing: `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"999999","outputPointsPerMillion":"999999"}}`}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.ChatEndpoint{ProviderID: provider.ID, BaseURL: resale.URL, Enabled: true, APIKey: "unusable-secret"}).Error; err != nil {
				t.Fatal(err)
			}
			svc := &service{repo: newRepo(db), registry: newHandlerRegistry(), relay: relaychat.New(relay.URL, "generation-relay-key"), sem: make(chan struct{}, 1)}
			facade := &GenerationFacade{svc: svc}
			cmd := GenerationCommand{Handler: assistantChatHandler, ModelID: "same-model", Input: map[string]any{"prompt": "public input", "batchCount": 4}, RegisterWork: false}
			var run model.SkillRun
			if mode != "assistant" {
				run = model.SkillRun{UserID: user.ID, EntryPoint: map[bool]string{true: "mcp", false: "studio"}[mode == "mcp-skill"], Status: model.SkillRunRunning, Revision: 1, WorkerID: "worker", Input: `{"prompt":"public input"}`}
				if err := db.Create(&run).Error; err != nil {
					t.Fatal(err)
				}
				step := model.SkillRunStep{RunID: run.ID, StepKey: "text", Status: model.SkillStepRunning}
				if err := db.Create(&step).Error; err != nil {
					t.Fatal(err)
				}
				cmd.Handler = skillTextCompletionHandler
				cmd.Origin = "skill_run"
				cmd.SkillRunID = run.ID
				cmd.SkillRunStepID = step.ID
				cmd.SkillRunRevision = 1
				cmd.SkillRunWorkerID = "worker"
				cmd.OutputRole = "intermediate"
				cmd.IsAPICall = mode == "mcp-skill"
				cmd.PublicInput = json.RawMessage(`{"prompt":"public input"}`)
				cmd.Input["prompt"] = "private workflow instructions"
			}
			id, err := facade.Submit(context.Background(), user.ID, cmd)
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, active := svc.taskCancels.Load(id); !active {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("generation worker stuck")
				}
				time.Sleep(5 * time.Millisecond)
			}
			if mode != "assistant" {
				replayed, err := facade.Submit(context.Background(), user.ID, cmd)
				if err != nil || replayed != id {
					t.Fatalf("step replay: %s %v", replayed, err)
				}
			}
			var task model.AiTask
			if err := db.First(&task, "id = ?", id).Error; err != nil {
				t.Fatal(err)
			}
			if task.Status != statusSuccess || task.PointCost != 7 {
				t.Fatalf("wrong flat-priced result: %+v", task)
			}
			if err := db.First(&user, "id = ?", user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if user.PointBalance() != 13 || user.PointHeldMicros != 0 {
				t.Fatalf("wrong balance: %+v", user)
			}
			var count int64
			db.Model(&model.ModelGatewayRequest{}).Count(&count)
			if count != 0 || resaleCalls.Load() != 0 || relayCalls.Load() != 1 {
				t.Fatalf("billing/routing crossed: bills=%d resale=%d relay=%d", count, resaleCalls.Load(), relayCalls.Load())
			}
			var ledger []model.PointRecord
			db.Where("user_id = ?", user.ID).Find(&ledger)
			if len(ledger) != 1 || ledger[0].Amount != -7 || ledger[0].RefID == nil || *ledger[0].RefID != id {
				t.Fatalf("wrong ledger: %+v", ledger)
			}
			history, total, err := svc.listUserHistory(context.Background(), user.ID, userHistoryQuery{}, 0, 20)
			if err != nil || total != 1 || *history[0].PointCost != 7 || strings.Contains(history[0].Prompt, "private") {
				t.Fatalf("wrong public history: %+v %v", history, err)
			}
			if mode != "assistant" {
				if err := db.Model(&run).Update("status", model.SkillRunFailed).Error; err != nil {
					t.Fatal(err)
				}
				for i := 0; i < 2; i++ {
					if err := facade.RefundFailedSkillRun(context.Background(), run.ID); err != nil {
						t.Fatal(err)
					}
				}
				if err := db.First(&user, "id = ?", user.ID).Error; err != nil {
					t.Fatal(err)
				}
				history, _, err = svc.listUserHistory(context.Background(), user.ID, userHistoryQuery{}, 0, 20)
				if err != nil || user.PointBalance() != 20 || history[0].RefundedPoints != 7 {
					t.Fatalf("refund mismatch: balance=%v history=%+v err=%v", user.PointBalance(), history, err)
				}
			}
		})
	}
}
