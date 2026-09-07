package model

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFrontMenuKeysKeepChatAndAIChatIndependent(t *testing.T) {
	found := map[string]int{}
	for index, key := range FrontMenuKeys {
		found[key] = index
	}
	if _, ok := found["chat"]; !ok {
		t.Fatal("generation chat menu key is missing")
	}
	if _, ok := found["ai_chat"]; !ok {
		t.Fatal("AI chat menu key is missing")
	}
	if found["chat"] == found["ai_chat"] || found["ai_chat"] != found["chat"]+1 {
		t.Fatalf("chat menu order is not independent and adjacent: %#v", FrontMenuKeys)
	}
	backfilled := false
	for _, key := range frontMenuBackfillKeys {
		if key == "ai_chat" {
			backfilled = true
			break
		}
	}
	if !backfilled {
		t.Fatal("existing roles would not receive the new AI chat menu key")
	}
}

func TestMenuBackfillRunsOnceAndPreservesLaterAdminChoice(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "roles.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&SysRole{}, &SysConfig{}); err != nil {
		t.Fatal(err)
	}
	role := SysRole{Name: "受限角色", Code: "limited", Permissions: `["studio"]`, Status: 1}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	if err := backfillMenuKey(db, "analysis"); err != nil {
		t.Fatal(err)
	}
	var stored SysRole
	if err := db.First(&stored, "id = ?", role.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Permissions != `["studio","analysis"]` {
		t.Fatalf("first backfill permissions = %s", stored.Permissions)
	}
	if err := db.Model(&SysRole{}).Where("id = ?", role.ID).Update("permissions", `["studio"]`).Error; err != nil {
		t.Fatal(err)
	}
	if err := backfillMenuKey(db, "analysis"); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&stored, "id = ?", role.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Permissions != `["studio"]` {
		t.Fatalf("second backfill overrode administrator choice: %s", stored.Permissions)
	}
}
