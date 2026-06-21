// Package points owns the points / check-in routes (/api/points/*) plus their
// handler/service/repo/dto/vo. It mirrors the project domain's structure and
// conventions (register.go/handler.go/service.go/repo.go/dto.go/vo.go).
package points

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the points routes on the /api group. All routes require
// authentication (JWTAuth) since points are scoped to the current user.
//
// Routes (all auth):
//
//	GET  /api/points/balance   -> BalanceVO            {points,frozen}
//	GET  /api/points/records   PointRecordQuery -> PageData<PointRecordVO>
//	GET  /api/points/checkin   -> CheckinStatusVO      {checkedToday,continuousDays}
//	POST /api/points/checkin   -> CheckinResultVO      {points,continuousDays,rewarded}
//
// The /records (static) and /checkin (static) segments are siblings under the
// static /points parent, with no :param sibling, so gin's static/param routing
// constraint is satisfied.
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB, d.RDB)
	h := newHandler(svc)

	g := api.Group("/points")
	g.Use(middleware.JWTAuth(d))

	g.GET("/balance", h.balance)
	g.GET("/records", h.records)
	g.GET("/checkin", h.checkinStatus)
	g.POST("/checkin", h.checkin)
}
