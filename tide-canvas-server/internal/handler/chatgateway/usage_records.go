package chatgateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

const gatewayAPISource = "api_key_chat_provider"

type gatewayRequestMetadataKey struct{}
type gatewayRequestMetadata struct {
	Path, IP string
	Stream   bool
}

// Filter immutable provenance, never the current model catalogue. Renaming or
// deleting providers must not change history or pull in market_model calls.
func (s *service) usageRecords(admin bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		c.Header("Vary", "Authorization")
		uid := middleware.CurrentUserID(c)
		if uid == 0 {
			response.Fail(c, 401, "请先登录")
			return
		}
		// Recheck the live account; an old super-admin JWT must not expose all
		// users after demotion, nor may a disabled account read private history.
		var owner model.User
		if err := s.d.DB.WithContext(c.Request.Context()).Select("id", "role", "role_id", "status").First(&owner, "id = ?", uid).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, 403, "当前账号不可用")
			} else {
				response.Fail(c, 503, "暂时无法校验账号状态")
			}
			return
		}
		allowed := !admin
		if admin && owner.Status == 1 {
			for _, p := range model.AdminPermsForUser(s.d.DB.WithContext(c.Request.Context()), &owner) {
				if p == "admin.models" {
					allowed = true
					break
				}
			}
		}
		if owner.Status != 1 || !allowed {
			response.Fail(c, 403, "没有查看调用记录的权限")
			return
		}
		if expected := c.Query("accountId"); expected != "" && expected != uid.String() {
			response.Fail(c, 409, "登录账号已变化，请刷新后查看")
			return
		}
		page, err := boundedQueryInt(c, "pageNum", 1, 1, 1000000)
		if err != nil {
			response.Fail(c, 400, err.Error())
			return
		}
		size, err := boundedQueryInt(c, "pageSize", 20, 1, 100)
		if err != nil {
			response.Fail(c, 400, err.Error())
			return
		}
		q := s.d.DB.WithContext(c.Request.Context()).Model(&model.ModelGatewayRequest{}).
			Where("source = ? AND billing_mode = ?", gatewayAPISource, "token")
		if !admin {
			q = q.Where("user_id = ?", uid)
		} else if raw := c.Query("userId"); raw != "" {
			id, err := idgen.Parse(raw)
			if err != nil || id == 0 {
				response.Fail(c, 400, "用户 ID 无效")
				return
			}
			q = q.Where("user_id = ?", id)
		}
		if value := strings.TrimSpace(c.Query("model")); value != "" {
			if len([]rune(value)) > 128 {
				response.Fail(c, 400, "模型名称过长")
				return
			}
			escaped := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(value)
			q = q.Where("model_key LIKE ? ESCAPE '!'", "%"+escaped+"%")
		}
		if value := c.Query("status"); value != "" {
			switch value {
			case "pending", "success", "partial", "billing_pending", "released", "failed":
				q = q.Where("status = ?", value)
			default:
				response.Fail(c, 400, "调用状态无效")
				return
			}
		}
		if value := c.Query("protocol"); value != "" {
			switch value {
			case "responses":
				q = q.Where("request_path = ?", "/api/integrations/v1/responses")
			case "chat":
				q = q.Where("request_path = ?", "/api/integrations/v1/chat/completions")
			default:
				response.Fail(c, 400, "调用协议无效")
				return
			}
		}
		if value := c.Query("stream"); value != "" {
			if value != "true" && value != "false" {
				response.Fail(c, 400, "响应方式无效")
				return
			}
			q = q.Where("stream = ?", value == "true")
		}
		zone := time.FixedZone("Asia/Shanghai", 8*3600)
		var dates [2]time.Time
		for i, field := range []string{"startDate", "endDate"} {
			if raw := c.Query(field); raw != "" {
				value, err := time.ParseInLocation("2006-01-02", raw, zone)
				if err != nil {
					response.Fail(c, 400, "日期格式应为 YYYY-MM-DD")
					return
				}
				dates[i] = value
				if i == 0 {
					q = q.Where("create_time >= ?", value.In(time.Local))
				} else {
					q = q.Where("create_time < ?", value.AddDate(0, 0, 1).In(time.Local))
				}
			}
		}
		if !dates[0].IsZero() && !dates[1].IsZero() && dates[0].After(dates[1]) {
			response.Fail(c, 400, "开始日期不能晚于结束日期")
			return
		}
		// Administrative refunds use the same durable billing reference. Read
		// their actual ledger values; do not rewrite the original settled cost.
		const refundAmountSQL = `COALESCE((SELECT SUM(CASE WHEN p.amount_micros IS NOT NULL THEN p.amount_micros ELSE CAST(p.amount AS DECIMAL(30,0))*1000000 END)
			FROM point_record p WHERE p.ref_id = model_gateway_request.id AND p.user_id = model_gateway_request.user_id AND p.change_type = 'refund'
			AND (p.amount_micros > 0 OR (p.amount_micros IS NULL AND p.amount > 0))),0)`
		netAmountSQL := "CASE WHEN " + refundAmountSQL + " >= cost_micros THEN 0 ELSE cost_micros - " + refundAmountSQL + " END"
		var totals struct{ Calls, CostMicros, InputTokens, OutputTokens, CachedInputTokens, Pending int64 }
		err = q.Session(&gorm.Session{}).Select(`COUNT(*) AS calls,
			COALESCE(SUM(CASE WHEN status IN ('success','partial') THEN ` + netAmountSQL + ` ELSE 0 END),0) AS cost_micros,
			COALESCE(SUM(CASE WHEN usage_known = true THEN input_tokens ELSE 0 END),0) AS input_tokens,
			COALESCE(SUM(CASE WHEN usage_known = true THEN output_tokens ELSE 0 END),0) AS output_tokens,
			COALESCE(SUM(CASE WHEN usage_known = true THEN cached_input_tokens ELSE 0 END),0) AS cached_input_tokens,
			COALESCE(SUM(CASE WHEN status IN ('pending','billing_pending') THEN 1 ELSE 0 END),0) AS pending`).Scan(&totals).Error
		if err != nil {
			response.Fail(c, 503, "暂时无法读取调用记录")
			return
		}
		var rows []model.ModelGatewayRequest
		// Do not load long responses or request fingerprints into this list.
		err = q.Session(&gorm.Session{}).Omit("response_body", "request_key", "body_hash", "billing_resolution").
			Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error
		if err != nil {
			response.Fail(c, 503, "暂时无法读取调用记录")
			return
		}
		ids := make([]idgen.ID, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
		}
		var refunded []struct {
			RefID  idgen.ID
			UserID idgen.ID
			Micros int64
		}
		if len(ids) > 0 {
			err = s.d.DB.WithContext(c.Request.Context()).Unscoped().Model(&model.PointRecord{}).
				Select("ref_id, user_id, SUM(CASE WHEN amount_micros IS NOT NULL THEN amount_micros ELSE CAST(amount AS DECIMAL(30,0))*1000000 END) AS micros").
				Where("ref_id IN ? AND change_type = ? AND (amount_micros > 0 OR (amount_micros IS NULL AND amount > 0))", ids, "refund").Group("ref_id, user_id").Scan(&refunded).Error
			if err != nil {
				response.Fail(c, 503, "暂时无法核对退款记录")
				return
			}
		}
		refunds := map[[2]idgen.ID]int64{}
		for _, r := range refunded {
			refunds[[2]idgen.ID{r.UserID, r.RefID}] = r.Micros
		}
		items := make([]gin.H, 0, len(rows))
		for _, row := range rows {
			returned := refunds[[2]idgen.ID{row.UserID, row.ID}]
			charged := settledTokenMicros(&row)
			var pricing any
			_ = json.Unmarshal([]byte(row.PricingSnapshot), &pricing)
			item := gin.H{
				"pricing": pricing,
				"id":      row.ID, "model": row.ModelKey, "modelName": row.ModelName,
				"keyRevision": row.KeyRevision, "keyHint": row.KeyHint,
				"requestPath": row.RequestPath, "stream": row.Stream, "status": row.Status,
				"points": tokenCostLabel(charged), "reservedPoints": tokenCostLabel(row.ReservedMicros),
				"refundedPoints": tokenCostLabel(returned), "netPoints": tokenCostLabel(max(0, charged-returned)),
				"inputTokens": row.InputTokens, "outputTokens": row.OutputTokens,
				"cachedInputTokens": row.CachedInputTokens, "reasoningTokens": row.ReasoningTokens,
				"usageKnown": row.UsageKnown, "durationMs": row.DurationMs, "firstTokenMs": row.FirstTokenMs,
				"createTime": row.CreateTime, "errorCode": row.ErrorCode, "priceMultiplier": row.PriceMultiplier,
			}
			if admin {
				item["userId"], item["clientIP"] = row.UserID, row.ClientIP
				item["providerName"], item["providerId"] = row.ProviderName, row.ProviderID
				item["billingProviderName"] = row.BillingProviderName
				item["endpointId"], item["upstreamStatus"] = row.EndpointID, row.UpstreamStatus
			}
			items = append(items, item)
		}
		response.OK(c, gin.H{"records": items, "total": totals.Calls, "pageNum": page, "pageSize": size,
			"pages": (totals.Calls + int64(size) - 1) / int64(size), "summary": gin.H{
				"calls": totals.Calls, "points": tokenCostLabel(totals.CostMicros), "inputTokens": totals.InputTokens,
				"outputTokens": totals.OutputTokens, "cachedInputTokens": totals.CachedInputTokens, "pending": totals.Pending,
			}})
	}
}

func boundedQueryInt(c *gin.Context, key string, fallback, min, max int) (int, error) {
	raw := c.Query(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return 0, fmt.Errorf("%s 超出有效范围", key)
	}
	return n, nil
}
