package admin

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g6_logs.go: admin viewers for the structured audit logs written by
// internal/pkg/eventlog — access / login / business / model-call. Each is a
// read-only paged list with the relevant filters, mirroring g5_logs.go.

// RegisterAuditLogs mounts the audit-log routes on the admin group.
//
//	GET /logs/access    (userId?, keyword?, status?)            -> PageData<AccessLogVO>
//	GET /logs/login     (userId?, action?, success?, keyword?)  -> PageData<LoginLogVO>
//	GET /logs/business  (userId?, action?, keyword?)            -> PageData<BizLogVO>
//	GET /logs/model     (userId?, scene?, success?, keyword?)   -> PageData<ModelCallLogVO>
func RegisterAuditLogs(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	g.GET("/logs/access", func(c *gin.Context) { listAccessLogs(c, db) })
	g.GET("/logs/login", func(c *gin.Context) { listLoginLogs(c, db) })
	g.GET("/logs/business", func(c *gin.Context) { listBizLogs(c, db) })
	g.GET("/logs/model", func(c *gin.Context) { listModelLogs(c, db) })
}

// bindAuditQuery binds + normalizes the shared paging/filter query, writing a
// 400 and returning ok=false on a malformed query.
func bindAuditQuery(c *gin.Context) (g5PageQuery, bool) {
	var q g5PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return q, false
	}
	q.normalize()
	return q, true
}

// applyUserFilter adds a user_id filter when a valid numeric id was supplied.
func applyUserFilter(tx *gorm.DB, raw string) *gorm.DB {
	if id, err := idgen.Parse(raw); err == nil && id != 0 {
		return tx.Where("user_id = ?", id)
	}
	return tx
}

// ---- access ----------------------------------------------------------------

// AccessLogVO is the list view of an API access log.
type AccessLogVO struct {
	ID         idgen.ID `json:"id"`
	UserID     idgen.ID `json:"userId"`
	Method     string   `json:"method"`
	Path       string   `json:"path"`
	Query      string   `json:"query"`
	Status     int      `json:"status"`
	LatencyMs  int64    `json:"latencyMs"`
	IP         string   `json:"ip"`
	UserAgent  string   `json:"userAgent"`
	RequestID  string   `json:"requestId"`
	CreateTime string   `json:"createTime"`
}

