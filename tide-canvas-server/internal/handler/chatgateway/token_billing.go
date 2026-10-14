package chatgateway

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/tokenbilling"
)

// Record dispatch before performing network I/O. If the process dies anywhere
// before the final outcome checkpoint, recovery must not infer zero consumption
// from the absence of a saved response.
func (s *service) markTokenCallStarted(row *model.ModelGatewayRequest) error {
	if row.BillingMode != "token" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result := s.d.DB.WithContext(ctx).Model(&model.ModelGatewayRequest{}).
		Where("id = ? AND user_id = ? AND status = ? AND upstream_state = ?", row.ID, row.UserID, "pending", "reserved").
		Update("upstream_state", "started")
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("gateway request is no longer awaiting dispatch")
	}
	row.UpstreamState = "started"
	return nil
}

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
		"response_body": frames, "error_code": code, "upstream_state": "finished",
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
		// Legacy rows with saved outcomes remain recoverable. A started call
		// with no outcome (or a legacy row with no dispatch evidence) may already
		// have consumed tokens, so keep its hold for review rather than refund it.
		unknownConsumption := code == "worker_interrupted" && result.ResponseBody == "" && result.UpstreamState != "reserved" && result.UpstreamState != "finished"
		if code == "worker_interrupted" && (result.ResponseBody != "" || result.UpstreamState == "finished") {
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
			actual, err = tokenCallCost(&result, pricing, usage)
			if err != nil || !tokenReservationCovers(&result, actual) {
				usageErr = tokenbilling.ErrLimit
			}
		}
		if pricingErr != nil {
			usageErr = tokenbilling.ErrPricing
		}
		if usageErr != nil {
			if code != "" && !unknownConsumption && !out.hasOutput() && pricingErr == nil && out.usage == nil {
				// No output and no reported usage: cancel the hold. An invalid
				// usage payload still needs review; it does not prove zero work.
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
		var debit, pending int64
		if status != "billing_pending" {
			if err := points.HoldMicros(tx, result.UserID, -result.ReservedMicros); err != nil {
				return err
			}
			var err error
			debit, pending, err = settleTokenWallet(tx, &result, actual)
			if err != nil {
				return err
			}
		}
		updates := map[string]any{"status": status, "response_body": frames, "error_code": code, "cost_micros": actual, "wallet_debit_micros": debit, "pending_after_micros": pending, "upstream_state": "finished"}
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
	return decimal.NewFromInt(micros).Shift(-6).StringFixed(6)
}

func tokenCallCost(row *model.ModelGatewayRequest, pricing *tokenbilling.Pricing, usage *tokenbilling.Usage) (int64, error) {
	switch row.SettlementMode {
	case model.ChatSettlementAccumulated:
		return pricing.AccruedCost(usage, row.MaxOutputTokens)
	case "":
		return pricing.Cost(usage, row.MaxOutputTokens)
	default:
		return 0, tokenbilling.ErrPricing
	}
}

func tokenReservationCovers(row *model.ModelGatewayRequest, cost int64) bool {
	if row.SettlementMode == model.ChatSettlementAccumulated {
		return cost >= 0 && cost <= row.ReservedMicros
	}
	return tokenbilling.ReservationCovers(row.ReservedMicros, cost)
}

// Called only inside the bill's transaction, after releasing its reservation.
func settleTokenWallet(tx *gorm.DB, row *model.ModelGatewayRequest, cost int64) (int64, int64, error) {
	if row.SettlementMode == model.ChatSettlementAccumulated {
		return points.AccrueChatCost(tx, row.UserID, cost, "AI 聊天小数累计扣款："+row.ModelKey, row.ID)
	}
	if row.SettlementMode != "" {
		return 0, 0, tokenbilling.ErrPricing
	}
	err := points.ChangeMicros(tx, row.UserID, -cost, points.ChangeConsume, "AI 聊天 Token 计费："+row.ModelKey, row.ID)
	return cost, 0, err
}

func settledWalletMicros(row *model.ModelGatewayRequest) int64 {
	if row.Status != "success" && row.Status != "partial" {
		return 0
	}
	if row.SettlementMode == model.ChatSettlementAccumulated {
		return row.WalletDebitMicros
	}
	return row.CostMicros
}

// Audit the actual wallet debit (which can include earlier accrued fractions),
// not the legacy per-call field (always zero for token-priced requests), nor
// an unconfirmed amount retained while usage awaits manual review.
func gatewayAuditPointCost(row *model.ModelGatewayRequest) int64 {
	if row.BillingMode != "token" {
		return int64(row.Cost)
	}
	if row.Status != "success" && row.Status != "partial" {
		return 0
	}
	return settledWalletMicros(row) / tokenbilling.Scale
}

func pricingSnapshot(pricing *tokenbilling.Pricing) string {
	raw, _ := json.Marshal(pricing)
	return string(raw)
}

func billingInfo(row *model.ModelGatewayRequest) map[string]any {
	return map[string]any{"mode": "token", "status": row.Status, "requestId": row.ID.String(), "points": tokenCostLabel(settledTokenMicros(row)), "reservedPoints": tokenCostLabel(row.ReservedMicros), "settlementMode": row.SettlementMode, "refundedPoints": tokenCostLabel(row.RefundedCostMicros), "walletRefundedPoints": tokenCostLabel(row.WalletRefundMicros), "deductedPoints": tokenCostLabel(settledWalletMicros(row)), "pendingPointsAfter": tokenCostLabel(row.PendingAfterMicros), "inputTokens": row.InputTokens, "outputTokens": row.OutputTokens, "cachedInputTokens": row.CachedInputTokens, "reasoningTokens": row.ReasoningTokens}
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
