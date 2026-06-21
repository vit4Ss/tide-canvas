package admin

// g3_floors.go (group g3) owns the admin 首页楼层 (home-floor) management surface.
// It is the single source of truth for the home_floor table: the front-end home
// page can later read these same rows to render its layout, so admin edits here
// drive the public home. CRUD plus an explicit reorder endpoint.

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// RegisterFloors mounts the admin home-floor routes on the (already
// JWTAuth+AdminOnly gated) /admin group.
//
// Routes:
//
//	GET    /admin/home/floors        -> List<HomeFloorVO>   (ordered by sortOrder)
//	POST   /admin/home/floors        HomeFloorCreateDTO -> HomeFloorVO
//	PUT    /admin/home/floors/order  HomeFloorOrderDTO  -> void   (static, declared before :id)
//	PUT    /admin/home/floors/:id    HomeFloorUpdateDTO -> HomeFloorVO
//	DELETE /admin/home/floors/:id    -> void
//
// The static /home/floors/order is registered before the /home/floors/:id param
// route; gin matches static segments first, so they do not conflict.
func RegisterFloors(g *gin.RouterGroup, d *app.Deps) {
	h := &floorsHandler{db: d.DB}

	fl := g.Group("/home/floors")
	fl.GET("", h.list)
	fl.POST("", h.create)
	fl.PUT("/order", h.reorder)
	fl.PUT("/:id", h.update)
	fl.DELETE("/:id", h.remove)
}

type floorsHandler struct {
	db *gorm.DB
}

// ---- VO ----

// HomeFloorVO is the admin view of a home_floor row. `platforms` is exposed as a
// decoded string array (the column stores a JSON array); it is always non-nil so
// it serializes as [] rather than null.
type HomeFloorVO struct {
	ID            idgen.ID `json:"id"`
	Name          string   `json:"name"`
	Subtitle      string   `json:"subtitle"`
	Type          string   `json:"type"`          // banner|works|models|collections...
	ContentSource string   `json:"contentSource"` // manual|auto|tag:xxx
	Count         int      `json:"count"`
	SortOrder     int      `json:"sortOrder"`
	Enabled       bool     `json:"enabled"`
	Layout        string   `json:"layout"` // grid|carousel|list
	Platforms     []string `json:"platforms"`
	CreateTime    string   `json:"createTime"`
	UpdateTime    string   `json:"updateTime"`
}

// ---- DTOs ----

// HomeFloorCreateDTO creates a home floor.
type HomeFloorCreateDTO struct {
	Name          string   `json:"name" binding:"required,max=128"`
	Subtitle      string   `json:"subtitle" binding:"omitempty,max=255"`
	Type          string   `json:"type" binding:"required,max=32"`
	ContentSource string   `json:"contentSource" binding:"omitempty,max=64"`
	Count         *int     `json:"count" binding:"omitempty"`
	SortOrder     *int     `json:"sortOrder" binding:"omitempty"`
	Enabled       *bool    `json:"enabled" binding:"omitempty"`
	Layout        string   `json:"layout" binding:"omitempty,max=32"`
	Platforms     []string `json:"platforms" binding:"omitempty"`
}

// HomeFloorUpdateDTO is a partial update; nil fields are left unchanged.
type HomeFloorUpdateDTO struct {
	Name          *string   `json:"name" binding:"omitempty,max=128"`
	Subtitle      *string   `json:"subtitle" binding:"omitempty,max=255"`
	Type          *string   `json:"type" binding:"omitempty,max=32"`
	ContentSource *string   `json:"contentSource" binding:"omitempty,max=64"`
	Count         *int      `json:"count" binding:"omitempty"`
	SortOrder     *int      `json:"sortOrder" binding:"omitempty"`
	Enabled       *bool     `json:"enabled" binding:"omitempty"`
	Layout        *string   `json:"layout" binding:"omitempty,max=32"`
	Platforms     *[]string `json:"platforms" binding:"omitempty"`
}

// HomeFloorOrderDTO carries the new ordering: a list of floor ids in the desired
// order (index becomes sortOrder), or explicit {id,sortOrder} pairs.
type HomeFloorOrderDTO struct {
	// Ids is the ordered list of floor ids; index 0 gets the lowest sortOrder.
	Ids []string `json:"ids" binding:"omitempty"`
	// Orders is the explicit form used when the caller wants exact sortOrder values.
	Orders []HomeFloorOrderItem `json:"orders" binding:"omitempty"`
}

// HomeFloorOrderItem is one explicit {id,sortOrder} pair.
type HomeFloorOrderItem struct {
	ID        string `json:"id" binding:"required"`
	SortOrder int    `json:"sortOrder"`
}

// ---- Handlers ----

func (h *floorsHandler) list(c *gin.Context) {
	var rows []model.HomeFloor
	if err := h.db.Order("sort_order ASC, create_time ASC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list floors")
		return
	}
	vos := make([]HomeFloorVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toHomeFloorVO(&rows[i]))
	}
	response.OK(c, vos)
}

