package model

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFrontMenuKeysNoLongerCarryTheRemovedAIChatEntry(t *testing.T) {
	found := map[string]bool{}
	for _, key := range FrontMenuKeys {
		found[key] = true
	}
	if !found["chat"] {
		t.Fatal("generation chat menu key is missing")
	}
	// The embedded AI chat page is gone. Its key must not come back: the
	// sidebar would filter for an item that no longer exists, and the roles
	// admin would offer a permission that grants nothing.
	if found["ai_chat"] {
		t.Fatal("removed AI chat menu key is still offered")
	}
	for _, key := range frontMenuBackfillKeys {
		if key == "ai_chat" {
			t.Fatal("existing roles would be backfilled with a removed menu key")
		}
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
