package admin

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g2_discover.go is the admin "发现页 / 首页轮播" (discover slots) section.
// LINKAGE: it reads & writes the SAME sys_banner table the public /api/banners
// home banners come from (model.Banner), so editing a slot here immediately
// changes what the home page renders.
//
// A "slot" is a banner row: {title,imageUrl,linkUrl,position,sortOrder,status}.
// Banner.Status semantics: 0 隐藏 (hidden) / 1 显示 (shown).

// RegisterDiscover mounts the admin discover routes on the admin group g
// (already gated by JWTAuth + AdminOnly upstream).
//
//	GET    /discover/slots          DiscoverSlotQuery -> List<DiscoverSlotVO>
//	POST   /discover/slots          DiscoverSlotUpsertDTO -> DiscoverSlotVO
//	PUT    /discover/slots/:id      DiscoverSlotUpsertDTO -> DiscoverSlotVO
//	DELETE /discover/slots/:id      -> void
func RegisterDiscover(g *gin.RouterGroup, d *app.Deps) {
	h := &discoverHandler{db: d.DB}

	dis := g.Group("/discover")
	dis.GET("/slots", h.listSlots)
	dis.POST("/slots", h.createSlot)
	dis.PUT("/slots/:id", h.updateSlot)
	dis.DELETE("/slots/:id", h.deleteSlot)
}

type discoverHandler struct {
	db *gorm.DB
}

// --- VO / DTO ---

// DiscoverSlotVO is the admin row view of a banner / discover slot.
//
//	{id,title,imageUrl,linkUrl,position,sortOrder,status,statusText,createTime,updateTime}
type DiscoverSlotVO struct {
	ID         idgen.ID `json:"id"`
	Title      string   `json:"title"`
	ImageURL   string   `json:"imageUrl"`
	LinkURL    string   `json:"linkUrl"`
	Position   string   `json:"position"`
	SortOrder  int      `json:"sortOrder"`
	Status     int      `json:"status"`
	StatusText string   `json:"statusText"`
	CreateTime string   `json:"createTime"`
	UpdateTime string   `json:"updateTime"`
}

// DiscoverSlotQuery is the optional filter for GET /discover/slots. status is a
// pointer so 0 (隐藏) is a real filter value rather than "unset".
type DiscoverSlotQuery struct {
	Position string `form:"position"`
	Status   *int   `form:"status"`
}

// DiscoverSlotUpsertDTO is the body for create/update of a slot. Pointers on the
// optional numeric fields so an absent field is preserved on update.
type DiscoverSlotUpsertDTO struct {
	Title     string `json:"title" binding:"omitempty,max=128"`
	ImageURL  string `json:"imageUrl" binding:"required,max=512"`
	LinkURL   string `json:"linkUrl" binding:"omitempty,max=512"`
	Position  string `json:"position" binding:"omitempty,max=32"`
	SortOrder *int   `json:"sortOrder"`
	Status    *int   `json:"status"`
}

func toDiscoverSlotVO(m *model.Banner) DiscoverSlotVO {
	return DiscoverSlotVO{
		ID:         m.ID,
		Title:      m.Title,
		ImageURL:   m.ImageURL,
		LinkURL:    m.LinkURL,
		Position:   m.Position,
		SortOrder:  m.SortOrder,
		Status:     m.Status,
		StatusText: g2BannerStatusText(m.Status),
		CreateTime: g2FormatTime(m.CreateTime),
		UpdateTime: g2FormatTime(m.UpdateTime),
	}
}

func g2BannerStatusText(status int) string {
	if status == 1 {
		return "显示"
	}
	return "隐藏"
}

// --- handlers ---

// listSlots handles GET /discover/slots — all banners (every status), so the
// admin sees hidden slots too. Returns a plain list (not paged) ordered the same
// way the public home feed reads them (sort_order asc, newest first).
func (h *discoverHandler) listSlots(c *gin.Context) {
	var q DiscoverSlotQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}

	tx := h.db.Model(&model.Banner{})
	if p := strings.TrimSpace(q.Position); p != "" {
		tx = tx.Where("position = ?", p)
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}

	var rows []model.Banner
	if err := tx.Order("sort_order ASC, create_time DESC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list slots")
		return
	}

	vos := make([]DiscoverSlotVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toDiscoverSlotVO(&rows[i]))
	}
	response.OK(c, vos)
}

func (h *discoverHandler) createSlot(c *gin.Context) {
	var dto DiscoverSlotUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	row := model.Banner{
		Title:    strings.TrimSpace(dto.Title),
		ImageURL: strings.TrimSpace(dto.ImageURL),
		LinkURL:  dto.LinkURL,
		Position: strings.TrimSpace(dto.Position),
		Status:   1,
	}
	if dto.SortOrder != nil {
		row.SortOrder = *dto.SortOrder
	}
	if dto.Status != nil {
		row.Status = *dto.Status
	}

	if err := h.db.Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to create slot")
		return
	}
	response.OK(c, toDiscoverSlotVO(&row))
}

func (h *discoverHandler) updateSlot(c *gin.Context) {
	id, ok := parseDiscoverID(c)
	if !ok {
		return
	}
	var dto DiscoverSlotUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	var row model.Banner
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "slot not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load slot")
		return
	}

	updates := map[string]any{
		"title":     strings.TrimSpace(dto.Title),
		"image_url": strings.TrimSpace(dto.ImageURL),
		"link_url":  dto.LinkURL,
		"position":  strings.TrimSpace(dto.Position),
	}
	if dto.SortOrder != nil {
		updates["sort_order"] = *dto.SortOrder
	}
	if dto.Status != nil {
		updates["status"] = *dto.Status
	}

	if err := h.db.Model(&model.Banner{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to update slot")
		return
	}
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to reload slot")
		return
	}
	response.OK(c, toDiscoverSlotVO(&row))
}

func (h *discoverHandler) deleteSlot(c *gin.Context) {
	id, ok := parseDiscoverID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.Banner{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete slot")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "slot not found")
		return
	}
	response.OK[any](c, nil)
}

// parseDiscoverID extracts and validates the :id path param.
func parseDiscoverID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid slot id")
		return 0, false
	}
	return id, true
}