func (h *floorsHandler) create(c *gin.Context) {
	var dto HomeFloorCreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	f := &model.HomeFloor{
		Name:          strings.TrimSpace(dto.Name),
		Subtitle:      strings.TrimSpace(dto.Subtitle),
		Type:          strings.TrimSpace(dto.Type),
		ContentSource: strings.TrimSpace(dto.ContentSource),
		Layout:        strings.TrimSpace(dto.Layout),
		Enabled:       true,
		Platforms:     encodePlatforms(dto.Platforms),
	}
	if dto.Count != nil {
		f.Count = *dto.Count
	}
	if dto.SortOrder != nil {
		f.SortOrder = *dto.SortOrder
	}
	if dto.Enabled != nil {
		f.Enabled = *dto.Enabled
	}

	if err := h.db.Create(f).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to create floor")
		return
	}
	response.OK(c, toHomeFloorVO(f))
}

func (h *floorsHandler) update(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var dto HomeFloorUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	fields := map[string]any{}
	if dto.Name != nil {
		fields["name"] = strings.TrimSpace(*dto.Name)
	}
	if dto.Subtitle != nil {
		fields["subtitle"] = strings.TrimSpace(*dto.Subtitle)
	}
	if dto.Type != nil {
		fields["type"] = strings.TrimSpace(*dto.Type)
	}
	if dto.ContentSource != nil {
		fields["content_source"] = strings.TrimSpace(*dto.ContentSource)
	}
	if dto.Count != nil {
		fields["count"] = *dto.Count
	}
	if dto.SortOrder != nil {
		fields["sort_order"] = *dto.SortOrder
	}
	if dto.Enabled != nil {
		fields["enabled"] = *dto.Enabled
	}
	if dto.Layout != nil {
		fields["layout"] = strings.TrimSpace(*dto.Layout)
	}
	if dto.Platforms != nil {
		fields["platforms"] = encodePlatforms(*dto.Platforms)
	}

	if len(fields) > 0 {
		res := h.db.Model(&model.HomeFloor{}).Where("id = ?", id).Updates(fields)
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to update floor")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "floor not found")
			return
		}
	}

	var f model.HomeFloor
	if err := h.db.Where("id = ?", id).First(&f).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "floor not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load floor")
		return
	}
	response.OK(c, toHomeFloorVO(&f))
}

func (h *floorsHandler) remove(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.HomeFloor{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete floor")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "floor not found")
		return
	}
	response.OK[any](c, nil)
}

// reorder applies a new ordering. It accepts either `ids` (ordered list; index =>
// sortOrder) or `orders` (explicit {id,sortOrder} pairs). All updates run in one
// transaction so the layout never lands half-reordered.
func (h *floorsHandler) reorder(c *gin.Context) {
	var dto HomeFloorOrderDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	type upd struct {
		id    idgen.ID
		order int
	}
	updates := make([]upd, 0, len(dto.Ids)+len(dto.Orders))
	for i, s := range dto.Ids {
		if id, err := idgen.Parse(strings.TrimSpace(s)); err == nil && id != 0 {
			updates = append(updates, upd{id: id, order: i})
		}
	}
	for _, it := range dto.Orders {
		if id, err := idgen.Parse(strings.TrimSpace(it.ID)); err == nil && id != 0 {
			updates = append(updates, upd{id: id, order: it.SortOrder})
		}
	}
	if len(updates) == 0 {
		response.Fail(c, response.CodeBadRequest, "ids or orders required")
		return
	}

	err := h.db.Transaction(func(tx *gorm.DB) error {
		for _, u := range updates {
			if e := tx.Model(&model.HomeFloor{}).Where("id = ?", u.id).
				Update("sort_order", u.order).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to reorder floors")
		return
	}
	response.OK[any](c, nil)
}

// ---- helpers ----

func toHomeFloorVO(f *model.HomeFloor) HomeFloorVO {
	return HomeFloorVO{
		ID:            f.ID,
		Name:          f.Name,
		Subtitle:      f.Subtitle,
		Type:          f.Type,
		ContentSource: f.ContentSource,
		Count:         f.Count,
		SortOrder:     f.SortOrder,
		Enabled:       f.Enabled,
		Layout:        f.Layout,
		Platforms:     decodePlatforms(f.Platforms),
		CreateTime:    g3FmtTime(f.CreateTime),
		UpdateTime:    g3FmtTime(f.UpdateTime),
	}
}

// encodePlatforms serializes a string slice to a JSON array for the json column.
// A nil/empty slice stores "[]" so reads round-trip to an empty array.
func encodePlatforms(p []string) string {
	if len(p) == 0 {
		return "[]"
	}
	b, err := json.Marshal(p)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// decodePlatforms parses the stored JSON array, always returning a non-nil slice.
func decodePlatforms(raw string) []string {
	out := []string{}
	s := strings.TrimSpace(raw)
	if s == "" || s[0] != '[' {
		return out
	}
	_ = json.Unmarshal([]byte(s), &out)
	if out == nil {
		out = []string{}
	}
	return out
}
