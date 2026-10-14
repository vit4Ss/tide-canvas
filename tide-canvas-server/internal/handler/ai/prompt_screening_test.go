package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"tidecanvas/internal/model"
)

func TestPromptScreeningTextAliasesAndLimits(t *testing.T) {
	text, err := generationPromptText(json.RawMessage(`{"prompt":"hello","input":"hello","imageUrl":"https://private.test/image","extras":{"lyrics":"words","negative_tags":"noise"},"instructions":"whisper"}`))
	if err != nil || strings.Count(text, "hello") != 1 || !strings.Contains(text, "words") || !strings.Contains(text, "whisper") || strings.Contains(text, "private.test") {
		t.Fatalf("text collection failed: %v", err)
	}
	for _, prompt := range []string{strings.Repeat("x", 10001), strings.Repeat("😀", 5001)} {
		raw, _ := json.Marshal(map[string]string{"prompt": prompt})
		if _, err := generationPromptText(raw); err == nil {
			t.Fatal("oversize prompt truncated or accepted")
		}
	}
	text, err = generationPromptText(json.RawMessage(`{"videoUrl":"https://example.test/source.mp4"}`))
	if err != nil || text != "" {
		t.Fatal("media URL sent for text screening")
	}
}

func TestPromptScreeningFailsClosedOnMalformedAndUnavailableResponses(t *testing.T) {
	for _, body := range []string{`{}`, `{"action":"allow","reasonCode":"service_degraded","requestId":"REQ_1"}`, `{"action":"allow","reasonCode":"allowed","requestId":"REQ_1"} {}`, `{"action":"unknown","reasonCode":"allowed","requestId":"REQ_1"}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
		p := &promptScreeningClient{url: server.URL, token: "test", mode: "test", http: server.Client()}
		if p.scan(context.Background(), "safe").Action == "allow" {
			t.Fatal("accepted malformed verdict")
		}
		server.Close()
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(429) }))
	defer server.Close()
	p := &promptScreeningClient{url: server.URL, http: server.Client()}
	if p.scan(context.Background(), "safe").Action != "unavailable" {
		t.Fatal("rate limit allowed generation")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if p.scan(ctx, "safe").Action != "unavailable" {
		t.Fatal("canceled request allowed generation")
	}
}

func TestPromptScreeningRunsBeforeTaskAndDebitAndRetainsAudit(t *testing.T) {
	db := concurrencyTestDB(t)
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.MarketModel{}, &model.AiTool{}, &model.PointRecord{}, &model.PromptSafetyCheck{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: 42, Username: "screening", Points: 100, Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	m := model.MarketModel{Name: "Image", ModelKey: "screened-image", Type: "image", Status: 1, Price: decimal.NewFromInt(7)}
	if err := db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	var action atomic.Value
	action.Store("block")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer private-internal-token" {
			t.Error("missing adapter authentication")
		}
		var input map[string]string
		_ = json.NewDecoder(r.Body).Decode(&input)
		if input["mode"] != "test" || input["prompt"] != "user description" {
			t.Error("wrong screening payload")
		}
		a := action.Load().(string)
		reason := "restricted_content"
		if a == "review" {
			reason = "review_required"
		}
		if a == "allow" {
			reason = "allowed"
		}
		_ = json.NewEncoder(w).Encode(promptVerdict{Action: a, Reason: reason, RequestID: "REQ_safe"})
	}))
	defer server.Close()
	s := &service{repo: newRepo(db), registry: newHandlerRegistry(), promptScreening: &promptScreeningClient{url: server.URL, token: "private-internal-token", mode: "test", http: server.Client()}}
	dto := generateDTO{Handler: "text_to_image", ModelID: "screened-image", Input: json.RawMessage(`{"prompt":"user description"}`)}
	for _, a := range []string{"block", "review", "unexpected"} {
		action.Store(a)
		if _, err := s.generate(context.Background(), 42, dto); err == nil || !strings.Contains(err.Error(), "No generation") && !strings.Contains(err.Error(), "no generation") {
			t.Fatalf("expected safe rejection, got %v", err)
		}
		var user model.User
		db.First(&user, 42)
		var tasks, charges int64
		db.Model(&model.AiTask{}).Count(&tasks)
		db.Model(&model.PointRecord{}).Count(&charges)
		if user.Points != 100 || tasks != 0 || charges != 0 {
			t.Fatal("screening rejection created task or charged credits")
		}
	}
	var checks []model.PromptSafetyCheck
	if err := db.Find(&checks).Error; err != nil || len(checks) != 3 {
		t.Fatalf("missing decision receipts: %v", err)
	}
	for _, c := range checks {
		if len(c.PromptHash) != 64 || strings.Contains(c.Reason, "description") || c.CreateTime.Before(time.Now().Add(-time.Minute)) {
			t.Fatal("invalid audit receipt")
		}
	}
	resolved, err := s.repo.findModel(context.Background(), "screened-image")
	if err != nil {
		t.Fatal(err)
	}
	action.Store("allow")
	if err := s.screenGenerationPrompt(context.Background(), 42, dto, resolved); err != nil {
		t.Fatal(err)
	}
	// An audit write failure also prevents generation even after an allow verdict.
	if err := db.Migrator().DropTable(&model.PromptSafetyCheck{}); err != nil {
		t.Fatal(err)
	}
	if err := s.screenGenerationPrompt(context.Background(), 42, dto, resolved); err == nil {
		t.Fatal("audit failure allowed generation")
	}
	// Disabling the feature preserves the existing installation's behavior.
	s.promptScreening = nil
	if err := s.screenGenerationPrompt(context.Background(), 42, dto, resolved); err != nil {
		t.Fatal(err)
	}
}

func TestPromptScreeningFreezesExpandedSkillAndPresetInstructions(t *testing.T) {
	db := concurrencyTestDB(t)
	if err := db.AutoMigrate(&model.PromptSafetyCheck{}); err != nil {
		t.Fatal(err)
	}
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]string
		_ = json.NewDecoder(r.Body).Decode(&input)
		received = input["prompt"]
		_ = json.NewEncoder(w).Encode(promptVerdict{Action: "allow", Reason: "allowed", RequestID: "REQ_frozen"})
	}))
	defer server.Close()
	s := &service{repo: newRepo(db), promptScreening: &promptScreeningClient{url: server.URL, token: "test", http: server.Client()}}
	m := &model.AiModel{Type: "image"}
	dto := generateDTO{Input: json.RawMessage(`{"prompt":"user idea"}`), PinnedSkillPrompt: "Template instruction"}
	if err := s.prepareScreenedGenerationPrompt(context.Background(), 42, &dto, m, genHandler{name: "text_to_image"}, nil); err != nil {
		t.Fatal(err)
	}
	if received != "Template instruction\n\nuser idea" {
		t.Fatal("skill template bypassed screening")
	}
	dto.PinnedSkillPrompt = "Later template change"
	if prompt := decodeInput(dto.screenedInput)["prompt"]; prompt != "Template instruction\n\nuser idea" {
		t.Fatal("screened snapshot changed")
	}
	if decodeInput(dto.Input)["prompt"] != "user idea" {
		t.Fatal("private template leaked into original task input")
	}
	preset := presetEditHandler{name: "remove_bg", prompt: "Builtin instruction"}
	tool := &model.AiTool{PresetPrompt: "Configured edit", ExtraParams: `{"instructions":"Additional instructions"}`}
	if err := s.prepareScreenedGenerationPrompt(context.Background(), 42, &dto, m, preset, tool); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(received, "Configured edit") || !strings.Contains(received, "Additional instructions") || strings.Contains(received, "Builtin instruction") {
		t.Fatal("preset override not screened")
	}
}
