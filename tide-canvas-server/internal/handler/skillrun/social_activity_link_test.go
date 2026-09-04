package skillrun

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestAnalysisActivityRecordIDAcceptsOnlyAnalysisSkillsAndStringIDs(t *testing.T) {
	if id, err := analysisActivityRecordID("tool-account-analysis", map[string]any{"activityRecordId": "12345"}); err != nil || id.String() != "12345" {
		t.Fatalf("valid analysis activity id = %v, %v", id, err)
	}
	if id, err := analysisActivityRecordID("tool-account-analysis", map[string]any{}); err != nil || id != 0 {
		t.Fatalf("missing activity id = %v, %v", id, err)
	}
	if _, err := analysisActivityRecordID("unrelated-skill", map[string]any{"activityRecordId": "12345"}); err == nil {
		t.Fatal("non-analysis skill accepted an activity record id")
	}
	if _, err := analysisActivityRecordID("tool-video-analysis", map[string]any{"activityRecordId": float64(12345)}); err == nil {
		t.Fatal("numeric activity record id was accepted despite JSON precision risk")
	}
}

func TestAnalysisActivityContextRequiresSourcePlatformAndMode(t *testing.T) {
	source, platform, kind, err := analysisActivityContext(idgen.ID(12345), map[string]any{
		"sourceUrl": "https://space.bilibili.com/1", "platform": "BILIBILI", "analysisMode": "account",
	})
	if err != nil || source != "https://space.bilibili.com/1" || platform != "bilibili" || kind != "account" {
		t.Fatalf("analysis context = %q %q %q %v", source, platform, kind, err)
	}
	if _, _, _, err := analysisActivityContext(idgen.ID(12345), map[string]any{
		"sourceUrl": "https://space.bilibili.com/1", "platform": "bilibili",
	}); err == nil {
		t.Fatal("analysis context without a mode was accepted")
	}
}

func TestLinkAnalysisActivityIsOwnerScopedAndSingleRun(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:skillrun-activity-link-"+idgen.Next().String()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SocialActivityRecord{}); err != nil {
		t.Fatal(err)
	}
	record := model.SocialActivityRecord{
		ID: idgen.ID(5101), UserID: idgen.ID(5102), ActivityType: model.SocialActivityAnalysis,
		SourceURL: "https://space.bilibili.com/1", Status: model.SocialActivitySucceeded,
	}
	if err := db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := linkAnalysisActivity(db, record.ID, idgen.ID(9999), idgen.ID(5201), record.SourceURL, "", ""); err == nil {
		t.Fatal("another user linked the analysis activity")
	}
	if err := db.Model(&record).Updates(map[string]any{"platform": "bilibili", "kind": "account"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := linkAnalysisActivity(db, record.ID, record.UserID, idgen.ID(5201), "https://wrong.example/account", "bilibili", "account"); err == nil {
		t.Fatal("mismatched source URL linked the analysis activity")
	}
	if err := linkAnalysisActivity(db, record.ID, record.UserID, idgen.ID(5201), record.SourceURL, "bilibili", "account"); err != nil {
		t.Fatal(err)
	}
	if err := linkAnalysisActivity(db, record.ID, record.UserID, idgen.ID(5202), record.SourceURL, "bilibili", "account"); err == nil {
		t.Fatal("a second run replaced the immutable analysis linkage")
	}
	var got model.SocialActivityRecord
	if err := db.First(&got, "id = ?", record.ID).Error; err != nil || got.AnalysisRunID != idgen.ID(5201) {
		t.Fatalf("linked activity = %+v err=%v", got, err)
	}
}
