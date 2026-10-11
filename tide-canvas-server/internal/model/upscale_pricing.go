package model

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const upscalePricingMigrationKey = "migration.upscaleWholePoints.20261011"
const rhUpscalePricingMigrationKey = "migration.rhUpscaleWholePoints.20261011"

// Match the ledger's whole-point + micro-point representation; stay exactly
// representable in JSON numbers as well as safe during points-to-micros conversion.
const MaxUpscalePointCost int64 = (math.MaxInt64 - PointScale) / PointScale

// Official rate snapshot, checked 2026-10-11. See docs/video-upscale-pricing.md.
// USD uses the project's fixed pricing FX of 7.2 CNY; the owner specified
// 10 points/CNY and a 40% markup, then rounded UP to whole points/second.
// This is not a live exchange-rate feed.
var upscaleOfficialUSD = map[string]map[string]string{
	"wavespeed-ai/video-upscaler":     {"720p": "0.005", "1080p": "0.005", "2k": "0.01", "4k": "0.02"},
	"bytedance/video-upscaler":        {"1080p": "0.0072", "2k": "0.0144", "4k": "0.0288"},
	"wavespeed-ai/video-upscaler-pro": {"720p": "0.02", "1080p": "0.04", "2k": "0.06", "4k": "0.08"},
}

// RunningHub official pricing screenshot supplied by the owner (USD/second).
// The billing axis is enhancement level, independent of output resolution.
var upscaleRHOfficialUSD = map[string]string{"max": "0.012", "high": "0.01", "medium": "0.009", "low": "0.007"}

// RepricedUpscaleConfig changes only billing fields for the known snapshot.
// It is used by the one-time migration and by first-time catalog imports.
// Existing admin-selected resolutions and all unrelated settings are retained.
func RepricedUpscaleConfig(key, typ, raw string) (string, decimal.Decimal, bool, error) {
	key = strings.ToLower(strings.TrimSpace(key))
	costs, known := upscaleOfficialUSD[key]
	isRH := key == "rh-upscale"
	if isRH {
		costs, known = upscaleRHOfficialUSD, true
	}
	if typ != "upscale" || !known {
		return raw, decimal.Zero, false, nil
	}
	cfg := map[string]json.RawMessage{}
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &cfg); err != nil || cfg == nil {
			return raw, decimal.Zero, false, fmt.Errorf("invalid upscale config for %s", key)
		}
	}
	factor := decimal.RequireFromString("7.2").Mul(decimal.NewFromInt(10)).Mul(decimal.RequireFromString("1.4"))
	rates := map[string]decimal.Decimal{}
	var minimum decimal.Decimal
	for resolution, cost := range costs {
		// Round once, after currency conversion, markup and point conversion.
		// Rounding CNY or USD earlier would distort the configured point price.
		rate := decimal.RequireFromString(cost).Mul(factor).Ceil()
		rates[resolution] = rate
		if minimum.IsZero() || rate.LessThan(minimum) {
			minimum = rate
		}
	}
	if isRH {
		cfg["pricePerSecondByUpscaleModel"], _ = json.Marshal(rates)
		delete(cfg, "pricePerSecondByResolution")
		// Old clients can show the default max rate during a rolling upgrade.
		cfg["pricePerSecond"], _ = json.Marshal(rates["max"])
	} else {
		cfg["pricePerSecondByResolution"], _ = json.Marshal(rates)
		cfg["pricePerSecond"], _ = json.Marshal(minimum)
		minSeconds := 3
		if key == "bytedance/video-upscaler" {
			minSeconds = 1
		}
		cfg["upscaleBilling"], _ = json.Marshal(map[string]any{
			"minimumSeconds": minSeconds, "roundUpSeconds": true, "maximumSeconds": 600,
		})
	}
	var resolutions []string
	_ = json.Unmarshal(cfg["resolutions"], &resolutions)
	if len(resolutions) == 0 {
		for _, resolution := range []string{"720p", "1080p", "2k", "4k"} {
			if _, ok := costs[resolution]; ok || isRH {
				resolutions = append(resolutions, resolution)
			}
		}
		cfg["resolutions"], _ = json.Marshal(resolutions)
	}
	encoded, err := json.Marshal(cfg)
	return string(encoded), minimum.RoundCeil(2), true, err
}

// migrateUpscalePricing atomically updates the authoritative marketplace rows.
// A durable receipt prevents restart/re-sync from undoing later admin pricing.
// No task, order, ledger, publication status or provider configuration is changed.
func migrateUpscalePricing(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		keys := make([]string, 0, len(upscaleOfficialUSD))
		for key := range upscaleOfficialUSD {
			keys = append(keys, key)
		}
		if err := applyUpscalePricingSnapshot(tx, upscalePricingMigrationKey, keys); err != nil {
			return err
		}
		// A separate receipt repairs local installs that ran the earlier RH
		// resolution-based draft, without reapplying the other model prices.
		return applyUpscalePricingSnapshot(tx, rhUpscalePricingMigrationKey, []string{"rh-upscale"})
	})
}

func applyUpscalePricingSnapshot(tx *gorm.DB, receipt string, keys []string) error {
	claim := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&SysConfig{
		ConfigKey: receipt, ConfigValue: "done", Group: ConfigGroupInternal,
		Description: "视频超分 ceil(美元成本 × 7.2 × 10 × 1.4) 整数积分/秒；RH 按增强档位；2026-10-11",
	})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return claim.Error
	}
	var rows []MarketModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("type = ? AND model_key IN ?", "upscale", keys).Order("id").Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		cfg, price, _, err := RepricedUpscaleConfig(row.ModelKey, row.Type, row.Config)
		if err != nil {
			return err
		}
		if err := tx.Model(&MarketModel{}).Where("id = ?", row.ID).
			Updates(map[string]any{"config": cfg, "price": price}).Error; err != nil {
			return err
		}
	}
	return nil
}

// UpscaleBilledSeconds keeps source duration separate from charged duration.
// Unmigrated/custom models retain their existing fractional-duration contract.
func UpscaleBilledSeconds(raw string, seconds float64) float64 {
	if seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0
	}
	var cfg struct {
		Billing struct {
			MinimumSeconds float64 `json:"minimumSeconds"`
			MaximumSeconds float64 `json:"maximumSeconds"`
			RoundUpSeconds bool    `json:"roundUpSeconds"`
		} `json:"upscaleBilling"`
	}
	if json.Unmarshal([]byte(raw), &cfg) != nil {
		return 0
	}
	minimum, maximum := cfg.Billing.MinimumSeconds, cfg.Billing.MaximumSeconds
	if minimum < 0 || maximum < 0 || math.IsNaN(minimum) || math.IsNaN(maximum) || math.IsInf(minimum, 0) || math.IsInf(maximum, 0) || (maximum > 0 && minimum > maximum) {
		return 0
	}
	if cfg.Billing.RoundUpSeconds {
		seconds = math.Ceil(seconds)
	}
	if cfg.Billing.MinimumSeconds > 0 {
		seconds = math.Max(seconds, cfg.Billing.MinimumSeconds)
	}
	if cfg.Billing.MaximumSeconds > 0 {
		seconds = math.Min(seconds, cfg.Billing.MaximumSeconds)
	}
	return seconds
}
