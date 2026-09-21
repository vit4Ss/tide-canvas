package chatgateway

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/token"
)

func usageData(t *testing.T, f *fixture, path, jwt string) map[string]any {
	t.Helper()
	w := f.request("GET", path, "", jwt, nil)
	if w.Code != 200 {
		t.Fatalf("usage endpoint: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("private records can be cached")
	}
	return jsonMap(t, w)["data"].(map[string]any)
}

func TestUsageRecordsCaptureBothProtocolsAndNeverCountReplays(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, okWithUsage) }))
	defer up.Close()
	for _, spec := range []struct {
		path, body string
		stream     bool
	}{
		{"/api/integrations/v1/chat/completions", `{"model":"test-model","messages":[{"role":"user","content":"hello"}],"stream":true}`, true},
		{"/api/integrations/v1/responses", `{"model":"test-model","input":"hello","stream":false}`, false},
	} {
		t.Run(spec.path, func(t *testing.T) {
			f := setup(t, up.URL)
			for i := 0; i < 2; i++ {
				w := f.request("POST", spec.path, spec.body, f.apiKey, map[string]string{"Idempotency-Key": "same-call"})
				if w.Code != 200 {
					t.Fatal(w.Body.String())
				}
			}
			data := usageData(t, f, "/api/chat-gateway/usage", f.jwt)
			if data["total"] != float64(1) {
				t.Fatalf("replay created duplicate: %v", data)
			}
			row := data["records"].([]any)[0].(map[string]any)
			if row["requestPath"] != spec.path || row["stream"] != spec.stream || row["usageKnown"] != true || row["status"] != "success" {
				t.Fatalf("bad request metadata: %v", row)
			}
			if row["firstTokenMs"] == nil || row["durationMs"] == nil || row["firstTokenMs"].(float64) > row["durationMs"].(float64) {
				t.Fatalf("bad timings: %v", row)
			}
			var bill model.ModelGatewayRequest
			if err := f.s.d.DB.First(&bill).Error; err != nil {
				t.Fatal(err)
			}
			if bill.Source != gatewayAPISource || bill.ProviderName != "Test Provider" || bill.ProviderID == 0 || bill.EndpointID == 0 || bill.UpstreamStatus != 200 {
				t.Fatalf("route not persisted: %+v", bill)
			}
			if row["points"] != tokenCostLabel(bill.CostMicros) {
				t.Fatal("usage cost diverged from billing")
			}
			for _, private := range []string{"responseBody", "providerName", "providerId", "billingProviderName", "endpointId", "clientIP", "requestKey", "bodyHash", "pricingSnapshot"} {
				if _, exists := row[private]; exists {
					t.Fatalf("private field leaked: %s", private)
				}
			}
			if strings.Contains(fmt.Sprint(row), f.apiKey) || strings.Contains(fmt.Sprint(row), "upstream-secret-only") {
				t.Fatal("credential leaked")
			}
		})
	}
}

