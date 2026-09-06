package lobehub

import (
	"strings"
	"testing"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/token"
)

// adminSession returns a JWT for a super admin plus a bill parked for review,
// with its reservation still held against the caller's balance.
func pendingBill(t *testing.T, f *fixture, reserved int64) (string, *model.ModelGatewayRequest) {
	t.Helper()
	admin := model.User{ID: idgen.Next(), Username: "root", Email: "root@example.test", Status: 1, Role: 9}
	if err := f.s.d.DB.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	access, _, _, err := token.Issue(admin.ID, 9)
	if err != nil {
		t.Fatal(err)
	}
	row := model.ModelGatewayRequest{
		UserID: f.user.ID, BillingMode: "token", ModelKey: "test-model", Status: "billing_pending",
		RequestKey: "review-" + idgen.Next().String(), ReservedMicros: reserved, MaxOutputTokens: 1000,
		PricingSnapshot: `{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300","cachedInputPointsPerMillion":"20","maxInputTokens":1000,"maxOutputTokens":1000}`,
		ErrorCode:       "token_usage_unavailable",
	}
	row.ID = idgen.Next()
	if err := f.s.d.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := points.HoldMicros(f.s.d.DB, f.user.ID, reserved); err != nil {
		t.Fatal(err)
	}
	return access, &row
}

func TestResolvingABillReleasesTheHoldAndChargesOnlyVerifiedTokens(t *testing.T) {
	f := setup(t, "", "")
	access, row := pendingBill(t, f, 400_000)

	body := `{"action":"settle","inputTokens":100,"outputTokens":200,"cachedInputTokens":20,"reasoningTokens":0,"reason":"上游日志确认用量"}`
	w := f.request("POST", "/api/admin/lobehub-billing/"+row.ID.String()+"/resolve", body, access, nil)
	if w.Code != 200 {
		t.Fatalf("resolve failed: %d %s", w.Code, w.Body.String())
	}

	var settled model.ModelGatewayRequest
	f.s.d.DB.First(&settled, "id = ?", row.ID)
	// 100 input − 20 cached at 100/M, 20 cached at 20/M, 200 output at 300/M.
	if settled.CostMicros != 68_400 || settled.Status == "billing_pending" || settled.ErrorCode != "" {
		t.Fatalf("unexpected settlement: cost=%d status=%s code=%s", settled.CostMicros, settled.Status, settled.ErrorCode)
	}
	if settled.BillingResolution != "上游日志确认用量" || settled.BillingResolvedBy == 0 || settled.BillingResolvedAt == nil {
		t.Fatalf("the audit trail is incomplete: %+v", settled)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointHeldMicros != 0 || user.PointBalance() != 19.9316 {
		t.Fatalf("hold or charge is wrong: held=%d balance=%v", user.PointHeldMicros, user.PointBalance())
	}

	// Re-resolving must not double charge.
	if w := f.request("POST", "/api/admin/lobehub-billing/"+row.ID.String()+"/resolve", body, access, nil); w.Code == 200 {
		t.Fatal("a settled bill was resolved twice")
	}
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19.9316 {
		t.Fatalf("balance moved on the second resolve: %v", user.PointBalance())
	}
}

func TestReleasingABillRefundsTheWholeReservation(t *testing.T) {
	f := setup(t, "", "")
	access, row := pendingBill(t, f, 400_000)

	w := f.request("POST", "/api/admin/lobehub-billing/"+row.ID.String()+"/resolve", `{"action":"release","reason":"上游未产生任何调用"}`, access, nil)
	if w.Code != 200 {
		t.Fatalf("release failed: %d %s", w.Code, w.Body.String())
	}
	var settled model.ModelGatewayRequest
	f.s.d.DB.First(&settled, "id = ?", row.ID)
	if settled.Status != "released" || settled.CostMicros != 0 {
		t.Fatalf("release charged the user: %+v", settled)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointHeldMicros != 0 || user.Points != 20 || user.PointFraction != 0 {
		t.Fatalf("reservation was not returned: %+v", user)
	}
}

func TestResolveRejectsTokenCountsBeyondTheReservedPrice(t *testing.T) {
	f := setup(t, "", "")
	access, row := pendingBill(t, f, 400_000)

	// 2000 input tokens is past the 1000 the snapshot priced and reserved for.
	body := `{"action":"settle","inputTokens":2000,"outputTokens":200,"cachedInputTokens":0,"reasoningTokens":0,"reason":"超出预留额度的用量"}`
	w := f.request("POST", "/api/admin/lobehub-billing/"+row.ID.String()+"/resolve", body, access, nil)
	if w.Code == 200 {
		t.Fatal("a charge above the reservation was accepted")
	}
	if strings.Contains(w.Body.String(), "token usage exceeds") {
		t.Fatalf("raw internal error surfaced to the operator: %s", w.Body.String())
	}
	var settled model.ModelGatewayRequest
	f.s.d.DB.First(&settled, "id = ?", row.ID)
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if settled.Status != "billing_pending" || user.PointHeldMicros != 400_000 {
		t.Fatalf("a rejected resolve must leave the bill untouched: %s held=%d", settled.Status, user.PointHeldMicros)
	}
}

func TestResolveReportsAMissingBillAsNotFound(t *testing.T) {
	f := setup(t, "", "")
	access, _ := pendingBill(t, f, 400_000)
	w := f.request("POST", "/api/admin/lobehub-billing/"+idgen.Next().String()+"/resolve", `{"action":"release","reason":"不存在的账单"}`, access, nil)
	if w.Code != 404 {
		t.Fatalf("expected 404 for a missing bill, got %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "record not found") {
		t.Fatalf("raw ORM error surfaced to the operator: %s", w.Body.String())
	}
}
