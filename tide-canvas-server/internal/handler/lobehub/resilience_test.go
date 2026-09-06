package lobehub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestRecoveryAdvancesPastUnrecoverableAccountsAndRefundsOnlyOnce(t *testing.T) {
	f := setup(t, "", "")
	for i := 0; i < 100; i++ {
		row := model.ModelGatewayRequest{UserID: idgen.ID(int64(f.user.ID) + 100), RequestKey: fmt.Sprintf("orphan-%d", i), Status: "pending", Cost: 1, ExpiresAt: time.Now().Add(-time.Minute)}
		if err := f.s.d.DB.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var selected model.MarketModel
	f.s.d.DB.First(&selected)
	valid, _, err := f.s.reserve(context.Background(), f.user.ID, "recover-valid", "body", selected)
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
	var refunds int64
	f.s.d.DB.Model(&model.PointRecord{}).Where("ref_id = ? AND change_type = ?", valid.ID, "refund").Count(&refunds)
	var pending int64
	f.s.d.DB.Model(&model.ModelGatewayRequest{}).Where("status = ?", "pending").Count(&pending)
	if user.Points != 20 || refunds != 1 || pending != 100 {
		t.Fatalf("recovery balance=%d refunds=%d pending=%d", user.Points, refunds, pending)
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
	f := setup(t, "", up.URL)
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
	f := setup(t, "", up.URL)
	body := strings.TrimSuffix(testPrompt, "}") + `,"stream":true}`
	w := f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, nil)
	if strings.Contains(w.Body.String(), "malformed-upstream-payload") {
		t.Error("invalid upstream bytes forwarded into the client's SSE parser")
	}
	if !strings.Contains(w.Body.String(), `"error"`) || !strings.Contains(w.Body.String(), "visible") {
		t.Error("corrupt stream treated as success or valid content lost")
	}
}

func TestFailedBindingReleasesLeaseAndCanBeRetried(t *testing.T) {
	var owner string
	fail := true
	lobe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/get-session":
			fmt.Fprint(w, `{"user":{"id":"retry-user"}}`)
		case "/api/auth/list-accounts":
			fmt.Fprintf(w, `[{"providerId":"generic-oidc","accountId":"%s"}]`, owner)
		case "/trpc/lambda/agent.getBuiltinAgent":
			fmt.Fprint(w, `{"result":{"data":{"json":{"id":"inbox"}}}}`)
		default:
			if fail {
				w.WriteHeader(502)
				fmt.Fprint(w, `{"error":{"message":"temporary failure"}}`)
				return
			}
			fmt.Fprint(w, `{"result":{"data":{"json":null}}}`)
		}
	}))
	defer lobe.Close()
	f := setup(t, lobe.URL, "")
	owner = f.user.ID.String()
	bind := func() *httptest.ResponseRecorder {
		ticket, err := f.s.putGrant(f.s.d.DB, "launch", f.user.ID, nil, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(map[string]string{"ticket": ticket})
		return f.request("POST", "/api/lobehub/bind", string(body), "", map[string]string{"Cookie": "session=retry", "Origin": lobe.URL})
	}
	if w := bind(); w.Code != 502 {
		t.Fatalf("failed sync appeared successful: %s", w.Body.String())
	}
	var link model.LobeHubLink
	f.s.d.DB.First(&link, "user_id = ?", f.user.ID)
	if link.SyncUntil != nil || link.SyncToken != "" || link.ConnectedAt != nil {
		t.Fatal("failed sync retained its lock or marked the account connected")
	}
	fail = false
	if w := bind(); w.Code != 200 {
		t.Fatalf("retry could not recover: %s", w.Body.String())
	}
	if _, err := f.s.active(context.Background(), f.user.ID); err != nil {
		t.Fatal(err)
	}
}