func TestUsageRecordsAreScopedByUserAndOriginEvenWithIdenticalModelNames(t *testing.T) {
	f := setup(t, "")
	zone := time.FixedZone("Asia/Shanghai", 8*3600)
	rows := []model.ModelGatewayRequest{
		{UserID: f.user.ID, Source: gatewayAPISource, ModelKey: "same-model", BillingMode: "token", Status: "success", CostMicros: 3_000_000, RequestKey: "mine", UsageKnown: true, InputTokens: 100, OutputTokens: 20, CachedInputTokens: 40},
		{UserID: f.user.ID, Source: "", ModelKey: "same-model", BillingMode: "token", Status: "success", CostMicros: 80_000_000, RequestKey: "legacy"},
		{UserID: f.user.ID, Source: "market_model", ModelKey: "same-model", BillingMode: "token", Status: "success", CostMicros: 90_000_000, RequestKey: "market"},
		{UserID: idgen.Next(), Source: gatewayAPISource, ModelKey: "same-model", BillingMode: "token", Status: "success", CostMicros: 7_000_000, RequestKey: "other"},
		{UserID: f.user.ID, Source: gatewayAPISource, ModelKey: "literal_%", BillingMode: "token", Status: "billing_pending", CostMicros: 90_000_000, RequestKey: "pending"},
	}
	for i := range rows {
		rows[i].CreateTime = time.Date(2026, 9, 21, 0, 0, 0, 0, zone).In(time.Local)
		if err := f.s.d.DB.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	data := usageData(t, f, "/api/chat-gateway/usage?userId="+rows[3].UserID.String(), f.jwt)
	if data["total"] != float64(2) {
		t.Fatalf("scope is wrong: %v", data)
	}
	summary := data["summary"].(map[string]any)
	if summary["points"] != "3" || summary["pending"] != float64(1) || summary["cachedInputTokens"] != float64(40) {
		t.Fatalf("aggregate included uncharged or foreign rows: %v", summary)
	}
	filtered := usageData(t, f, "/api/chat-gateway/usage?model=%25&startDate=2026-09-21&endDate=2026-09-21", f.jwt)
	if filtered["total"] != float64(1) {
		t.Fatalf("literal wildcard filter: %v", filtered)
	}
	if row := filtered["records"].([]any)[0].(map[string]any); row["points"] != "0" || row["netPoints"] != "0" {
		t.Fatalf("legacy pending cost reported as an actual charge: %v", row)
	}
	if d := usageData(t, f, "/api/chat-gateway/usage?endDate=2026-09-20", f.jwt); d["total"] != float64(0) {
		t.Fatal("Beijing date boundary incorrect")
	}
	for _, q := range []string{"pageNum=0", "pageSize=101", "status=bogus", "stream=maybe", "protocol=images", "startDate=no", "startDate=2026-09-22&endDate=2026-09-21"} {
		if w := f.request("GET", "/api/chat-gateway/usage?"+q, "", f.jwt, nil); w.Code != 400 {
			t.Fatalf("invalid filter accepted: %s %d", q, w.Code)
		}
	}
	if w := f.request("GET", "/api/chat-gateway/usage", "", f.apiKey, nil); w.Code == 200 {
		t.Fatal("API key accessed account session page")
	}
	if w := f.request("GET", "/api/chat-gateway/usage?accountId="+rows[3].UserID.String(), "", f.jwt, nil); w.Code != 409 {
		t.Fatal("auth retry could load a different account's history")
	}
}

func TestUsageAdminChecksLivePermissionsAndDoesNotReturnPayloads(t *testing.T) {
	f := setup(t, "")
	if err := f.s.d.DB.AutoMigrate(&model.SysRole{}); err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("role", 9).Error; err != nil {
		t.Fatal(err)
	}
	admin, _, _, err := token.Issue(f.user.ID, 9)
	if err != nil {
		t.Fatal(err)
	}
	r := model.ModelGatewayRequest{UserID: idgen.Next(), Source: gatewayAPISource, BillingMode: "token", Status: "success", ModelKey: "model", ProviderName: "backup", BillingProviderName: "preferred", ClientIP: "192.0.2.1", RequestKey: "private-request", ResponseBody: "private-response"}
	if err := f.s.d.DB.Create(&r).Error; err != nil {
		t.Fatal(err)
	}
	d := usageData(t, f, "/api/admin/chat-gateway-usage?userId="+r.UserID.String(), admin)
	row := d["records"].([]any)[0].(map[string]any)
	if row["providerName"] != "backup" || row["billingProviderName"] != "preferred" || row["clientIP"] != "192.0.2.1" {
		t.Fatalf("missing operator metadata: %v", row)
	}
	if strings.Contains(fmt.Sprint(row), "private-response") || strings.Contains(fmt.Sprint(row), "private-request") {
		t.Fatal("payload leaked")
	}
	if err := f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("role", 0).Error; err != nil {
		t.Fatal(err)
	}
	if w := f.request("GET", "/api/admin/chat-gateway-usage", "", admin, nil); w.Code != 403 {
		t.Fatalf("stale admin JWT passed: %d", w.Code)
	}
	if err := f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	if w := f.request("GET", "/api/chat-gateway/usage", "", f.jwt, nil); w.Code != 403 {
		t.Fatal("disabled account could view history")
	}
}

func TestUsageFailureHasNoInventedFirstTokenOrTokenCounts(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		fmt.Fprint(w, `{"error":{"message":"invalid input"}}`)
	}))
	defer up.Close()
	f := setup(t, up.URL)
	w := f.request("POST", "/api/integrations/v1/chat/completions", untrimmedPrompt, f.apiKey, nil)
	if w.Code != 400 {
		t.Fatal(w.Body.String())
	}
	d := usageData(t, f, "/api/chat-gateway/usage", f.jwt)
	row := d["records"].([]any)[0].(map[string]any)
	if row["usageKnown"] != false || row["firstTokenMs"] != nil || row["durationMs"] == nil || row["status"] != "failed" || row["points"] != "0" {
		t.Fatalf("failure telemetry incorrect: %v", row)
	}
	var bill model.ModelGatewayRequest
	f.s.d.DB.First(&bill)
	if bill.UpstreamStatus != 400 || bill.ProviderName != "Test Provider" {
		t.Fatalf("failure lost upstream status: %+v", bill)
	}
}

func TestUsageRefundsTrackTheLedgerWithoutChangingOriginalTokenCharge(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, okWithUsage) }))
	defer up.Close()
	f := setup(t, up.URL)
	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var bill model.ModelGatewayRequest
	if err := f.s.d.DB.First(&bill).Error; err != nil {
		t.Fatal(err)
	}
	if bill.CostMicros != 1_000_000 {
		t.Fatal("unexpected test cost")
	}
	// Ignore unrelated user refunds even if an old imported ledger shares ref.
	if err := f.s.d.DB.Create(&model.PointRecord{UserID: idgen.Next(), RefID: &bill.ID, ChangeType: "refund", Amount: 100}).Error; err != nil {
		t.Fatal(err)
	}
	d := usageData(t, f, "/api/chat-gateway/usage", f.jwt)
	if d["summary"].(map[string]any)["points"] != "1" {
		t.Fatal("another user's refund contaminated total")
	}
	for i := 0; i < 2; i++ {
		if _, err := points.AdminRefund(f.s.d.DB, f.user.ID, 1, "operator adjustment", bill.ID); err != nil {
			t.Fatal(err)
		}
	}
	d = usageData(t, f, "/api/chat-gateway/usage", f.jwt)
	r := d["records"].([]any)[0].(map[string]any)
	if r["points"] != "1" || r["refundedPoints"] != "1" || r["netPoints"] != "0" || d["summary"].(map[string]any)["points"] != "0" {
		t.Fatalf("refund accounting: %v", d)
	}
	var user model.User
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.PointBalance() != 20 {
		t.Fatalf("refund repeated: %v", user.PointBalance())
	}
}
