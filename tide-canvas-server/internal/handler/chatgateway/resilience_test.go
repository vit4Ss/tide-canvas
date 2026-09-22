package chatgateway

import (
	"context"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestRecoveryAdvancesPastUnrecoverableAccountsAndRefundsOnlyOnce(t *testing.T) {
	f := setup(t, "")
	for i := 0; i < 100; i++ {
		row := model.ModelGatewayRequest{UserID: idgen.ID(int64(f.user.ID) + 100), RequestKey: fmt.Sprintf("orphan-%d", i), Status: "pending", Cost: 1, ExpiresAt: time.Now().Add(-time.Minute)}
		if err := f.s.d.DB.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	route, err := f.s.routeFor(context.Background(), "test-model")
	if err != nil {
		t.Fatal(err)
	}
	valid, _, err := f.s.reserve(context.Background(), f.user.ID, "recover-valid", "body", route)
	if err != nil {
		t.Fatal(err)
	}
	f.s.d.DB.Model(valid).Update("expires_at", time.Now().Add(-time.Minute))
	cursor, err := f.s.reconcilePage(context.Background(), 0)
	if err != nil || cursor == 0 {
		t.Fatalf("first page failed to advance: %d %v", cursor, err)
	}
	if cursor, err = f.s.reconcilePage(context.Background(), cursor); err != nil || cursor != 0 {
		t.Fatalf("recovery did not complete the sweep: %d %v", cursor, err)
	}
	// Re-scanning the bad rows must neither re-credit nor hide the good refund.
	cursor, _ = f.s.reconcilePage(context.Background(), 0)
	_, _ = f.s.reconcilePage(context.Background(), cursor)
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	var pending int64
	f.s.d.DB.Model(&model.ModelGatewayRequest{}).Where("status = ?", "pending").Count(&pending)
	var recovered model.ModelGatewayRequest
	f.s.d.DB.First(&recovered, "id = ?", valid.ID)
	// An interrupted worker leaves a reservation, not a charge, so recovery
	// releases the hold and the balance is whole again.
	if user.Points != 20 || user.PointHeldMicros != 0 || pending != 100 {
		t.Fatalf("recovery balance=%d held=%d pending=%d", user.Points, user.PointHeldMicros, pending)
	}
	if recovered.Status == "pending" {
		t.Fatal("the expired reservation was left pending")
	}
}

func TestUpstreamErrorReleasesReservationWithoutWaitingForDisconnect(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"error\":{\"message\":\"failed\"}}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer up.Close()
	f := setup(t, up.URL)
	started := time.Now()
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if time.Since(started) > time.Second {
		t.Error("explicit upstream error kept the reservation until the connection closed")
	}
	if w.Code != 502 {
		t.Fatalf("expected generation error, got %d", w.Code)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	var active int64
	f.s.d.DB.Model(&model.ModelGatewayRequest{}).Where("status = ?", "pending").Count(&active)
	if user.Points != 20 || active != 0 {
		t.Fatal("failed generation retained points or a concurrency slot")
	}
}

func TestMalformedUpstreamFrameDoesNotLeakToClientOrBecomeSuccess(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"visible\"}}]}\n\ndata: malformed-upstream-payload\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
	body := strings.TrimSuffix(testPrompt, "}") + `,"stream":true}`
	w := f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, nil)
	if strings.Contains(w.Body.String(), "malformed-upstream-payload") {
		t.Error("invalid upstream bytes forwarded into the client's SSE parser")
	}
	if !strings.Contains(w.Body.String(), `"error"`) || !strings.Contains(w.Body.String(), "visible") {
		t.Error("corrupt stream treated as success or valid content lost")
	}
}

func TestRecoveryRetainsProviderUsageWhenWalletWriteTemporarilyFails(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, okWithUsage) }))
	defer up.Close()
	f := setup(t, up.URL)
	const callback = "usage-settlement-ledger-unavailable"
	if err := f.s.d.DB.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "point_record" {
			tx.AddError(errors.New("temporary ledger failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"Idempotency-Key": "recover-actual-usage"}
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers)
	if w.Code != 502 || !strings.Contains(w.Body.String(), "settlement_pending") {
		t.Fatal(w.Body.String())
	}
	var row model.ModelGatewayRequest
	if err := f.s.d.DB.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "pending" || !strings.Contains(row.ResponseBody, "prompt_tokens") {
		t.Fatalf("provider usage lost on failed settlement: status=%s body=%s", row.Status, row.ResponseBody)
	}
	if err := f.s.d.DB.Callback().Create().Remove(callback); err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Model(&row).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := f.s.reconcilePage(context.Background(), 0); err != nil {
			t.Fatal(err)
		}
	}
	var user model.User
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.First(&row, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "success" || row.CostMicros != 1_000_000 || !row.UsageKnown || user.Points != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("recovery did not settle actual usage: status=%s cost=%d points=%d held=%d", row.Status, row.CostMicros, user.Points, user.PointHeldMicros)
	}
	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var count int64
	if err := f.s.d.DB.Model(&model.PointRecord{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("recovery/replay wrote %d debits", count)
	}
}

func TestRecoveryOfCheckpointedResultsDoesNotGuessMissingUsage(t *testing.T) {
	for _, tc := range []struct {
		name, frames, code, status string
		points, held               int64
	}{
		{"partial charged", strings.ReplaceAll(okWithUsage, `"stop"`, `"length"`), "incomplete_response", "partial", 19, 0},
		{"visible without usage", "data: {\"choices\":[{\"delta\":{\"content\":\"visible\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", "", "billing_pending", 20, 1_000_000},
		{"error without output", "data: {\"error\":{\"message\":\"unavailable\"}}\n\n", "upstream_error", "failed", 20, 0},
		{"checkpointed failure without frames", "", "upstream_error", "failed", 20, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t, "")
			route, err := f.s.routeFor(context.Background(), "test-model")
			if err != nil {
				t.Fatal(err)
			}
			row, _, err := f.s.reserve(context.Background(), f.user.ID, "checkpoint", "body", route)
			if err != nil {
				t.Fatal(err)
			}
			if err := f.s.checkpointTokenOutcome(row, tc.frames, tc.code); err != nil {
				t.Fatal(err)
			}
			if err := f.s.d.DB.Model(row).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				if _, err := f.s.reconcilePage(context.Background(), 0); err != nil {
					t.Fatal(err)
				}
			}
			var bill model.ModelGatewayRequest
			var user model.User
			if err := f.s.d.DB.First(&bill, "id = ?", row.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if bill.Status != tc.status || user.Points != tc.points || user.PointHeldMicros != tc.held {
				t.Fatalf("state=%s points=%d held=%d", bill.Status, user.Points, user.PointHeldMicros)
			}
			// An old worker must not replace the finalized result or clear a
			// manually pending-review bill with another checkpoint.
			if err := f.s.checkpointTokenOutcome(row, "data: unexpected\n\n", "worker_interrupted"); err != nil {
				t.Fatal(err)
			}
			var unchanged model.ModelGatewayRequest
			if err := f.s.d.DB.First(&unchanged, "id = ?", row.ID).Error; err != nil {
				t.Fatal(err)
			}
			if bill.ResponseBody != unchanged.ResponseBody || bill.ErrorCode != unchanged.ErrorCode || bill.CostMicros != unchanged.CostMicros {
				t.Fatal("stale checkpoint overwrote terminal result")
			}
		})
	}
}

