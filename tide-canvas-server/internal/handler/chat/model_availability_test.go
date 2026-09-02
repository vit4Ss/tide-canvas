package chat

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

func TestTextModelMaintenanceUsesSelectedAndFallbackModels(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:chat_model_maintenance?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Create(&model.MarketModel{
		Name: "维护模型", ModelKey: "maintained-text", Type: "text", Status: 1,
		Config: `{"availabilityStatus":"maintenance"}`,
	}).Error; err != nil {
		t.Fatalf("create model: %v", err)
	}

	svc := &service{repo: newRepo(db)}
	if err := svc.validateTextModelAvailability("maintained-text"); err != errModelMaintenance {
		t.Fatalf("selected maintenance error = %v", err)
	}
	if err := svc.validateTextModelAvailability(""); err != errModelMaintenance {
		t.Fatalf("fallback maintenance error = %v", err)
	}
}
