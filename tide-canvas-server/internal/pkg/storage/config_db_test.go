package storage

import (
	"context"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/url"
	"strings"
	"testing"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
)

func TestStorageAccelerationSwitchFieldUsesStableBooleanEncoding(t *testing.T) {
	var switchField *storageField
	for index := range storageFields {
		if storageFields[index].key == "storage.ossAccelerateEnabled" {
			switchField = &storageFields[index]
			break
		}
	}
	if switchField == nil {
		t.Fatal("storage acceleration switch is not seeded into sys_config")
	}
	cfg := config.StorageConfig{AccelerateEnabled: true}
	if got := switchField.get(cfg); got != "1" {
		t.Fatalf("enabled value = %q, want 1", got)
	}
	switchField.set(&cfg, "0")
	if cfg.AccelerateEnabled {
		t.Fatal("stored 0 did not disable acceleration")
	}
	for _, enabled := range []string{"1", "true", "YES", "on", "enabled"} {
		if !storedStorageBool(enabled) {
			t.Fatalf("stored value %q should enable acceleration", enabled)
		}
	}
}

func TestExistingStorageConfigGainsUploadAccelerationWithoutChangingLegacyPolicy(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []model.SysConfig{
		{ConfigKey: "storage.ossAccelerateEnabled", ConfigValue: "0", Description: "old combined policy"},
		{ConfigKey: "storage.ossBucket", ConfigValue: "flowlinght-test"},
		{ConfigKey: "storage.ossAccelerateDomain", ConfigValue: ""},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	base := accelerationTestConfig(true)
	loaded, err := SeedAndLoadConfig(db, base)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.UploadAccelerateEnabled || loaded.AccelerateEnabled || loaded.Bucket != "flowlinght-test" {
		t.Fatal("new upload default must not overwrite existing read policy or bucket")
	}
	store, err := NewOSSStorage(loaded)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := store.Presign(context.Background(), "u1/ref.png", "image/png", 32)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(grant.UploadURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Hostname() != "flowlinght-test.oss-accelerate.aliyuncs.com" {
		t.Fatalf("wrong migrated host: %s", parsed.Host)
	}
	var old model.SysConfig
	if err := db.Where("config_key = ?", "storage.ossAccelerateEnabled").First(&old).Error; err != nil {
		t.Fatal(err)
	}
	if old.ConfigValue != "0" || !strings.Contains(old.Description, "不影响上传加速") {
		t.Fatal("legacy value must be retained with updated help text")
	}
	if err := db.Model(&model.SysConfig{}).Where("config_key = ?", "storage.ossUploadAccelerateEnabled").Update("config_value", "0").Error; err != nil {
		t.Fatal(err)
	}
	loaded, err = SeedAndLoadConfig(db, base)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.UploadAccelerateEnabled {
		t.Fatal("restart overwrote an explicit admin upload setting")
	}
}
