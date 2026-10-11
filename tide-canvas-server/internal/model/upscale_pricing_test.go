package model

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestUpscaleOfficialRepricing(t *testing.T) {
	cases := []struct {
		key     string
		rates   string
		minimum float64
	}{
		{"wavespeed-ai/video-upscaler", `{"720p":"1","1080p":"1","2k":"2","4k":"3"}`, 3},
		{"bytedance/video-upscaler", `{"1080p":"1","2k":"2","4k":"3"}`, 1},
		{"wavespeed-ai/video-upscaler-pro", `{"720p":"3","1080p":"5","2k":"7","4k":"9"}`, 3},
	}
	for _, tc := range cases {
		t.Run(tc.key, func(t *testing.T) {
			raw, _, applied, err := RepricedUpscaleConfig(tc.key, "upscale", `{"icon":"keep","resolutions":["1080p"],"pricePerSecond":99}`)
			if err != nil || !applied {
				t.Fatalf("reprice: %v, %v", applied, err)
			}
			var got struct {
				Icon        string
				Resolutions []string
				Rates       map[string]string `json:"pricePerSecondByResolution"`
			}
			if err := json.Unmarshal([]byte(raw), &got); err != nil {
				t.Fatal(err)
			}
			var want map[string]string
			_ = json.Unmarshal([]byte(tc.rates), &want)
			if len(got.Rates) != len(want) {
				t.Fatalf("rates: %v", got.Rates)
			}
			for res, rate := range want {
				if got.Rates[res] != rate {
					t.Errorf("%s: %s != %s", res, got.Rates[res], rate)
				}
			}
			if got.Icon != "keep" || len(got.Resolutions) != 1 || got.Resolutions[0] != "1080p" {
				t.Fatalf("unrelated config overwritten: %s", raw)
			}
			for _, v := range []struct{ source, billed float64 }{{0.2, tc.minimum}, {5.132, 6}, {600.1, 600}, {0, 0}, {math.Inf(1), 0}} {
				if got := UpscaleBilledSeconds(raw, v.source); got != v.billed {
					t.Errorf("duration %v: got %v, want %v", v.source, got, v.billed)
				}
			}
		})
	}
	rh, _, _, err := RepricedUpscaleConfig("rh-upscale", "upscale", `{"pricePerSecond":999,"pricePerSecondByResolution":{"1080p":42}}`)
	if err != nil {
		t.Fatal(err)
	}
	var rhConfig struct {
		Rates map[string]string `json:"pricePerSecondByUpscaleModel"`
	}
	if err := json.Unmarshal([]byte(rh), &rhConfig); err != nil {
		t.Fatal(err)
	}
	for resolution, want := range map[string]string{"max": "2", "high": "2", "medium": "1", "low": "1"} {
		if rhConfig.Rates[resolution] != want {
			t.Errorf("RH %s = %s, want %s", resolution, rhConfig.Rates[resolution], want)
		}
	}
	if UpscaleBilledSeconds(rh, 5.132) != 5.132 {
		t.Fatal("RH duration billing changed")
	}
	if strings.Contains(rh, "pricePerSecondByResolution") {
		t.Fatal("stale resolution prices survived")
	}
	for _, key := range []string{"custom-upscaler", "unverified-upscaler"} {
		got, _, changed, err := RepricedUpscaleConfig(key, "upscale", `{"custom":true}`)
		if err != nil || changed || got != `{"custom":true}` {
			t.Fatalf("unknown model changed: %s", key)
		}
	}
	if got := UpscaleBilledSeconds(`{}`, 5.132); got != 5.132 {
		t.Fatal("legacy fractional billing changed")
	}
}

func TestUpscaleMigrationOncePreservesAdminChanges(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&MarketModel{}, &SysConfig{}); err != nil {
		t.Fatal(err)
	}
	rows := []MarketModel{
		{BaseModel: BaseModel{ID: 101}, ModelKey: "wavespeed-ai/video-upscaler", Type: "upscale", Name: "custom name", Config: `{"icon":"keep","pricePerSecond":0.5}`, Status: 2},
		{BaseModel: BaseModel{ID: 102}, ModelKey: "rh-upscale", Type: "upscale", Config: `{"pricePerSecond":30}`},
		{BaseModel: BaseModel{ID: 103}, ModelKey: "wavespeed-ai/video-upscaler", Type: "video", Config: `{"pricePerSecond":77}`},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateUpscalePricing(db); err != nil {
		t.Fatal(err)
	}
	var got MarketModel
	if err := db.First(&got, 101).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.Config, `"1080p":"1"`) || got.Status != 2 || got.Name != "custom name" {
		t.Fatalf("bad migration: %+v", got)
	}
	var rh MarketModel
	if err := db.First(&rh, 102).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rh.Config, `"max":"2"`) {
		t.Fatalf("RH official USD baseline not applied: %s", rh.Config)
	}
	for _, original := range rows[2:] {
		var unchanged MarketModel
		if err := db.First(&unchanged, original.ID).Error; err != nil {
			t.Fatal(err)
		}
		if unchanged.Config != original.Config {
			t.Fatalf("unrelated row changed: %d", original.ID)
		}
	}
	const custom = `{"pricePerSecondByResolution":{"1080p":9}}`
	if err := db.Model(&MarketModel{}).Where("id = ?", 101).Update("config", custom).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateUpscalePricing(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&got, 101).Error; err != nil {
		t.Fatal(err)
	}
	if got.Config != custom {
		t.Fatal("restart overwrote admin price")
	}
}

