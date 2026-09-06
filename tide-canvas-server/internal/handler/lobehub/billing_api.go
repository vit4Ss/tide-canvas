package lobehub

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/tokenbilling"
)

// errBillNotPending marks a bill another operator already resolved, or one the
// gateway is still streaming — either way this request must not settle it.
var errBillNotPending = errors.New("lobehub: bill is not awaiting review")

func (s *service) billingList(admin bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, _ := strconv.Atoi(c.DefaultQuery("pageNum", "1"))
		size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
		if page < 1 {
			page = 1
		}
		if size < 1 || size > 100 {
			size = 20
		}
		query := s.d.DB.WithContext(c.Request.Context()).Model(&model.ModelGatewayRequest{}).Where("billing_mode = ?", "token")
		if !admin {
			query = query.Where("user_id = ?", middleware.CurrentUserID(c))
		} else if raw := c.Query("userId"); raw != "" {
			uid, err := idgen.Parse(raw)
			if err != nil {
				response.Fail(c, 400, "用户 ID 无效")
				return
			}
			query = query.Where("user_id = ?", uid)
		}
		if status := c.Query("status"); status != "" {
			query = query.Where("status = ?", status)
		}
		var count int64
		if err := query.Count(&count).Error; err != nil {
			response.Fail(c, 503, "暂时无法读取账单")
			return
		}
		var rows []model.ModelGatewayRequest
		if err := query.Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error; err != nil {
			response.Fail(c, 503, "暂时无法读取账单")
			return
		}
		items := make([]gin.H, 0, len(rows))
		for i := range rows {
			r := &rows[i]
			var pricing any
			_ = json.Unmarshal([]byte(r.PricingSnapshot), &pricing)
			items = append(items, gin.H{"id": r.ID, "userId": r.UserID, "keyRevision": r.KeyRevision, "model": r.ModelKey, "status": r.Status, "points": tokenCostLabel(r.CostMicros), "reservedPoints": tokenCostLabel(r.ReservedMicros), "inputTokens": r.InputTokens, "outputTokens": r.OutputTokens, "cachedInputTokens": r.CachedInputTokens, "reasoningTokens": r.ReasoningTokens, "pricing": pricing, "errorCode": r.ErrorCode, "createTime": r.CreateTime, "resolution": r.BillingResolution})
		}
		response.Page(c, items, count, page, size)
	}
}

type billingResolve struct {
	Action    string `json:"action" binding:"required,oneof=release settle"`
	Input     int64  `json:"inputTokens"`
	Output    int64  `json:"outputTokens"`
	Cached    int64  `json:"cachedInputTokens"`
	Reasoning int64  `json:"reasoningTokens"`
	Reason    string `json:"reason" binding:"required,min=4,max=500"`
}

func (s *service) resolveBilling(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil {
		response.Fail(c, 400, "账单 ID 无效")
		return
	}
	var input billingResolve
	if c.ShouldBindJSON(&input) != nil {
		response.Fail(c, 400, "请填写核对结果和至少四个字的处理依据")
		return
	}
	var row model.ModelGatewayRequest
	err = s.d.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ? AND billing_mode = ?", id, "token").Error; err != nil {
			return err
		}
		if row.Status != "billing_pending" {
			return errBillNotPending
		}
		cost := int64(0)
		status := "released"
		if input.Action == "settle" {
			pricing, err := tokenbilling.Parse(`{"tokenPricing":` + row.PricingSnapshot + `}`)
			if err != nil {
				return err
			}
			usage, err := tokenbilling.ParseUsage(map[string]any{"prompt_tokens": input.Input, "completion_tokens": input.Output, "prompt_tokens_details": map[string]any{"cached_tokens": input.Cached}, "completion_tokens_details": map[string]any{"reasoning_tokens": input.Reasoning}})
			if err != nil {
				return err
			}
			cost, err = pricing.Cost(usage, row.MaxOutputTokens)
			if err != nil || cost > row.ReservedMicros {
				return tokenbilling.ErrLimit
			}
			status = "partial"
			if parseCompletion(row.ResponseBody).complete() {
				status = "success"
			}
		}
		if err := points.HoldMicros(tx, row.UserID, -row.ReservedMicros); err != nil {
			return err
		}
		if err := points.ChangeMicros(tx, row.UserID, -cost, points.ChangeConsume, "Token 用量核对结算："+row.ModelKey, row.ID); err != nil {
			return err
		}
		return tx.Model(&row).Updates(map[string]any{"status": status, "cost_micros": cost, "input_tokens": input.Input, "output_tokens": input.Output, "cached_input_tokens": input.Cached, "reasoning_tokens": input.Reasoning, "error_code": "", "billing_resolution": strings.TrimSpace(input.Reason), "billing_resolved_by": middleware.CurrentUserID(c), "billing_resolved_at": time.Now()}).Error
	})
	if err != nil {
		// Only the operator-facing reasons are echoed. Pricing/usage/ORM errors
		// are internal wording and must not become the panel's message.
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			response.Fail(c, response.CodeNotFound, "账单不存在或已被删除")
		case errors.Is(err, errBillNotPending):
			response.Fail(c, response.CodeConflict, "该账单已处理或仍在生成中，请刷新后查看")
		case errors.Is(err, tokenbilling.ErrLimit), errors.Is(err, tokenbilling.ErrUsage):
			response.Fail(c, response.CodeBadRequest, "填写的 Token 用量超出该次调用已预留的计价上限，请核对上游日志")
		case errors.Is(err, tokenbilling.ErrPricing):
			response.Fail(c, response.CodeConflict, "该账单的计价快照已损坏，只能释放预留，无法按用量结算")
		case errors.Is(err, points.ErrInsufficient):
			response.Fail(c, response.CodeConflict, "用户余额不足以完成本次结算，请改为释放预留")
		default:
			response.Fail(c, response.CodeServerError, "账单处理失败，请稍后重试")
		}
		return
	}
	eventlog.Biz(&model.BizLog{UserID: row.UserID, OperatorID: middleware.CurrentUserID(c), Action: "token_billing_resolve", Summary: "核对 Token 账单", RefID: id, RefType: "model_gateway_request", Detail: strings.TrimSpace(input.Reason)})
	response.OK(c, gin.H{"ok": true})
}
