package model

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

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
