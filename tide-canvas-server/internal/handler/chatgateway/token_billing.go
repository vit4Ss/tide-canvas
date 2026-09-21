package chatgateway

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

// Persist the completed provider response before mutating the wallet. If the
// financial transaction fails, the reconciler can still use authoritative
// usage rather than assume no work happened. This never moves points or
// finalizes the bill, and cannot overwrite a settled/manual-resolution row.
func (s *service) checkpointTokenOutcome(row *model.ModelGatewayRequest, frames, code string) error {
	if row.BillingMode != "token" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return s.d.DB.WithContext(ctx).Model(&model.ModelGatewayRequest{}).
		Where("id = ? AND user_id = ? AND status = ?", row.ID, row.UserID, "pending").Updates(map[string]any{
		"response_body": frames, "error_code": code,
		"duration_ms": row.DurationMs, "first_token_ms": row.FirstTokenMs,
		"provider_id": row.ProviderID, "provider_name": row.ProviderName,
		"endpoint_id": row.EndpointID, "upstream_status": row.UpstreamStatus,
	}).Error
}

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
		if code == "worker_interrupted" && result.ResponseBody != "" {
			frames, code = result.ResponseBody, result.ErrorCode
			if code == "" && !parseCompletion(frames).complete() {
				code = "incomplete_response"
			}
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
				// The calculated candidate was not debited. Keep cost_micros for
				// settled money only, not an amount still awaiting verification.
				actual = 0
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
		// A reconciler has no live timings; never overwrite recorded telemetry
		// with invented zeros when recovering a process interruption.
		if row.DurationMs != nil {
			updates["duration_ms"], updates["first_token_ms"] = row.DurationMs, row.FirstTokenMs
			updates["provider_id"], updates["provider_name"] = row.ProviderID, row.ProviderName
			updates["endpoint_id"], updates["upstream_status"] = row.EndpointID, row.UpstreamStatus
		}
		updates["usage_known"] = usage != nil && usageErr == nil
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

// New gateway charges settle to whole points. Audit the same settled amount,
// not the legacy per-call field (always zero for token-priced requests), nor
// an unconfirmed amount retained while usage awaits manual review.
func gatewayAuditPointCost(row *model.ModelGatewayRequest) int64 {
	if row.BillingMode != "token" {
		return int64(row.Cost)
	}
	if row.Status != "success" && row.Status != "partial" {
		return 0
	}
	return row.CostMicros / tokenbilling.Scale
}

func pricingSnapshot(pricing *tokenbilling.Pricing) string {
	raw, _ := json.Marshal(pricing)
	return string(raw)
}

func billingInfo(row *model.ModelGatewayRequest) map[string]any {
	return map[string]any{"mode": "token", "status": row.Status, "requestId": row.ID.String(), "points": tokenCostLabel(settledTokenMicros(row)), "reservedPoints": tokenCostLabel(row.ReservedMicros), "inputTokens": row.InputTokens, "outputTokens": row.OutputTokens, "cachedInputTokens": row.CachedInputTokens, "reasoningTokens": row.ReasoningTokens}
}

func settledTokenMicros(row *model.ModelGatewayRequest) int64 {
	if row.Status != "success" && row.Status != "partial" {
		return 0
	}
	return row.CostMicros
}

func billingFrame(row *model.ModelGatewayRequest) string {
	if row.BillingMode != "token" {
		return ""
	}
	raw, _ := json.Marshal(map[string]any{"choices": []any{}, "billing": billingInfo(row)})
	return "data: " + string(raw) + "\n\n"
}
