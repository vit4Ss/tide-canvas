package chatgateway

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
)

// Register mounts the gateway. It has no on/off switch of its own: what it
// serves is whatever the operator enabled under 「AI 聊天供应商」, and with
// nothing enabled the model list is simply empty.
func Register(api *gin.RouterGroup, d *app.Deps) {
	s, err := newService(d)
	if err != nil {
		logger.L().Error("chat gateway is not ready", zap.Error(err))
		return
	}
	RegisterService(api, s)
}

func RegisterService(api *gin.RouterGroup, s *service) {
	// The token ledger, for the signed-in user and for the points admin.
	user := api.Group("/chat-gateway", middleware.JWTAuth(s.d), middleware.RateLimit(s.d, 30, time.Minute))
	user.GET("/billing", s.billingList(false))
	user.GET("/usage", s.usageRecords(false))
	usage := api.Group("/admin/chat-gateway-usage", middleware.JWTAuth(s.d), middleware.AdminAccess(s.d), middleware.AdminPerm("admin.models"))
	usage.GET("", s.usageRecords(true))
	admin := api.Group("/admin/chat-gateway-billing", middleware.JWTAuth(s.d), middleware.AdminAccess(s.d), middleware.AdminPerm("admin.points"))
	admin.GET("", s.billingList(true))
	admin.POST("/:id/resolve", s.resolveBilling)
	// The OpenAI-compatible surface, authenticated with the account API key.
	// Chat Completions is the protocol the providers speak; Responses is what
	// Codex speaks, translated here onto the same provider call and the same
	// billing row.
	gw := api.Group("/integrations/v1", middleware.UserAPIKeyAuth(s.d.UserKeys), s.gatewayRateLimit())
	gw.GET("/models", s.listModels)
	gw.POST("/chat/completions", s.chat)
	gw.POST("/responses", s.responses)
}

// StartReconciler recovers expired reservations after crashes. The timeout
// exceeds the model call deadline, so live workers are not refunded underneath
// an active call.
func StartReconciler(ctx context.Context, d *app.Deps) {
	s := &service{d: d}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		var cursor idgen.ID
		for {
			pass, cancel := context.WithTimeout(ctx, 45*time.Second)
			next, err := s.reconcilePage(pass, cursor)
			cancel()
			cursor = next
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				logger.L().Error("gateway recovery scan failed", zap.Error(err))
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// Advance past failed refunds as well as successful ones, then wrap around to
// retry them. A page of deleted accounts or conflicting receipts must not keep
// every later user's expired reservation pending forever.
func (s *service) reconcilePage(ctx context.Context, after idgen.ID) (idgen.ID, error) {
	var rows []model.ModelGatewayRequest
	if err := s.d.DB.WithContext(ctx).Where("status = ? AND expires_at < ? AND id > ?", "pending", time.Now(), after).Order("id ASC").Limit(100).Find(&rows).Error; err != nil {
		return after, err
	}
	for i := range rows {
		if err := ctx.Err(); err != nil {
			return after, err
		}
		if err := s.settleInContext(ctx, &rows[i], "", "worker_interrupted"); err != nil {
			logger.L().Error("gateway recovery failed", zap.String("request", rows[i].ID.String()), zap.Error(err))
		}
		after = rows[i].ID
	}
	if len(rows) < 100 {
		return 0, nil
	}
	return after, nil
}
