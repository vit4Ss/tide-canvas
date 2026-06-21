package admin

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g4_payments.go covers the payments section: order ledger (read-only, all
// users) and payment-channel CRUD. Per the LINKAGE PRINCIPLE the order list
// reads the SAME `order` table the user-facing /api/orders flow writes, so the
// admin sees every real purchase. Pay channels back the `pay_channel` table.

// RegisterPayments mounts the payments-admin routes on the admin-gated group g.
//
// Routes:
//
//	GET    /orders              g4OrderQuery -> PageData<g4OrderVO>
//	GET    /orders/:id          -> g4OrderVO
//	GET    /pay/channels        -> []g4PayChannelVO
//	POST   /pay/channels        g4PayChannelUpsertDTO -> g4PayChannelVO
//	PUT    /pay/channels/:id    g4PayChannelUpsertDTO -> g4PayChannelVO
//	DELETE /pay/channels/:id    -> void
func RegisterPayments(g *gin.RouterGroup, d *app.Deps) {
	h := &g4PaymentsHandler{db: d.DB}

	// /orders + /orders/:id (param only under the static parent — no sibling clash).
	g.GET("/orders", h.listOrders)
	g.GET("/orders/:id", h.getOrder)

	// Pay channels live under the static /pay/channels parent.
	g.GET("/pay/channels", h.listChannels)
	g.POST("/pay/channels", h.createChannel)
	g.PUT("/pay/channels/:id", h.updateChannel)
	g.DELETE("/pay/channels/:id", h.deleteChannel)
}

type g4PaymentsHandler struct {
	db *gorm.DB
}

// ---- VOs ----

// g4OrderVO is the admin order-row view. It carries the buyer block so the
// finance screen can show who paid without a second lookup.
type g4OrderVO struct {
	ID            idgen.ID      `json:"id"`
	OrderNo       string        `json:"orderNo"`
	UserID        idgen.ID      `json:"userId"`
	User          g4OrderUserVO `json:"user"`
	Type          string        `json:"type"`
	PlanID        *idgen.ID     `json:"planId"`
	PackageID     *idgen.ID     `json:"packageId"`
	Amount        float64       `json:"amount"`
	PayMethod     string        `json:"payMethod"`
	TransactionID string        `json:"transactionId"`
	Status        int           `json:"status"`
	PayTime       string        `json:"payTime"`
	CreateTime    string        `json:"createTime"`
}

// g4OrderUserVO is the compact buyer block embedded in an order row.
type g4OrderUserVO struct {
	ID       idgen.ID `json:"id"`
	Username string   `json:"username"`
	Nickname string   `json:"nickname"`
	Avatar   string   `json:"avatar"`
}

// g4PayChannelVO is the admin payment-channel row view.
type g4PayChannelVO struct {
	ID          idgen.ID `json:"id"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Rate        float64  `json:"rate"`
	TodayAmount float64  `json:"todayAmount"`
	Callback    string   `json:"callback"`
	Enabled     bool     `json:"enabled"`
	SortOrder   int      `json:"sortOrder"`
	CreateTime  string   `json:"createTime"`
	UpdateTime  string   `json:"updateTime"`
}

// ---- DTOs ----

// g4OrderQuery is the order-list query: pagination + optional status filter.
type g4OrderQuery struct {
	g4Page
	// Status filters by order status (0 待支付/1 已支付/2 已取消/3 已退款). Use a
	// pointer so an omitted filter returns all statuses (0 is a valid filter).
	Status *int `form:"status"`
}

// g4PayChannelUpsertDTO is the create/update body for a payment channel.
type g4PayChannelUpsertDTO struct {
	Name      string  `json:"name" binding:"required"`
	Type      string  `json:"type" binding:"required"`
	Rate      float64 `json:"rate"`
	Callback  string  `json:"callback"`
	Enabled   *bool   `json:"enabled"`
	SortOrder int     `json:"sortOrder"`
}

// ---- order handlers ----

func (h *g4PaymentsHandler) listOrders(c *gin.Context) {
	var q g4OrderQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.Order{})
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count orders")
		return
	}

	var rows []model.Order
	if err := tx.Order("create_time desc").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list orders")
		return
	}

	users := h.loadUsers(rows)
	vos := make([]g4OrderVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, g4ToOrderVO(&rows[i], users[rows[i].UserID]))
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func (h *g4PaymentsHandler) getOrder(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var row model.Order
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "order not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load order")
		return
	}
	var u model.User
	var up *model.User
	if err := h.db.First(&u, "id = ?", row.UserID).Error; err == nil {
		up = &u
	}
	response.OK(c, g4ToOrderVO(&row, up))
}

// loadUsers batch-loads the buyers for a page of orders, keyed by user id.
func (h *g4PaymentsHandler) loadUsers(orders []model.Order) map[idgen.ID]*model.User {
	out := map[idgen.ID]*model.User{}
	if len(orders) == 0 {
		return out
	}
	idset := map[idgen.ID]struct{}{}
	ids := make([]idgen.ID, 0, len(orders))
	for i := range orders {
		uid := orders[i].UserID
		if _, seen := idset[uid]; !seen {
			idset[uid] = struct{}{}
			ids = append(ids, uid)
		}
	}
	var users []model.User
	if err := h.db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		return out
	}
	for i := range users {
		out[users[i].ID] = &users[i]
	}
	return out
}

// ---- pay-channel handlers ----

func (h *g4PaymentsHandler) listChannels(c *gin.Context) {
	var rows []model.PayChannel
	if err := h.db.Order("sort_order asc, create_time asc").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load channels")
		return
	}
	vos := make([]g4PayChannelVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, g4ToPayChannelVO(&rows[i]))
	}
	response.OK(c, vos)
}

func (h *g4PaymentsHandler) createChannel(c *gin.Context) {
	var dto g4PayChannelUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	row := model.PayChannel{}
	g4ApplyChannel(&row, &dto, true)
	if err := h.db.Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to create channel")
		return
	}
	response.OK(c, g4ToPayChannelVO(&row))
}

func (h *g4PaymentsHandler) updateChannel(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto g4PayChannelUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	var row model.PayChannel
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "channel not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to update channel")
		return
	}
	g4ApplyChannel(&row, &dto, false)
	if err := h.db.Save(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to update channel")
		return
	}
	response.OK(c, g4ToPayChannelVO(&row))
}

func (h *g4PaymentsHandler) deleteChannel(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	if err := h.db.Delete(&model.PayChannel{}, "id = ?", id).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to delete channel")
		return
	}
	response.OK[any](c, nil)
}

// ---- mapping helpers ----

// g4ApplyChannel copies DTO fields onto a pay-channel row. On create, enabled
// defaults to true when omitted; on update an omitted enabled preserves the
// existing value.
func g4ApplyChannel(row *model.PayChannel, dto *g4PayChannelUpsertDTO, create bool) {
	row.Name = dto.Name
	row.Type = dto.Type
	row.Rate = decimal.NewFromFloat(dto.Rate)
	row.Callback = dto.Callback
	row.SortOrder = dto.SortOrder

	if dto.Enabled != nil {
		row.Enabled = *dto.Enabled
	} else if create {
		row.Enabled = true
	}
}

func g4ToOrderVO(o *model.Order, u *model.User) g4OrderVO {
	amount, _ := o.Amount.Float64()
	vo := g4OrderVO{
		ID:            o.ID,
		OrderNo:       o.OrderNo,
		UserID:        o.UserID,
		Type:          o.OrderType,
		PlanID:        o.PlanID,
		PackageID:     o.PackageID,
		Amount:        amount,
		PayMethod:     o.PayMethod,
		TransactionID: o.TransactionID,
		Status:        o.Status,
		CreateTime:    g4FormatTime(o.CreateTime),
	}
	if o.PayTime != nil {
		vo.PayTime = g4FormatTime(*o.PayTime)
	}
	if u != nil {
		vo.User = g4OrderUserVO{
			ID:       u.ID,
			Username: u.Username,
			Nickname: u.Nickname,
			Avatar:   u.Avatar,
		}
	} else {
		vo.User = g4OrderUserVO{ID: o.UserID}
	}
	return vo
}

func g4ToPayChannelVO(p *model.PayChannel) g4PayChannelVO {
	rate, _ := p.Rate.Float64()
	today, _ := p.TodayAmount.Float64()
	return g4PayChannelVO{
		ID:          p.ID,
		Name:        p.Name,
		Type:        p.Type,
		Rate:        rate,
		TodayAmount: today,
		Callback:    p.Callback,
		Enabled:     p.Enabled,
		SortOrder:   p.SortOrder,
		CreateTime:  g4FormatTime(p.CreateTime),
		UpdateTime:  g4FormatTime(p.UpdateTime),
	}
}
