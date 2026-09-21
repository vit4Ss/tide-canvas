package chatgateway

import (
	"context"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
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
	f := setup(t, "")
	access, row := pendingBill(t, f, 400_000)

	body := `{"action":"settle","inputTokens":100,"outputTokens":200,"cachedInputTokens":20,"reasoningTokens":0,"reason":"上游日志确认用量"}`
	w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", body, access, nil)
	if w.Code != 200 {
		t.Fatalf("resolve failed: %d %s", w.Code, w.Body.String())
	}

	var settled model.ModelGatewayRequest
	f.s.d.DB.First(&settled, "id = ?", row.ID)
	// 100 input − 20 cached at 100/M, 20 cached at 20/M, 200 output at
	// 300/M produces 0.0684 raw points and settles as one whole point. The
	// 0.4-point hold models a pending row created before integer billing.
	if settled.CostMicros != 1_000_000 || settled.Status == "billing_pending" || settled.ErrorCode != "" {
		t.Fatalf("unexpected settlement: cost=%d status=%s code=%s", settled.CostMicros, settled.Status, settled.ErrorCode)
	}
	if !settled.UsageKnown {
		t.Fatal("verified usage was not marked as reliable")
	}
	if settled.BillingResolution != "上游日志确认用量" || settled.BillingResolvedBy == 0 || settled.BillingResolvedAt == nil {
		t.Fatalf("the audit trail is incomplete: %+v", settled)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointHeldMicros != 0 || user.PointBalance() != 19 {
		t.Fatalf("hold or charge is wrong: held=%d balance=%v", user.PointHeldMicros, user.PointBalance())
	}

	// Re-resolving must not double charge.
	if w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", body, access, nil); w.Code == 200 {
		t.Fatal("a settled bill was resolved twice")
	}
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19 {
		t.Fatalf("balance moved on the second resolve: %v", user.PointBalance())
	}
}