func TestRecoveryOfDispatchedCallWithoutOutcomeKeepsHoldForReview(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		name := "dispatched"
		if legacy {
			name = "legacy unknown dispatch"
		}
		t.Run(name, func(t *testing.T) { testRecoveryWithoutOutcome(t, legacy) })
	}
}

func testRecoveryWithoutOutcome(t *testing.T, legacy bool) {
	t.Helper()
	f := setup(t, "")
	route, err := f.s.routeFor(context.Background(), "test-model")
	if err != nil {
		t.Fatal(err)
	}
	row, _, err := f.s.reserve(context.Background(), f.user.ID, "started-without-outcome", "body", route)
	if err != nil {
		t.Fatal(err)
	}
	if legacy {
		if err := f.s.d.DB.Model(row).Update("upstream_state", "").Error; err != nil {
			t.Fatal(err)
		}
	} else {
		if err := f.s.markTokenCallStarted(row); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.s.d.DB.Model(row).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := f.s.reconcilePage(context.Background(), 0); err != nil {
			t.Fatal(err)
		}
	}
	var bill model.ModelGatewayRequest
	var user model.User
	if err := f.s.d.DB.First(&bill, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if bill.Status != "billing_pending" || user.PointHeldMicros != 1_000_000 || user.PointBalance() != 19 {
		t.Fatalf("dispatched call was released as free: status=%s held=%d balance=%v", bill.Status, user.PointHeldMicros, user.PointBalance())
	}
}
