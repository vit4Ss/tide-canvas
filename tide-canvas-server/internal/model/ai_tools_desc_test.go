package model

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

const (
	legacyRmbgDesc  = "智能移除背景与对象，输出干净主体。"
	whiteBgRmbgDesc = "智能移除背景与对象，输出白底干净主体。"
)

func openAiToolsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&AiTool{}, &SysConfig{}); err != nil {
		t.Fatal(err)
	}
	return db
}

// 存量行仍是旧内建文案 → 一次性迁移为白底文案(与实际产物一致)。
func TestEnsureBaselineToolsMigratesLegacyRmbgDesc(t *testing.T) {
	db := openAiToolsTestDB(t)
	row := AiTool{
		ID: idgen.Next(), Key: "rmbg", Handler: "remove_bg", Type: AiToolTypeImage,
		Enabled: true, ShowPage: true, Title: "一键抠图", Desc: legacyRmbgDesc,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := ensureBaselineTools(db); err != nil {
		t.Fatal(err)
	}
	var got AiTool
	if err := db.Where("`key` = ?", "rmbg").First(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got.Desc != whiteBgRmbgDesc {
		t.Fatalf("legacy canonical desc must migrate to the white-background wording, got %q", got.Desc)
	}
}

// 管理员自定义过的描述绝不被迁移覆盖。
func TestEnsureBaselineToolsPreservesCustomRmbgDesc(t *testing.T) {
	db := openAiToolsTestDB(t)
	custom := "运营自定义的抠图说明"
	row := AiTool{
		ID: idgen.Next(), Key: "rmbg", Handler: "remove_bg", Type: AiToolTypeImage,
		Enabled: true, ShowPage: true, Title: "一键抠图", Desc: custom,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := ensureBaselineTools(db); err != nil {
		t.Fatal(err)
	}
	var got AiTool
	if err := db.Where("`key` = ?", "rmbg").First(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got.Desc != custom {
		t.Fatalf("admin-customized desc must survive the migration, got %q", got.Desc)
	}
}
