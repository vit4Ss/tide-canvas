package admin

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"tidecanvas/internal/handler/billing"
	"tidecanvas/internal/model"
)

func TestEnglishPricingScopedCRUD(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO")
		}
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.Plan{}, &model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	registerPricingRoutes(router.Group("/api/admin"), &g4PricingHandler{db: db, market: "cn"})
	registerPricingRoutes(router.Group("/api/admin/en"), &g4PricingHandler{db: db, market: "en"})
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	cn := request("POST", "/api/admin/plans", map[string]any{"name": "CN plan", "code": "cn_plan", "monthly": 60, "yearly": 600, "monthlyPoints": 600})
	en := request("POST", "/api/admin/en/plans", map[string]any{"name": "Creator", "code": "en_creator", "monthly": 12.50, "yearly": 120, "monthlyPoints": 600})
	if cn.Code != 200 || en.Code != 200 {
		t.Fatalf("Create: %s / %s", cn.Body.String(), en.Body.String())
	}
	var created struct {
		Data g4PlanVO `json:"data"`
	}
	if err = json.Unmarshal(en.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Data.Market != "en" || created.Data.Currency != "USD" || created.Data.Status != 0 || created.Data.Monthly != 12.5 {
		t.Fatalf("Wrong EN defaults: %+v", created.Data)
	}
	if rec := request("PUT", "/api/admin/plans/"+created.Data.ID.String(), map[string]any{"name": "Wrong scope", "code": "en_creator", "monthly": 1}); rec.Code != 404 {
		t.Fatalf("CN updated EN: %s", rec.Body.String())
	}
	if rec := request("DELETE", "/api/admin/plans/"+created.Data.ID.String(), nil); rec.Code != 404 {
		t.Fatal("CN deleted EN")
	}
	for _, market := range []string{"", "/en"} {
		rec := request("GET", "/api/admin"+market+"/plans", nil)
		var list struct {
			Data []g4PlanVO `json:"data"`
		}
		json.Unmarshal(rec.Body.Bytes(), &list)
		if len(list.Data) != 1 {
			t.Fatalf("Scopes mixed: %s", rec.Body.String())
		}
	}
	h := &g4PricingHandler{db: db, market: "en"}
	var cnPlan model.Plan
	db.Where("market = ?", "cn").First(&cnPlan)
	if h.validatePromoDeals([]billing.PromoDeal{{PlanID: cnPlan.ID, Monthly: 1}}) == "" {
		t.Fatal("EN promo accepted a CN plan")
	}
	bad := request("POST", "/api/admin/en/plans", map[string]any{"name": "Sub-cent", "code": "bad_cents", "monthly": 1.001})
	if bad.Code != 400 {
		t.Fatalf("Sub-cent USD price accepted: %s", bad.Body.String())
	}
	oversized := request("POST", "/api/admin/en/plans", map[string]any{"name": "Too many credits", "code": "bad_credit_limit", "monthly": 10, "yearly": 100, "monthlyPoints": model.MaxBillingGrantPoints/12 + 1})
	if oversized.Code != 400 {
		t.Fatalf("Annual grant exceeding the ledger accepted: %s", oversized.Body.String())
	}
	saved := request("PUT", "/api/admin/en/plans/"+created.Data.ID.String(), map[string]any{"name": "Creator", "code": "en_creator", "monthly": 15, "yearly": 150, "monthlyPoints": 900, "status": 1})
	if saved.Code != 200 {
		t.Fatalf("EN edit failed: %s", saved.Body.String())
	}
	db.First(&cnPlan, "id = ?", cnPlan.ID)
	if cnPlan.Price.String() != "60" {
		t.Fatal("EN edit modified the Chinese price")
	}
}