func listAccessLogs(c *gin.Context, db *gorm.DB) {
	q, ok := bindAuditQuery(c)
	if !ok {
		return
	}
	tx := applyUserFilter(db.Model(&model.AccessLog{}), q.UserID)
	if q.Status != "" {
		tx = tx.Where("status = ?", q.Status)
	}
	if q.Keyword != "" {
		tx = tx.Where("path LIKE ? OR ip LIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count logs")
		return
	}
	var rows []model.AccessLog
	if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list logs")
		return
	}
	vos := make([]AccessLogVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		vos = append(vos, AccessLogVO{
			ID: r.ID, UserID: r.UserID, Method: r.Method, Path: r.Path, Query: r.Query,
			Status: r.Status, LatencyMs: r.LatencyMs, IP: r.IP, UserAgent: r.UserAgent,
			RequestID: r.RequestID, CreateTime: g5FmtTime(r.CreateTime),
		})
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// ---- login -----------------------------------------------------------------

// LoginLogVO is the list view of an authentication event.
type LoginLogVO struct {
	ID         idgen.ID `json:"id"`
	UserID     idgen.ID `json:"userId"`
	Account    string   `json:"account"`
	Action     string   `json:"action"`
	Channel    string   `json:"channel"`
	Success    int      `json:"success"`
	FailReason string   `json:"failReason"`
	IP         string   `json:"ip"`
	UserAgent  string   `json:"userAgent"`
	CreateTime string   `json:"createTime"`
}

func listLoginLogs(c *gin.Context, db *gorm.DB) {
	q, ok := bindAuditQuery(c)
	if !ok {
		return
	}
	tx := applyUserFilter(db.Model(&model.LoginLog{}), q.UserID)
	if q.Action != "" {
		tx = tx.Where("action = ?", q.Action)
	}
	if q.Success != "" {
		tx = tx.Where("success = ?", q.Success)
	}
	if q.Keyword != "" {
		tx = tx.Where("account LIKE ? OR ip LIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count logs")
		return
	}
	var rows []model.LoginLog
	if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list logs")
		return
	}
	vos := make([]LoginLogVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		vos = append(vos, LoginLogVO{
			ID: r.ID, UserID: r.UserID, Account: r.Account, Action: r.Action, Channel: r.Channel,
			Success: r.Success, FailReason: r.FailReason, IP: r.IP, UserAgent: r.UserAgent,
			CreateTime: g5FmtTime(r.CreateTime),
		})
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// ---- business --------------------------------------------------------------

// BizLogVO is the list view of a business event.
type BizLogVO struct {
	ID         idgen.ID `json:"id"`
	UserID     idgen.ID `json:"userId"`
	Action     string   `json:"action"`
	Summary    string   `json:"summary"`
	Amount     string   `json:"amount"`
	Points     int64    `json:"points"`
	RefID      idgen.ID `json:"refId"`
	RefType    string   `json:"refType"`
	OperatorID idgen.ID `json:"operatorId"`
	Detail     string   `json:"detail"`
	CreateTime string   `json:"createTime"`
}

func listBizLogs(c *gin.Context, db *gorm.DB) {
	q, ok := bindAuditQuery(c)
	if !ok {
		return
	}
	tx := applyUserFilter(db.Model(&model.BizLog{}), q.UserID)
	if q.Action != "" {
		tx = tx.Where("action = ?", q.Action)
	}
	if q.Keyword != "" {
		tx = tx.Where("summary LIKE ? OR detail LIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count logs")
		return
	}
	var rows []model.BizLog
	if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list logs")
		return
	}
	vos := make([]BizLogVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		vos = append(vos, BizLogVO{
			ID: r.ID, UserID: r.UserID, Action: r.Action, Summary: r.Summary,
			Amount: r.Amount.String(), Points: r.Points, RefID: r.RefID, RefType: r.RefType,
			OperatorID: r.OperatorID, Detail: r.Detail, CreateTime: g5FmtTime(r.CreateTime),
		})
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// ---- model call ------------------------------------------------------------

// ModelCallLogVO is the list view of an upstream relay model call.
type ModelCallLogVO struct {
	ID             idgen.ID `json:"id"`
	UserID         idgen.ID `json:"userId"`
	Scene          string   `json:"scene"`
	Model          string   `json:"model"`
	Endpoint       string   `json:"endpoint"`
	RequestBody    string   `json:"requestBody"`
	ResponseBody   string   `json:"responseBody"`
	HttpStatus     int      `json:"httpStatus"`
	Success        int      `json:"success"`
	ErrorMsg       string   `json:"errorMsg"`
	DurationMs     int64    `json:"durationMs"`
	UpstreamTaskID string   `json:"upstreamTaskId"`
	Cost           string   `json:"cost"`
	CreateTime     string   `json:"createTime"`
}

func listModelLogs(c *gin.Context, db *gorm.DB) {
	q, ok := bindAuditQuery(c)
	if !ok {
		return
	}
	tx := applyUserFilter(db.Model(&model.ModelCallLog{}), q.UserID)
	if q.Scene != "" {
		tx = tx.Where("scene = ?", q.Scene)
	}
	if q.Success != "" {
		tx = tx.Where("success = ?", q.Success)
	}
	if q.Keyword != "" {
		tx = tx.Where("model LIKE ?", "%"+q.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count logs")
		return
	}
	var rows []model.ModelCallLog
	if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list logs")
		return
	}
	vos := make([]ModelCallLogVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		vos = append(vos, ModelCallLogVO{
			ID: r.ID, UserID: r.UserID, Scene: r.Scene, Model: r.Model, Endpoint: r.Endpoint,
			RequestBody: r.RequestBody, ResponseBody: r.ResponseBody, HttpStatus: r.HttpStatus,
			Success: r.Success, ErrorMsg: r.ErrorMsg, DurationMs: r.DurationMs,
			UpstreamTaskID: r.UpstreamTaskID, Cost: r.Cost, CreateTime: g5FmtTime(r.CreateTime),
		})
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}
