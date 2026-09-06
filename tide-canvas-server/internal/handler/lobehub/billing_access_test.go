package lobehub

import (
	"strings"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/token"
)

// An operations admin holding the points module must reach the token billing
// ledger. The module is registered as "admin.points"; gating the route on a
// bare "points" is fail-closed and locks every non-super admin out.
func TestTokenBillingLedgerIsReachableByThePointsModuleRole(t *testing.T) {
	f := setup(t, "", "")
	if err := f.s.d.DB.AutoMigrate(&model.SysRole{}); err != nil {
		t.Fatal(err)
	}
	const roleID idgen.ID = 5501
	if err := f.s.d.DB.Create(&model.SysRole{BaseModel: model.BaseModel{ID: roleID}, Name: "运营", Code: "ops", Status: 1, Permissions: `["admin.points"]`}).Error; err != nil {
		t.Fatal(err)
	}
	operator := model.User{ID: idgen.Next(), Username: "ops", Email: "ops@example.test", Status: 1, Role: 1, RoleID: roleID}
	if err := f.s.d.DB.Create(&operator).Error; err != nil {
		t.Fatal(err)
	}
	access, _, _, err := token.Issue(operator.ID, 1)
	if err != nil {
		t.Fatal(err)
	}

	w := f.request("GET", "/api/admin/lobehub-billing", "", access, nil)
	if w.Code != 200 {
		t.Fatalf("points-module admin was refused the token ledger: %d %s", w.Code, w.Body.String())
	}

	// The panel's user filter narrows the ledger to one account, and rejects a
	// value that is not an id instead of silently listing everyone.
	mine := model.ModelGatewayRequest{UserID: f.user.ID, BillingMode: "token", ModelKey: "test-model", Status: "success", RequestKey: "mine-1"}
	mine.ID = idgen.Next()
	theirs := model.ModelGatewayRequest{UserID: operator.ID, BillingMode: "token", ModelKey: "test-model", Status: "success", RequestKey: "theirs-1"}
	theirs.ID = idgen.Next()
	for _, row := range []model.ModelGatewayRequest{mine, theirs} {
		if err := f.s.d.DB.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	w = f.request("GET", "/api/admin/lobehub-billing?userId="+f.user.ID.String(), "", access, nil)
	if body := w.Body.String(); w.Code != 200 || !strings.Contains(body, mine.ID.String()) || strings.Contains(body, theirs.ID.String()) {
		t.Fatalf("the user filter did not narrow the ledger: %d %s", w.Code, body)
	}
	if w := f.request("GET", "/api/admin/lobehub-billing?userId=not-an-id", "", access, nil); w.Code == 200 {
		t.Fatal("a malformed user id was treated as no filter")
	}

	// A signed-in user without any admin module must still be refused.
	stranger, _, _, err := token.Issue(f.user.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if w := f.request("GET", "/api/admin/lobehub-billing", "", stranger, nil); w.Code == 200 {
		t.Fatal("a non-admin reached the cross-user token ledger")
	}
}

// The per-user ledger must be scoped to the caller, whatever they ask for.
func TestUserBillingListCannotReadAnotherAccount(t *testing.T) {
	f := setup(t, "", "")
	other := model.User{ID: idgen.Next(), Username: "bob", Email: "bob@example.test", Status: 1}
	if err := f.s.d.DB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	rows := []model.ModelGatewayRequest{
		{UserID: other.ID, BillingMode: "token", ModelKey: "test-model", Status: "success", CostMicros: 1_000_000, RequestKey: "other-1"},
		{UserID: f.user.ID, BillingMode: "token", ModelKey: "test-model", Status: "success", CostMicros: 2_000_000, RequestKey: "mine-1"},
	}
	for i := range rows {
		rows[i].ID = idgen.Next()
		if err := f.s.d.DB.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	w := f.request("GET", "/api/lobehub/billing?userId="+other.ID.String(), "", f.jwt, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, other.ID.String()) {
		t.Fatalf("userId parameter leaked another account's bills: %s", body)
	}
	if !strings.Contains(body, rows[1].ID.String()) {
		t.Fatalf("caller's own bill is missing: %s", body)
	}
}
