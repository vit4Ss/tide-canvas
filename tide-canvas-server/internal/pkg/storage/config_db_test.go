package storage

import (
	"testing"

	"tidecanvas/internal/config"
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