func TestReleasingABillRefundsTheWholeReservation(t *testing.T) {
	f := setup(t, "")
	access, row := pendingBill(t, f, 400_000)

	w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", `{"action":"release","reason":"上游未产生任何调用"}`, access, nil)
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

func TestReleasingABillCannotOverwriteUsageWithUnvalidatedFormValues(t *testing.T) {
	f := setup(t, "")
	access, row := pendingBill(t, f, 400_000)
	if err := f.s.d.DB.Model(row).Updates(map[string]any{"input_tokens": 120, "output_tokens": 30, "cached_input_tokens": 20, "reasoning_tokens": 10}).Error; err != nil {
		t.Fatal(err)
	}
	w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", `{"action":"release","inputTokens":-100,"outputTokens":999999999,"reason":"释放并保留历史用量"}`, access, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var settled model.ModelGatewayRequest
	if err := f.s.d.DB.First(&settled, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if settled.Status != "released" || settled.CostMicros != 0 || settled.InputTokens != 120 || settled.OutputTokens != 30 || settled.CachedInputTokens != 20 || settled.ReasoningTokens != 10 || settled.UsageKnown {
		t.Fatalf("release forged token usage: %+v", settled)
	}
}

func TestResolveRejectsTokenCountsBeyondTheReservedPrice(t *testing.T) {
	f := setup(t, "")
	access, row := pendingBill(t, f, 400_000)

	// 2000 input tokens is past the 1000 the snapshot priced and reserved for.
	body := `{"action":"settle","inputTokens":2000,"outputTokens":200,"cachedInputTokens":0,"reasoningTokens":0,"reason":"超出预留额度的用量"}`
	w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", body, access, nil)
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
	f := setup(t, "")
	access, _ := pendingBill(t, f, 400_000)
	w := f.request("POST", "/api/admin/chat-gateway-billing/"+idgen.Next().String()+"/resolve", `{"action":"release","reason":"不存在的账单"}`, access, nil)
	if w.Code != 404 {
		t.Fatalf("expected 404 for a missing bill, got %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "record not found") {
		t.Fatalf("raw ORM error surfaced to the operator: %s", w.Body.String())
	}
}

func TestManualSettlementRequiresExplicitInputAndOutputUsage(t *testing.T) {
	for _, fields := range []string{``, `,"inputTokens":0`, `,"outputTokens":0`, `,"inputTokens":null,"outputTokens":0`} {
		t.Run(fields, func(t *testing.T) {
			f := setup(t, "")
			access, row := pendingBill(t, f, 400_000)
			body := `{"action":"settle","reason":"核对上游用量"` + fields + `}`
			w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", body, access, nil)
			if w.Code != 400 {
				t.Fatalf("missing usage accepted: %d %s", w.Code, w.Body.String())
			}
			var bill model.ModelGatewayRequest
			var user model.User
			if err := f.s.d.DB.First(&bill, "id = ?", row.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if bill.Status != "billing_pending" || bill.UsageKnown || user.PointHeldMicros != 400_000 || user.PointBalance() != 19.6 {
				t.Fatalf("invalid settlement changed money/state: %s held=%d balance=%v", bill.Status, user.PointHeldMicros, user.PointBalance())
			}
		})
	}
}

func TestDemotedAdministratorCannotSettleOrReleaseWithOldToken(t *testing.T) {
	for _, action := range []string{"settle", "release"} {
		t.Run(action, func(t *testing.T) {
			f := setup(t, "")
			if err := f.s.d.DB.AutoMigrate(&model.SysRole{}); err != nil {
				t.Fatal(err)
			}
			access, row := pendingBill(t, f, 400_000)
			if err := f.s.d.DB.Model(&model.User{}).Where("username = ?", "root").Update("role", 0).Error; err != nil {
				t.Fatal(err)
			}
			body := `{"action":"` + action + `","inputTokens":100,"outputTokens":200,"reason":"旧令牌不应有财务权限"}`
			w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", body, access, nil)
			if w.Code != 403 {
				t.Fatalf("stale admin token changed ledger: %d %s", w.Code, w.Body.String())
			}
			if w := f.request("GET", "/api/admin/chat-gateway-billing", "", access, nil); w.Code != 403 {
				t.Fatal("demoted administrator could still read other accounts' bills")
			}
			var bill model.ModelGatewayRequest
			if err := f.s.d.DB.First(&bill, "id = ?", row.ID).Error; err != nil {
				t.Fatal(err)
			}
			if bill.Status != "billing_pending" {
				t.Fatal("denied request changed bill")
			}
		})
	}
}

func TestManualSettlementAllowsExplicitVerifiedZeroUsage(t *testing.T) {
	f := setup(t, "")
	access, row := pendingBill(t, f, 400_000)
	w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", `{"action":"settle","inputTokens":0,"outputTokens":0,"reason":"上游确认没有产生用量"}`, access, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var bill model.ModelGatewayRequest
	var user model.User
	if err := f.s.d.DB.First(&bill, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !bill.UsageKnown || bill.CostMicros != 0 || user.PointHeldMicros != 0 || user.PointBalance() != 20 {
		t.Fatalf("explicit zero settlement: known=%v cost=%d held=%d balance=%v", bill.UsageKnown, bill.CostMicros, user.PointHeldMicros, user.PointBalance())
	}
}

// Both paths must roll back all three writes: wallet, ledger, bill. A retry
// after storage recovers then settles once using the original price snapshot.
func TestTokenSettlementWriteFailuresRollbackAndRetryExactlyOnce(t *testing.T) {
	for _, manual := range []bool{false, true} {
		for _, failAt := range []string{"ledger", "bill"} {
			name := failAt
			if manual {
				name += "-manual"
			} else {
				name += "-automatic"
			}
			t.Run(name, func(t *testing.T) {
				f := setup(t, "")
				access, row := pendingBill(t, f, 1_000_000)
				initialStatus := "billing_pending"
				if !manual {
					initialStatus = "pending"
					if err := f.s.d.DB.Model(row).Update("status", initialStatus).Error; err != nil {
						t.Fatal(err)
					}
				}
				callback := "simulate-settlement-storage-failure"
				if failAt == "ledger" {
					if err := f.s.d.DB.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
						if tx.Statement.Table == "point_record" {
							tx.AddError(errors.New("ledger unavailable"))
						}
					}); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := f.s.d.DB.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
						if tx.Statement.Table == "model_gateway_request" {
							tx.AddError(errors.New("bill update unavailable"))
						}
					}); err != nil {
						t.Fatal(err)
					}
				}
				resolve := func() bool {
					if manual {
						w := f.request("POST", "/api/admin/chat-gateway-billing/"+row.ID.String()+"/resolve", `{"action":"settle","inputTokens":100,"outputTokens":100,"reason":"依据真实上游用量结算"}`, access, nil)
						return w.Code == 200
					}
					return f.s.settleTokens(context.Background(), row, okWithUsage, "") == nil
				}
				if resolve() {
					t.Fatal("failed write reported successful settlement")
				}
				var user model.User
				var bill model.ModelGatewayRequest
				var entries int64
				if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := f.s.d.DB.First(&bill, "id = ?", row.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := f.s.d.DB.Model(&model.PointRecord{}).Count(&entries).Error; err != nil {
					t.Fatal(err)
				}
				if user.Points != 20 || user.PointHeldMicros != 1_000_000 || bill.Status != initialStatus || entries != 0 {
					t.Fatalf("not atomic: points=%d held=%d bill=%s entries=%d", user.Points, user.PointHeldMicros, bill.Status, entries)
				}
				if failAt == "ledger" {
					_ = f.s.d.DB.Callback().Create().Remove(callback)
				} else {
					_ = f.s.d.DB.Callback().Update().Remove(callback)
				}
				if !resolve() {
					t.Fatal("retry after database recovery failed")
				}
				_ = resolve()
				if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := f.s.d.DB.Model(&model.PointRecord{}).Count(&entries).Error; err != nil {
					t.Fatal(err)
				}
				if user.Points != 19 || user.PointHeldMicros != 0 || entries != 1 {
					t.Fatalf("retry was not exactly once: points=%d held=%d entries=%d", user.Points, user.PointHeldMicros, entries)
				}
			})
		}
	}
}
