package chatgateway

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/tokenbilling"
)

func TestAccumulatedBillingUsesActualScreenshotFeesAcrossCallsAndReplay(t *testing.T) {
	usages := [][3]int{{8993, 555, 8704}, {8903, 59, 8576}, {8742, 188, 8576}, {6664, 31, 0}, {8709, 20, 0}}
	fees := []int64{224470, 76930, 107580, 342500, 441450}
	var calls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		i := int(calls.Add(1)) - 1
		if i >= len(usages) {
			t.Error("unexpected repeated upstream call")
			w.WriteHeader(500)
			return
		}
		u := usages[i]
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":%d,\"completion_tokens\":%d,\"total_tokens\":%d,\"prompt_tokens_details\":{\"cached_tokens\":%d}}}\n\ndata: [DONE]\n\n", u[0], u[1], u[0]+u[1], u[2])
	}))
	defer up.Close()
	f := setup(t, up.URL)
	repriceTestModel(t, f, `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"50","outputPointsPerMillion":"300","cachedInputPointsPerMillion":"5","maxInputTokens":131072,"maxOutputTokens":8192}}`)
	var total int64
	for i, fee := range fees {
		headers := map[string]string{"Idempotency-Key": fmt.Sprintf("actual-fee-%d", i)}
		for replay := 0; replay < 2; replay++ {
			w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers)
			if w.Code != 200 {
				t.Fatal(w.Body.String())
			}
		}
		total += fee
		var user model.User
		if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
			t.Fatal(err)
		}
		if user.Points != 20-total/tokenbilling.Scale || user.ChatPendingMicros != total%tokenbilling.Scale || user.PointHeldMicros != 0 {
			t.Fatalf("call %d: posted=%d pending=%d held=%d", i, user.Points, user.ChatPendingMicros, user.PointHeldMicros)
		}
	}
	if calls.Load() != 5 {
		t.Fatal("replays reached the upstream")
	}
	var records []model.PointRecord
	f.s.d.DB.Find(&records)
	if len(records) != 1 || records[0].ExactAmount() != -1 {
		t.Fatalf("five calls should post only one point: %+v", records)
	}
	d := usageData(t, f, "/api/chat-gateway/usage", f.jwt)
	summary := d["summary"].(map[string]any)
	if summary["points"] != "1.192930" || summary["deductedPoints"] != "1" || summary["pendingTokenPoints"] != "0.192930" {
		t.Fatalf("summary=%v", summary)
	}
}

func TestAccruedRemainderRollsBackAndRecoversOnceAfterStorageFailure(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, okWithUsage) }))
	defer up.Close()
	f := setup(t, up.URL)
	const callback = "fail-chat-pending-write"
	if err := f.s.d.DB.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			if fields, ok := tx.Statement.Dest.(map[string]any); ok {
				if _, changing := fields["chat_pending_micros"]; changing {
					tx.AddError(errors.New("temporary accumulator failure"))
				}
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"Idempotency-Key": "recover-fraction"}
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers)
	if w.Code != 502 || !strings.Contains(w.Body.String(), "settlement_pending") {
		t.Fatal(w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 || user.ChatPendingMicros != 0 || user.PointHeldMicros != 1000000 {
		t.Fatal("partial fractional settlement survived rollback")
	}
	if err := f.s.d.DB.Callback().Update().Remove(callback); err != nil {
		t.Fatal(err)
	}
	var bill model.ModelGatewayRequest
	f.s.d.DB.First(&bill)
	if err := f.s.d.DB.Model(&bill).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := f.s.reconcilePage(context.Background(), 0); err != nil {
			t.Fatal(err)
		}
	}
	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	var count int64
	f.s.d.DB.Model(&model.PointRecord{}).Count(&count)
	if user.Points != 20 || user.ChatPendingMicros != 40000 || user.PointHeldMicros != 0 || count != 0 {
		t.Fatal("recovery did not accrue exactly once")
	}
}

func TestManualAccumulatedSettlementAndReleaseRespectExistingRemainder(t *testing.T) {
	for _, action := range []string{"settle", "release"} {
		t.Run(action, func(t *testing.T) {
			f := setup(t, "")
			if err := f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("chat_pending_micros", 950000).Error; err != nil {
				t.Fatal(err)
			}
			access, row := pendingBill(t, f, 400000)
			if err := f.s.d.DB.Model(row).Update("settlement_mode", model.ChatSettlementAccumulated).Error; err != nil {
				t.Fatal(err)
			}
			body := fmt.Sprintf(`{"action":%q,"inputTokens":100,"outputTokens":200,"cachedInputTokens":20,"reason":"verified upstream usage"}`, action)
			path := "/api/admin/chat-gateway-billing/" + row.ID.String() + "/resolve"
			if w := f.request("POST", path, body, access, nil); w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			if w := f.request("POST", path, body, access, nil); w.Code != 409 {
				t.Fatal("repeated resolution was not blocked")
			}
			var user model.User
			f.s.d.DB.First(&user, "id = ?", f.user.ID)
			var bill model.ModelGatewayRequest
			f.s.d.DB.First(&bill, "id = ?", row.ID)
			if user.PointHeldMicros != 0 {
				t.Fatal("manual resolution stranded a hold")
			}
			if action == "settle" {
				if bill.CostMicros != 68400 || bill.WalletDebitMicros != 1000000 || bill.PendingAfterMicros != 18400 || user.Points != 19 || user.ChatPendingMicros != 18400 {
					t.Fatalf("wrong accumulated settlement: fee=%d debit=%d pending=%d", bill.CostMicros, bill.WalletDebitMicros, user.ChatPendingMicros)
				}
			} else if bill.CostMicros != 0 || bill.WalletDebitMicros != 0 || user.Points != 20 || user.ChatPendingMicros != 950000 {
				t.Fatal("releasing a new hold changed previously accrued fees")
			}
		})
	}
}
