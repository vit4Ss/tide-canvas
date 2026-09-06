package lobehub

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
	"tidecanvas/internal/pkg/response"
)

func Register(api *gin.RouterGroup, d *app.Deps) {
	var s *service
	if d.Cfg.LobeHub.Enabled {
		var err error
		s, err = newService(d)
		if err != nil {
			logger.L().Error("LobeHub integration is not ready", zap.Error(err))
		}
	}
	api.GET("/lobehub/config", func(c *gin.Context) {
		if s == nil {
			response.OK(c, gin.H{"enabled": false})
			return
		}
		response.OK(c, gin.H{"enabled": true, "url": s.cfg.PublicURL, "gateway": s.mainOrigin + "/api/integrations/v1", "maxConcurrent": s.cfg.MaxConcurrent, "dailyLimit": s.cfg.DailyLimit})
	})
	if s == nil {
		return
	}
	RegisterService(api, s)
}
func RegisterService(api *gin.RouterGroup, s *service) {
	ui := api.Group("/lobehub", middleware.JWTAuth(s.d), middleware.RateLimit(s.d, 30, time.Minute))
	ui.POST("/launch", s.launch)
	ui.POST("/oidc/approve", s.approve)
	ui.GET("/billing", s.billingList(false))
	admin := api.Group("/admin/lobehub-billing", middleware.JWTAuth(s.d), middleware.AdminAccess(s.d), middleware.AdminPerm("admin.points"))
	admin.GET("", s.billingList(true))
	admin.POST("/:id/resolve", s.resolveBilling)
	oidc := api.Group("/lobehub/oidc", middleware.RateLimit(s.d, 120, time.Minute))
	oidc.GET("/.well-known/openid-configuration", s.discovery)
	oidc.GET("/jwks", s.jwks)
	oidc.GET("/authorize", s.authorize)
	oidc.POST("/token", s.token)
	oidc.GET("/userinfo", s.userinfo)
	api.GET("/lobehub/bridge", middleware.RateLimit(s.d, 60, time.Minute), s.bridge)
	api.POST("/lobehub/bind", middleware.RateLimit(s.d, 30, time.Minute), s.bind)
	api.GET("/lobehub/session-check", s.sessionCheck)
	gw := api.Group("/integrations/v1", middleware.UserAPIKeyAuth(s.d.UserKeys), s.gatewayRateLimit())
	gw.GET("/models", s.listModels)
	gw.POST("/chat/completions", s.chat)
}

// Recover expired reservations after crashes. The timeout exceeds the model
// call deadline, so live workers are not refunded underneath an active call.
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
			_ = d.DB.WithContext(ctx).Where("expires_at < ?", time.Now().Add(-24*time.Hour)).Delete(&model.LobeHubGrant{}).Error
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
