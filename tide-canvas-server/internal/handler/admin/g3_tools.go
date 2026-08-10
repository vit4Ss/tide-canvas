package admin

// g3_tools.go (group g3) owns the admin 智能工具 (AI tools) management surface.
// It edits the SAME ai_tools table the public /api/ai/tools catalog and the
// generate pipeline consume, so an admin edit (提示词/参数/文案/上下线/排序)
// is immediately live on the front-end.
//
// 代码注册能力，配置决定策略：every row corresponds to a code-registered
// generation handler (model.CanonicalAiTools ↔ handler registry), so there is
// deliberately NO create and NO delete here — the admin can retune a tool but
// cannot invent one the backend has no handler for.

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

// RegisterTools mounts the admin AI-tool routes on the (already
// JWTAuth+AdminOnly gated) /admin group.
//
// Routes:
//
//	GET /admin/tools             -> List<AdminToolVO>   (ordered by sortOrder)
//	PUT /admin/tools/order       AdminToolOrderDTO  -> void   (static, declared before :id)
//	PUT /admin/tools/:id         AdminToolUpdateDTO -> AdminToolVO
//	PUT /admin/tools/:id/status  AdminToolStatusDTO -> AdminToolVO
//
// The static /tools/order is registered before the /tools/:id param route; gin
// matches static segments first, so they do not conflict.
func RegisterTools(g *gin.RouterGroup, d *app.Deps) {
	h := &toolsHandler{db: d.DB}

	tl := g.Group("/tools")
	tl.GET("", h.list)
	tl.PUT("/order", h.reorder)
	tl.PUT("/:id", h.update)
	tl.PUT("/:id/status", h.setStatus)
}

type toolsHandler struct {
	db *gorm.DB
}

// ---- VO ----

// AdminToolVO is the admin view of an ai_tools row. Unlike the public
// /api/ai/tools VO it exposes the server-owned presetPrompt and the raw
// extraParams text so the edit form round-trips cleanly. `cover` is the
// decoded CoverHues hue triple (null when unparsable).
type AdminToolVO struct {
	ID      idgen.ID `json:"id"`
	Key     string   `json:"key"`
	Handler string   `json:"handler"`
	// Type 由代码定死(工具处理的素材形态 image|video),后台只读展示。
	Type         string `json:"type"`
	Enabled      bool   `json:"enabled"`
	ShowPage     bool   `json:"showPage"`
	Title        string `json:"title"`
	Desc         string `json:"desc"`
	PresetPrompt string `json:"presetPrompt"`
	ExtraParams  string `json:"extraParams"`
	NeedPrompt   bool   `json:"needPrompt"`
	Hd           bool   `json:"hd"`
	Icon         string `json:"icon"`
	Cover        []int  `json:"cover"`
	Placeholder  string `json:"placeholder"`
	SortOrder    int    `json:"sortOrder"`
	UpdateTime   string `json:"updateTime"`
}

// ---- DTOs ----

// AdminToolUpdateDTO is a partial update; nil fields are left unchanged. key
// and handler are immutable — they bind the row to a code-registered capability.
type AdminToolUpdateDTO struct {
	Title        *string `json:"title" binding:"omitempty,max=64"`
	Desc         *string `json:"desc" binding:"omitempty,max=255"`
	PresetPrompt *string `json:"presetPrompt" binding:"omitempty"`
	ExtraParams  *string `json:"extraParams" binding:"omitempty,max=512"`
	NeedPrompt   *bool   `json:"needPrompt" binding:"omitempty"`
	Hd           *bool   `json:"hd" binding:"omitempty"`
	Icon         *string `json:"icon" binding:"omitempty,max=8"`
	Cover        *[]int  `json:"cover" binding:"omitempty"`
	Placeholder  *string `json:"placeholder" binding:"omitempty,max=255"`
	SortOrder    *int    `json:"sortOrder" binding:"omitempty"`
	Enabled      *bool   `json:"enabled" binding:"omitempty"`
	ShowPage     *bool   `json:"showPage" binding:"omitempty"`
}

// AdminToolOrderDTO carries the new ordering: tool ids in the desired order
// (index becomes sortOrder).
type AdminToolOrderDTO struct {
	Ids []string `json:"ids" binding:"required"`
}

// AdminToolStatusDTO toggles a tool online/offline. Offline (enabled=false)
// both hides the tool from the public catalog and rejects its generations.
type AdminToolStatusDTO struct {
	Enabled *bool `json:"enabled" binding:"required"`
}

// ---- Handlers ----

func (h *toolsHandler) list(c *gin.Context) {
	var rows []model.AiTool
	if err := h.db.Order("sort_order ASC, create_time ASC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list tools")
		return
	}
	vos := make([]AdminToolVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toAdminToolVO(&rows[i]))
	}
	response.OK(c, vos)
}