func TestRHCorrectionAfterEarlierMigrationPreservesOtherPrices(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&MarketModel{}, &SysConfig{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&SysConfig{ConfigKey: upscalePricingMigrationKey, ConfigValue: "done"}).Error; err != nil {
		t.Fatal(err)
	}
	rows := []MarketModel{
		{BaseModel: BaseModel{ID: 101}, ModelKey: "rh-upscale", Type: "upscale", Config: `{"pricePerSecondByResolution":{"1080p":42}}`},
		{BaseModel: BaseModel{ID: 102}, ModelKey: "wavespeed-ai/video-upscaler", Type: "upscale", Config: `{"pricePerSecond":9}`},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateUpscalePricing(db); err != nil {
		t.Fatal(err)
	}
	var got MarketModel
	if err := db.First(&got, 101).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.Config, `"max":"2"`) || strings.Contains(got.Config, "pricePerSecondByResolution") {
		t.Fatalf("RH correction failed: %s", got.Config)
	}
	var other MarketModel
	if err := db.First(&other, 102).Error; err != nil {
		t.Fatal(err)
	}
	if other.Config != rows[1].Config {
		t.Fatal("correction changed another model")
	}
	const custom = `{"pricePerSecondByUpscaleModel":{"max":2,"high":1,"medium":0.9,"low":0.7}}`
	if err := db.Model(&MarketModel{}).Where("id = ?", 101).Update("config", custom).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateUpscalePricing(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&got, 101).Error; err != nil {
		t.Fatal(err)
	}
	if got.Config != custom {
		t.Fatal("RH manual price overwritten on restart")
	}
}

func TestUpscaleMigrationRollsBackAllRowsOnInvalidConfig(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&MarketModel{}, &SysConfig{}); err != nil {
		t.Fatal(err)
	}
	rows := []MarketModel{
		{BaseModel: BaseModel{ID: 101}, ModelKey: "wavespeed-ai/video-upscaler", Type: "upscale", Config: `{}`},
		{BaseModel: BaseModel{ID: 102}, ModelKey: "wavespeed-ai/video-upscaler-pro", Type: "upscale", Config: `broken`},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateUpscalePricing(db); err == nil {
		t.Fatal("expected invalid config error")
	}
	var count int64
	db.Model(&SysConfig{}).Where("config_key = ?", upscalePricingMigrationKey).Count(&count)
	if count != 0 {
		t.Fatal("failed migration left receipt")
	}
	var got MarketModel
	if err := db.First(&got, 101).Error; err != nil {
		t.Fatal(err)
	}
	if got.Config != `{}` {
		t.Fatal("partial price update was not rolled back")
	}
}

func TestWholePointPricingUpgradesFractionalSnapshots(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&MarketModel{}, &SysConfig{}); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"migration.upscalePricing.20261011", "migration.rhUpscaleUSD.20261011"} {
		if err := db.Create(&SysConfig{ConfigKey: key, ConfigValue: "done"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows := []MarketModel{
		{BaseModel: BaseModel{ID: 101}, Type: "upscale", ModelKey: "wavespeed-ai/video-upscaler", Config: `{"pricePerSecondByResolution":{"1080p":"0.504"}}`},
		{BaseModel: BaseModel{ID: 102}, Type: "upscale", ModelKey: "rh-upscale", Config: `{"pricePerSecondByUpscaleModel":{"max":"1.2096","high":"1.008","medium":"0.9072","low":"0.7056"}}`},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateUpscalePricing(db); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id   int
		cell string
	}{{101, `"1080p":"1"`}, {102, `"max":"2"`}} {
		var got MarketModel
		if err := db.First(&got, tc.id).Error; err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(got.Config, tc.cell) {
			t.Fatalf("old receipt blocked integer pricing: %s", got.Config)
		}
	}
}
