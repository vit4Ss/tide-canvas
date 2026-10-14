package billing

import (
	"github.com/shopspring/decimal"
	"testing"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
)

func TestEnglishCreatorBootstrapIsPricedOnceAndPreservesAdminChanges(t *testing.T) {
	db := marketTestDB(t)
	cn := model.Plan{Name: "CN", Code: "pro", Market: "cn", Currency: "CNY", Price: decimal.NewFromInt(60), PointsGrant: 1000, Status: 1}
	if err := db.Create(&cn).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := SeedEnglishCreator(db); err != nil {
			t.Fatal(err)
		}
	}
	s := newService(db, &config.Config{})
	plans, err := s.listPlans("en")
	if err != nil || len(plans) != 1 || plans[0].Name != "Creator" || plans[0].Monthly != 10 || plans[0].MonthlyPoints != 600 || plans[0].Yearly != 0 || plans[0].VipLevel != 0 || plans[0].Currency != "USD" {
		t.Fatalf("wrong approved pack: %+v %v", plans, err)
	}
	var plan model.Plan
	db.Where("code = ?", "en_creator").First(&plan)
	price, grant, err := planPricing(&plan, CycleMonthly)
	if err != nil || !price.Equal(decimal.NewFromInt(10)) || grant != 600 {
		t.Fatal("published price differs from billing")
	}
	if _, _, err := planPricing(&plan, CycleYearly); err == nil {
		t.Fatal("unapproved larger pack purchasable")
	}
	if err := db.Model(&plan).Updates(map[string]any{"price": 15, "code": "renamed_creator", "status": 0}).Error; err != nil {
		t.Fatal(err)
	}
	if err := SeedEnglishCreator(db); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Plan{}).Where("market = ?", "en").Count(&count)
	if count != 1 {
		t.Fatal("renamed pack recreated on restart")
	}
	db.First(&plan, plan.ID)
	if !plan.Price.Equal(decimal.NewFromInt(15)) || plan.Status != 0 {
		t.Fatal("admin changes overwritten")
	}
	if err := db.Delete(&plan).Error; err != nil {
		t.Fatal(err)
	}
	if err := SeedEnglishCreator(db); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Plan{}).Where("market = ?", "en").Count(&count)
	if count != 0 {
		t.Fatal("deleted pack resurrected")
	}
	cnPlans, _ := s.listPlans("cn")
	if len(cnPlans) != 1 || cnPlans[0].Monthly != 60 {
		t.Fatal("CN catalog changed")
	}
}
