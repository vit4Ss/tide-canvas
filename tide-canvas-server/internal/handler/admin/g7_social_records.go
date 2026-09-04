package admin

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/social"
)

// RegisterSocialRecords mounts the administrator-wide analysis/download audit
// list. Authentication and admin.analysis_records permission are applied by
// the parent group in register.go.
func RegisterSocialRecords(g *gin.RouterGroup, d *app.Deps) {
	g.GET("/social-records", func(c *gin.Context) {
		social.AdminActivityRecords(c, d.DB)
	})
}
