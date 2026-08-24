package model

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEnsureBaselineConfigSeedsSupplierBalancesWithoutTokens(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	if err := ensureBaselineConfig(db); err != nil {
		t.Fatalf("ensure baseline config: %v", err)
	}

	var rows []SysConfig
	if err := db.Where("config_group = ?", ConfigGroupSupplierBalances).Find(&rows).Error; err != nil {
		t.Fatalf("load supplier config: %v", err)
	}
	if len(rows) != len(SupplierBalanceConfigKeys) {
		t.Fatalf("supplier config rows = %d, want %d", len(rows), len(SupplierBalanceConfigKeys))
	}
	for i := range rows {
		if IsSupplierBalanceSecretConfigKey(rows[i].ConfigKey) && rows[i].ConfigValue != "" {
			t.Errorf("seeded token %s must be blank", rows[i].ConfigKey)
		}
	}
}
