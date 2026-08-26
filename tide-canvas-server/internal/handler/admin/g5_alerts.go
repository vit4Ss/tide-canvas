package admin

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/pkg/alerting"
	"tidecanvas/internal/pkg/response"
)

func RegisterAlerts(g *gin.RouterGroup, d *app.Deps) {
	g.GET("/alert-channels", listAlertChannels(d))
	g.POST("/alert-channels", createAlertChannel(d))
	g.PUT("/alert-channels/:id", updateAlertChannel(d))
	g.DELETE("/alert-channels/:id", deleteAlertChannel(d))
	g.POST("/alert-channels/:id/test", testAlertChannel(d))
	g.GET("/alert-rules", listAlertRules(d))
	g.POST("/alert-rules", createAlertRule(d))
	g.PUT("/alert-rules/:id", updateAlertRule(d))
	g.DELETE("/alert-rules/:id", deleteAlertRule(d))
	g.GET("/alert-events", listAlertEvents(d))
	g.GET("/alert-events/:id/deliveries", listAlertDeliveries(d))
	g.POST("/alert-deliveries/:id/retry", retryAlertDelivery(d))
}

func requireAlerts(c *gin.Context, d *app.Deps) (*alerting.Service, bool) {
	if d.Alerts == nil {
		response.Fail(c, response.CodeServerError, "alert service unavailable")
		return nil, false
	}
	return d.Alerts, true
}

func listAlertChannels(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		rows, err := s.ListChannels(c.Request.Context())
		if err != nil {
			response.Fail(c, 500, err.Error())
			return
		}
		response.OK(c, rows)
	}
}
func createAlertChannel(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		var dto alerting.ChannelInput
		if c.ShouldBindJSON(&dto) != nil {
			response.Fail(c, 400, "请求参数无效")
			return
		}
		row, err := s.CreateChannel(c.Request.Context(), dto)
		if err != nil {
			alertFail(c, err)
			return
		}
		response.OK(c, row)
	}
}
func updateAlertChannel(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		var dto alerting.ChannelInput
		if c.ShouldBindJSON(&dto) != nil {
			response.Fail(c, 400, "请求参数无效")
			return
		}
		row, err := s.UpdateChannel(c.Request.Context(), id, dto)
		if err != nil {
			alertFail(c, err)
			return
		}
		response.OK(c, row)
	}
}
func deleteAlertChannel(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		if err := s.DeleteChannel(c.Request.Context(), id); err != nil {
			alertFail(c, err)
			return
		}
		response.OK[any](c, nil)
	}
}
func testAlertChannel(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		if err := s.TestChannel(c.Request.Context(), id); err != nil {
			response.Fail(c, 400, "测试发送失败："+err.Error())
			return
		}
		response.OK(c, gin.H{"sent": true})
	}
}

func listAlertRules(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		rows, err := s.ListRules(c.Request.Context())
		if err != nil {
			response.Fail(c, 500, err.Error())
			return
		}
		response.OK(c, rows)
	}
}
func createAlertRule(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		var dto alerting.RuleInput
		if c.ShouldBindJSON(&dto) != nil {
			response.Fail(c, 400, "请求参数无效")
			return
		}
		row, err := s.CreateRule(c.Request.Context(), dto)
		if err != nil {
			alertFail(c, err)
			return
		}
		response.OK(c, row)
	}
}
func updateAlertRule(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		var dto alerting.RuleInput
		if c.ShouldBindJSON(&dto) != nil {
			response.Fail(c, 400, "请求参数无效")
			return
		}
		row, err := s.UpdateRule(c.Request.Context(), id, dto)
		if err != nil {
			alertFail(c, err)
			return
		}
		response.OK(c, row)
	}
}
func deleteAlertRule(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		if err := s.DeleteRule(c.Request.Context(), id); err != nil {
			alertFail(c, err)
			return
		}
		response.OK[any](c, nil)
	}
}

func listAlertEvents(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		var q g5PageQuery
		if c.ShouldBindQuery(&q) != nil {
			response.Fail(c, 400, "查询参数无效")
			return
		}
		q.normalize()
		page, err := s.ListEvents(c.Request.Context(), alerting.EventQuery{PageNum: q.PageNum, PageSize: q.PageSize, Keyword: q.Keyword, Severity: q.Level, Category: q.Module, State: q.Status})
		if err != nil {
			response.Fail(c, 500, err.Error())
			return
		}
		response.Page(c, page.Records, page.Total, page.PageNum, page.PageSize)
	}
}
func listAlertDeliveries(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		rows, err := s.ListDeliveries(c.Request.Context(), id)
		if err != nil {
			response.Fail(c, 500, err.Error())
			return
		}
		response.OK(c, rows)
	}
}
func retryAlertDelivery(d *app.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		s, ok := requireAlerts(c, d)
		if !ok {
			return
		}
		if err := s.RetryDelivery(c.Request.Context(), id); err != nil {
			alertFail(c, err)
			return
		}
		response.OK(c, gin.H{"queued": true})
	}
}

func alertFail(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, 404, "记录不存在")
		return
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		msg = "请求处理失败"
	}
	response.Fail(c, 400, msg)
}
