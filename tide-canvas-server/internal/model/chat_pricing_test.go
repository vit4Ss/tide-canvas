package model

import (
	"encoding/json"
	"testing"

	"github.com/shopspring/decimal"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/pkg/tokenbilling"
)

func TestChatScreenshotRatesConvertAndDoubleExactly(t *testing.T) {
	for _, tc := range []struct{ key, input, output, cached string }{
		{"gpt-6.1-sol", "20", "100", "1"},
		{"gpt-6-astra", "100", "500", "10"},
		{"gpt-6-sol", "20", "100", "2"},
		{"gpt-5.6-sol", "50", "300", "5"},
		{"gpt-5.6-terra", "20", "120", "2"},
		{"gpt-5.6-luna", "2", "12", "0.2"},
		{"gpt-5.5", "50", "300", "5"},
		{"codex-auto-review", "2", "12", "0.2"},
	} {
		t.Run(tc.key, func(t *testing.T) {
			p := ChatReferencePricing(tc.key)
			if p == nil {
				t.Fatal("missing reference rate")
			}
			scaled, err := p.Scaled(decimal.NewFromInt(2))
			if err != nil {
				t.Fatal(err)
			}
			if scaled.Input != tc.input || scaled.Output != tc.output || scaled.CachedInput != tc.cached {
				t.Fatalf("wrong doubled rates: %+v", scaled)
			}
		})
	}
	for _, key := range []string{"gpt-6.1-sol-extra", "claude-sonnet", "grok-4", "gpt-6"} {
		if ChatReferencePricing(key) != nil {
			t.Fatalf("invented a reference price for %s", key)
		}
	}
	p := ChatReferencePricing("gpt-5.6-sol")
	p, _ = p.Scaled(decimal.NewFromInt(2))
	cost, err := p.Cost(&tokenbilling.Usage{Input: 128000, Cached: 12800, Output: 4000}, 8192)
	if err != nil || cost != 8*tokenbilling.Scale {
		t.Fatalf("mixed cached/input/output cost = %d, %v; want ceil(7.024)=8 points", cost, err)
	}
}

func chatPricingDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&SysConfig{}, &ChatProvider{}, &ChatModel{}, &MarketModel{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestChatPricingMigrationIsAtomicAndDoesNotRepeat(t *testing.T) {
	db := chatPricingDB(t)
	provider := ChatProvider{BaseModel: BaseModel{ID: 1}, Name: "provider", Enabled: false, PriceMultiplier: "0.5"}
	const old = `{"other":"preserved","tokenPricing":{"enabled":true,"inputPointsPerMillion":"1300","outputPointsPerMillion":"6500","maxInputTokens":2000,"maxOutputTokens":500}}`
	known := ChatModel{BaseModel: BaseModel{ID: 2}, ProviderID: 1, ModelKey: "gpt-6.1-sol", Pricing: old, Enabled: false, Priority: 7}
	unknown := ChatModel{BaseModel: BaseModel{ID: 3}, ProviderID: 1, ModelKey: "claude-sonnet", Pricing: old, Enabled: true}
	for _, row := range []any{&provider, &known, &unknown} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	generationModel := MarketModel{ModelKey: "gpt-6.1-sol", Type: "text", Name: "generation-only model", Price: decimal.NewFromInt(99), Config: `{"generationOnly":true}`}
	if err := db.Create(&generationModel).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateChatReferencePricing(db); err != nil {
		t.Fatal(err)
	}
	db.First(&provider, "id = 1")
	db.First(&known, "id = 2")
	db.First(&unknown, "id = 3")
	if provider.PriceMultiplier != "2" || provider.Enabled || known.Enabled || known.Priority != 7 {
		t.Fatal("pricing changed routing/publication state or failed to set 2x")
	}
	p, err := tokenbilling.Parse(known.Pricing)
	if err != nil || p.Input != "10" || p.CachedInput != "0.5" || p.MaxInput != 2000 || p.MaxOutput != 500 {
		t.Fatalf("rates or token limits incorrect: %+v %v", p, err)
	}
	var root map[string]any
	_ = json.Unmarshal([]byte(known.Pricing), &root)
	if root["other"] != "preserved" || unknown.Pricing != old {
		t.Fatal("unrelated settings or unknown model rates changed")
	}
	if err := db.First(&generationModel, "id = ?", generationModel.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !generationModel.Price.Equal(decimal.NewFromInt(99)) || generationModel.Config != `{"generationOnly":true}` {
		t.Fatal("chat repricing modified the independent generation model")
	}
	if err := db.Model(&provider).Update("price_multiplier", "3").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&known).Update("pricing", old).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateChatReferencePricing(db); err != nil {
		t.Fatal(err)
	}
	db.First(&provider, "id = 1")
	db.First(&known, "id = 2")
	if provider.PriceMultiplier != "3" || known.Pricing != old {
		t.Fatal("restart undid later admin pricing")
	}
}

func TestChatPricingMigrationRollsBackMalformedKnownModel(t *testing.T) {
	db := chatPricingDB(t)
	p := ChatProvider{BaseModel: BaseModel{ID: 1}, Name: "provider", PriceMultiplier: "0.7"}
	m := ChatModel{BaseModel: BaseModel{ID: 2}, ProviderID: 1, ModelKey: "gpt-6-sol", Pricing: "invalid-json"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateChatReferencePricing(db); err == nil {
		t.Fatal("invalid pricing must roll back atomically")
	}
	db.First(&p, "id = 1")
	var count int64
	db.Model(&SysConfig{}).Where("config_key = ?", chatPricingSnapshotKey).Count(&count)
	if p.PriceMultiplier != "0.7" || count != 0 {
		t.Fatal("partial price change or migration receipt survived rollback")
	}
}
