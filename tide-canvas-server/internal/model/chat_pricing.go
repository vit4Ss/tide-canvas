package model

import (
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/pkg/tokenbilling"
)

// User-supplied screenshot, 2026-10-13. These are the screenshot's selling
// rates (CNY), not verified official prices. 1 CNY = 10 points; the provider's
// multiplier is applied once by the existing gateway, including cached input.
const DefaultChatPriceMultiplier = "2"
const chatPricingSnapshotKey = "migration.chatReferencePricing.20261013"

var chatReferencePoints = map[string][3]string{
	"gpt-6.1-sol":       {"10", "50", "0.5"},
	"gpt-6-astra":       {"50", "250", "5"},
	"gpt-6-sol":         {"10", "50", "1"},
	"gpt-5.6-sol":       {"25", "150", "2.5"},
	"gpt-5.6-terra":     {"10", "60", "1"},
	"gpt-5.6-luna":      {"1", "6", "0.1"},
	"gpt-5.5":           {"25", "150", "2.5"},
	"codex-auto-review": {"1", "6", "0.1"},
}

func ChatReferencePricing(key string) *tokenbilling.Pricing {
	key = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(key)), "flowinglight/")
	rates, ok := chatReferencePoints[key]
	if !ok {
		return nil
	}
	return &tokenbilling.Pricing{Enabled: true, Input: rates[0], Output: rates[1], CachedInput: rates[2], MaxInput: 131072, MaxOutput: 8192}
}

// Only the three rate fields change. Existing token limits, extra settings and
// explicitly disabled pricing are preserved. Unrecognized models are untouched.
func RepricedChatReference(key, raw string) (string, bool, error) {
	reference := ChatReferencePricing(key)
	if reference == nil {
		return raw, false, nil
	}
	root := map[string]json.RawMessage{}
	if strings.TrimSpace(raw) != "" && strings.TrimSpace(raw) != "null" {
		if err := json.Unmarshal([]byte(raw), &root); err != nil || root == nil {
			return raw, false, fmt.Errorf("invalid chat pricing for %s", key)
		}
	}
	fields := map[string]json.RawMessage{}
	if value := root["tokenPricing"]; len(value) > 0 && string(value) != "null" {
		if err := json.Unmarshal(value, &fields); err != nil || fields == nil {
			return raw, false, fmt.Errorf("invalid token pricing for %s", key)
		}
	}
	for field, rate := range map[string]string{"inputPointsPerMillion": reference.Input, "outputPointsPerMillion": reference.Output, "cachedInputPointsPerMillion": reference.CachedInput} {
		fields[field], _ = json.Marshal(rate)
	}
	if _, exists := fields["enabled"]; !exists {
		fields["enabled"] = json.RawMessage("true")
	}
	root["tokenPricing"], _ = json.Marshal(fields)
	encoded, err := json.Marshal(root)
	if err != nil {
		return raw, false, err
	}
	// Validate constraints even for pricing intentionally switched off.
	fields["enabled"] = json.RawMessage("true")
	root["tokenPricing"], _ = json.Marshal(fields)
	validation, _ := json.Marshal(root)
	if _, err := tokenbilling.Parse(string(validation)); err != nil {
		return raw, false, fmt.Errorf("invalid chat pricing limits for %s: %w", key, err)
	}
	return string(encoded), true, nil
}

// A single atomic migration updates existing suppliers to the requested 2x
// policy and reprices the eight known model IDs. Restart never reapplies it over
// subsequent admin edits. Tasks, usage snapshots and marketplace models stay out
// of this transaction; their billing is independent.
func migrateChatReferencePricing(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		claim := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&SysConfig{ConfigKey: chatPricingSnapshotKey, ConfigValue: "done", Group: ConfigGroupInternal, Description: "聊天供应商倍率 2；截图参考价按 1 元=10 积分换算；2026-10-13"})
		if claim.Error != nil || claim.RowsAffected == 0 {
			return claim.Error
		}
		var providers []ChatProvider
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Order("id").Find(&providers).Error; err != nil {
			return err
		}
		for _, provider := range providers {
			if err := tx.Model(&ChatProvider{}).Where("id = ?", provider.ID).Update("price_multiplier", DefaultChatPriceMultiplier).Error; err != nil {
				return err
			}
		}
		var rows []ChatModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Order("id").Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			pricing, changed, err := RepricedChatReference(row.ModelKey, row.Pricing)
			if err != nil {
				return err
			}
			if changed {
				if err := tx.Model(&ChatModel{}).Where("id = ?", row.ID).Update("pricing", pricing).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}
