package lobehub

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/tokenbilling"
)

func (s *service) settleTokens(parent context.Context, row *model.ModelGatewayRequest, frames, code string) error {
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	var result model.ModelGatewayRequest
	err := s.d.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&result, "id = ?", row.ID).Error; err != nil {
			return err
		}
		if result.Status != "pending" {
			return nil
		}
		out := parseCompletion(frames)
		usage, usageErr := tokenbilling.ParseUsage(out.usage)
		pricing, pricingErr := tokenbilling.Parse(`{"tokenPricing":` + result.PricingSnapshot + `}`)
		status := "success"
		actual := int64(0)
		if usageErr == nil && pricingErr == nil {
			var err error
			actual, err = pricing.Cost(usage, result.MaxOutputTokens)
			if err != nil || !tokenbilling.ReservationCovers(result.ReservedMicros, actual) {
				usageErr = tokenbilling.ErrLimit
			}
		}
		if pricingErr != nil {
			usageErr = tokenbilling.ErrPricing
		}
		if usageErr != nil {
			if code != "" && !out.hasOutput() && pricingErr == nil && usage == nil {
				// No usable response and no reported consumption: cancel the hold.
				status = "failed"
			} else {
				status = "billing_pending"
				code = "token_usage_unavailable"
			}
		} else if code != "" {
			status = "partial"
			if actual == 0 && !out.hasOutput() {
				status = "failed"
			}
		}
		if status != "billing_pending" {
			if err := points.HoldMicros(tx, result.UserID, -result.ReservedMicros); err != nil {
				return err
			}
			if err := points.ChangeMicros(tx, result.UserID, -actual, points.ChangeConsume, fmt.Sprintf("AI 聊天 Token 计费：%s", result.ModelKey), result.ID); err != nil {
				return err
			}
		}
		updates := map[string]any{"status": status, "response_body": frames, "error_code": code, "cost_micros": actual}
		if usage != nil {
			updates["input_tokens"] = usage.Input
			updates["output_tokens"] = usage.Output
			updates["cached_input_tokens"] = usage.Cached
			updates["reasoning_tokens"] = usage.Reasoning
		}
		if err := tx.Model(&result).Updates(updates).Error; err != nil {
			return err
		}
		return tx.First(&result, "id = ?", row.ID).Error
	})
	if err == nil {
		*row = result
	}
	return err
}

func tokenCostLabel(micros int64) string {
	if micros%tokenbilling.Scale == 0 {
		return fmt.Sprint(micros / tokenbilling.Scale)
	}
	return fmt.Sprintf("%.6f", float64(micros)/float64(tokenbilling.Scale))
}

func pricingSnapshot(pricing *tokenbilling.Pricing) string {
	raw, _ := json.Marshal(pricing)
	return string(raw)
}

func billingInfo(row *model.ModelGatewayRequest) map[string]any {
	return map[string]any{"mode": "token", "status": row.Status, "requestId": row.ID.String(), "points": tokenCostLabel(row.CostMicros), "reservedPoints": tokenCostLabel(row.ReservedMicros), "inputTokens": row.InputTokens, "outputTokens": row.OutputTokens, "cachedInputTokens": row.CachedInputTokens, "reasoningTokens": row.ReasoningTokens}
}

func billingFrame(row *model.ModelGatewayRequest) string {
	if row.BillingMode != "token" {
		return ""
	}
	raw, _ := json.Marshal(map[string]any{"choices": []any{}, "billing": billingInfo(row)})
	return "data: " + string(raw) + "\n\n"
}
