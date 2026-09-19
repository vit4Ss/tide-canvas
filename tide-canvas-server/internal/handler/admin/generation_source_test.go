package admin

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestGenerationAPISourceUsesOwnedDurableTasks(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AiTask{}); err != nil {
		t.Fatal(err)
	}
	tasks := []model.AiTask{{ID: 1, UserID: 42, IsAPICall: true}, {ID: 2, UserID: 42}}
	if err := db.Create(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&tasks[0]).Error; err != nil {
		t.Fatal(err)
	}
	rows := []model.ModelCallLog{
		{BaseModel: model.BaseModel{ID: 11}, UserID: 42, BillingRefID: 1, BillingRefType: "task"},
		{BaseModel: model.BaseModel{ID: 12}, UserID: 42, BillingRefID: 2, BillingRefType: "task"},
		{BaseModel: model.BaseModel{ID: 13}, UserID: 43, BillingRefID: 1, BillingRefType: "task"},
		{BaseModel: model.BaseModel{ID: 14}, UserID: 42, BillingRefID: 1, BillingRefType: "ledger"},
		{BaseModel: model.BaseModel{ID: 15}, UserID: 42, RequestBody: `{"isApiCall":true}`},
	}
	sources, err := resolveGenerationAPISources(db, rows)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []idgen.ID{11, 12, 13, 14, 15} {
		if sources[id] != (id == 11) {
			t.Fatalf("source for %s=%v", id, sources[id])
		}
	}
}