func (h *toolsHandler) update(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var dto AdminToolUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	fields := map[string]any{}
	if dto.Title != nil {
		t := strings.TrimSpace(*dto.Title)
		if t == "" {
			response.Fail(c, response.CodeBadRequest, "title may not be empty")
			return
		}
		fields["title"] = t
	}
	if dto.Desc != nil {
		fields["desc"] = strings.TrimSpace(*dto.Desc)
	}
	if dto.PresetPrompt != nil {
		fields["preset_prompt"] = *dto.PresetPrompt
	}
	if dto.ExtraParams != nil {
		// "" = 用内建默认；非空必须是 JSON 对象，否则生成链路无从解码。
		s := strings.TrimSpace(*dto.ExtraParams)
		if s != "" {
			m := map[string]any{}
			if json.Unmarshal([]byte(s), &m) != nil {
				response.Fail(c, response.CodeBadRequest, "extraParams must be a JSON object")
				return
			}
		}
		fields["extra_params"] = s
	}
	if dto.NeedPrompt != nil {
		fields["need_prompt"] = *dto.NeedPrompt
	}
	if dto.Hd != nil {
		fields["hd"] = *dto.Hd
	}
	if dto.Icon != nil {
		fields["icon"] = strings.TrimSpace(*dto.Icon)
	}
	if dto.Cover != nil {
		hues := *dto.Cover
		if len(hues) != 3 {
			response.Fail(c, response.CodeBadRequest, "cover must be exactly 3 hues")
			return
		}
		for _, hue := range hues {
			if hue < 0 || hue > 360 {
				response.Fail(c, response.CodeBadRequest, "cover hues must be within 0..360")
				return
			}
		}
		fields["cover_hues"] = encodeToolCover(hues)
	}
	if dto.Placeholder != nil {
		fields["placeholder"] = *dto.Placeholder
	}
	if dto.SortOrder != nil {
		fields["sort_order"] = *dto.SortOrder
	}
	if dto.Enabled != nil {
		fields["enabled"] = *dto.Enabled
	}
	if dto.ShowPage != nil {
		fields["show_page"] = *dto.ShowPage
	}

	if len(fields) > 0 {
		res := h.db.Model(&model.AiTool{}).Where("id = ?", id).Updates(fields)
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to update tool")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "tool not found")
			return
		}
	}
	h.respondByID(c, id)
}

func (h *toolsHandler) setStatus(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var dto AdminToolStatusDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	res := h.db.Model(&model.AiTool{}).Where("id = ?", id).Update("enabled", *dto.Enabled)
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to update status")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "tool not found")
		return
	}
	h.respondByID(c, id)
}

// reorder applies a new ordering: the ids' index becomes sortOrder. All updates
// run in one transaction so the catalog never lands half-reordered.
func (h *toolsHandler) reorder(c *gin.Context) {
	var dto AdminToolOrderDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	type upd struct {
		id    idgen.ID
		order int
	}
	updates := make([]upd, 0, len(dto.Ids))
	for i, s := range dto.Ids {
		if id, err := idgen.Parse(strings.TrimSpace(s)); err == nil && id != 0 {
			updates = append(updates, upd{id: id, order: i})
		}
	}
	if len(updates) == 0 {
		response.Fail(c, response.CodeBadRequest, "ids required")
		return
	}

	err := h.db.Transaction(func(tx *gorm.DB) error {
		for _, u := range updates {
			if e := tx.Model(&model.AiTool{}).Where("id = ?", u.id).
				Update("sort_order", u.order).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to reorder tools")
		return
	}
	response.OK[any](c, nil)
}

// ---- helpers ----

// respondByID reloads the row and writes its VO. Returns 404 when gone.
func (h *toolsHandler) respondByID(c *gin.Context, id idgen.ID) {
	var t model.AiTool
	if err := h.db.Where("id = ?", id).First(&t).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "tool not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load tool")
		return
	}
	response.OK(c, toAdminToolVO(&t))
}

func toAdminToolVO(t *model.AiTool) AdminToolVO {
	return AdminToolVO{
		ID:           t.ID,
		Key:          t.Key,
		Handler:      t.Handler,
		Enabled:      t.Enabled,
		ShowPage:     t.ShowPage,
		Type:         adminToolType(t.Type),
		Title:        t.Title,
		Desc:         t.Desc,
		PresetPrompt: t.PresetPrompt,
		ExtraParams:  t.ExtraParams,
		NeedPrompt:   t.NeedPrompt,
		Hd:           t.Hd,
		Icon:         t.Icon,
		Cover:        decodeToolCover(t.CoverHues),
		Placeholder:  t.Placeholder,
		SortOrder:    t.SortOrder,
		UpdateTime:   g3FmtTime(t.UpdateTime),
	}
}

// encodeToolCover serializes a hue triple to the stored "[h1,h2,h3]" text.
func encodeToolCover(hues []int) string {
	b, err := json.Marshal(hues)
	if err != nil {
		return ""
	}
	return string(b)
}

// adminToolType normalizes a stored ai_tools.type;该列存在之前建的旧行为空串,
// 按图片工具展示(既有工具全是图片形态)。
func adminToolType(t string) string {
	if t == model.AiToolTypeVideo {
		return model.AiToolTypeVideo
	}
	return model.AiToolTypeImage
}

// decodeToolCover parses the stored cover_hues JSON array; nil (serialized as
// null) when empty/unparsable.
func decodeToolCover(raw string) []int {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	var hues []int
	if json.Unmarshal([]byte(s), &hues) != nil || len(hues) == 0 {
		return nil
	}
	return hues
}
