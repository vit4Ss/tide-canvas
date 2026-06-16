package points

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 积分 / 签到 HTTP 层（对齐 PointsController + CheckinController）。
type Handler struct {
	svc Service
	jwt *appjwt.Provider
}

// NewHandler 构造。
func NewHandler(svc Service, jwtProvider *appjwt.Provider) *Handler {
	return &Handler{svc: svc, jwt: jwtProvider}
}

// RegisterRoutes 注册积分与签到路由到给定父组（传入 /api 组）。
// 全部接口需登录（对齐旧 SecurityUtils.getCurrentUserId 取当前用户）。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	// /api/points/*
	points := api.Group("/points")
	points.Use(middleware.JWTAuth(jwtProvider))
	points.GET("/balance", h.balance)
	points.GET("/transactions", h.transactions)

	// /api/checkin/*
	checkin := api.Group("/checkin")
	checkin.Use(middleware.JWTAuth(jwtProvider))
	checkin.POST("", h.checkin)
	checkin.GET("/status", h.checkinStatus)
	checkin.GET("/calendar", h.checkinCalendar)
}

// balance GET /api/points/balance 查询积分余额。
func (h *Handler) balance(c *gin.Context) {
	vo, err := h.svc.GetBalance(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// transactions GET /api/points/transactions 积分交易记录分页。
func (h *Handler) transactions(c *gin.Context) {
	var q TransactionQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	userID := middleware.MustUserID(c)
	records, total, err := h.svc.ListTransactions(userID, &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// checkin POST /api/checkin 每日签到。
func (h *Handler) checkin(c *gin.Context) {
	vo, err := h.svc.Checkin(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// checkinStatus GET /api/checkin/status 今日签到状态。
func (h *Handler) checkinStatus(c *gin.Context) {
	vo, err := h.svc.CheckinStatus(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// checkinCalendar GET /api/checkin/calendar?year=&month= 签到日历。
func (h *Handler) checkinCalendar(c *gin.Context) {
	year, ok1 := parseIntParam(c.Query("year"))
	month, ok2 := parseIntParam(c.Query("month"))
	if !ok1 || !ok2 {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CheckinCalendar(middleware.MustUserID(c), year, month)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// parseIntParam 解析必填整型查询参数（对齐 @RequestParam Integer 的非空约束）。
func parseIntParam(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}
