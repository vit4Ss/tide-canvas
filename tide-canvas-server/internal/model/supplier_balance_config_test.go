package model

import (
	"strconv"
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

func TestEnsureBaselineConfigSeedsSocialAnalysisWithoutCredential(t *testing.T) {
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
	if err := db.Where("config_group = ?", ConfigGroupSocialAnalysis).Find(&rows).Error; err != nil {
		t.Fatalf("load social analysis config: %v", err)
	}
	if len(rows) != len(SocialAnalysisConfigKeys) {
		t.Fatalf("social config rows = %d, want %d", len(rows), len(SocialAnalysisConfigKeys))
	}
	for i := range rows {
		if rows[i].ConfigKey == ConfigKeySocialTikHubAPIKey && rows[i].ConfigValue != "" {
			t.Fatal("TikHub API key must be blank when seeded")
		}
	}
	if !IsSecretConfigKey(ConfigKeySocialTikHubAPIKey) {
		t.Fatal("TikHub API key was not classified as a secret")
	}
	if err := db.Model(&SysConfig{}).Where("config_key = ?", ConfigKeySocialTikHubAPIKey).Update("config_value", "operator-secret").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&SysConfig{}).Where("config_key = ?", ConfigKeySocialTikHubEnabled).Update("config_value", "0").Error; err != nil {
		t.Fatal(err)
	}
	if err := ensureBaselineConfig(db); err != nil {
		t.Fatalf("second ensure baseline config: %v", err)
	}
	for key, want := range map[string]string{ConfigKeySocialTikHubAPIKey: "operator-secret", ConfigKeySocialTikHubEnabled: "0"} {
		var stored SysConfig
		if err := db.Where("config_key = ?", key).First(&stored).Error; err != nil {
			t.Fatal(err)
		}
		if stored.ConfigValue != want {
			t.Errorf("%s was overwritten on restart: got %q want %q", key, stored.ConfigValue, want)
		}
	}
}

func TestSupplierBalanceCurrencyMigrationConvertsOnlyNativeNonCNYThresholds(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	legacy := []SysConfig{
		{ConfigKey: ConfigKeyBalanceDLAPILowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances},
		{ConfigKey: ConfigKeyBalanceMikotoLowBalance, ConfigValue: "25", Group: ConfigGroupSupplierBalances},
		{ConfigKey: ConfigKeyBalanceDimensioLowBalance, ConfigValue: "50000", Group: ConfigGroupSupplierBalances},
		{ConfigKey: ConfigKeyBalanceAPIYILowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances},
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("seed legacy config: %v", err)
	}
	if err := ensureBaselineConfig(db); err != nil {
		t.Fatalf("ensure baseline: %v", err)
	}
	assertValue := func(key string, want float64) {
		t.Helper()
		var row SysConfig
		if err := db.Where("config_key = ?", key).First(&row).Error; err != nil {
			t.Fatalf("load %s: %v", key, err)
		}
		got, err := strconv.ParseFloat(row.ConfigValue, 64)
		if err != nil || got != want {
			t.Errorf("%s = %q, want %v", key, row.ConfigValue, want)
		}
	}
	assertValue(ConfigKeyBalanceDLAPILowBalance, 20)
	assertValue(ConfigKeyBalanceMikotoLowBalance, 25)
	assertValue(ConfigKeyBalanceDimensioLowBalance, 500)
	assertValue(ConfigKeyBalanceAPIYILowBalance, 144)

	var apiyiCurrency, apiyiRate SysConfig
	if err := db.Where("config_key = ?", ConfigKeyBalanceAPIYICurrency).First(&apiyiCurrency).Error; err != nil {
		t.Fatalf("load APIYI currency: %v", err)
	}
	if err := db.Where("config_key = ?", ConfigKeyBalanceAPIYIExchangeRate).First(&apiyiRate).Error; err != nil {
		t.Fatalf("load APIYI rate: %v", err)
	}
	if apiyiCurrency.ConfigValue != "USD" || apiyiRate.ConfigValue != "7.2" {
		t.Errorf("APIYI monetary config = %q/%q, want USD/7.2", apiyiCurrency.ConfigValue, apiyiRate.ConfigValue)
	}

	// A second boot must not multiply converted values again.
	if err := ensureBaselineConfig(db); err != nil {
		t.Fatalf("second ensure baseline: %v", err)
	}
	assertValue(ConfigKeyBalanceAPIYILowBalance, 144)
}
