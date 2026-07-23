// Package skill serves the public 技能广场 read API (JWTAuth-gated):
//
//	GET  /api/skills          SkillQuery -> PageData<SkillVO>(仅上架,按 sortOrder)
//	POST /api/skills/:id/use  -> void(使用计数 +1,best-effort)
//
// 技能内容由后台 /api/admin/skills(admin/g2_skills.go)维护;两端共用
// model.Skill,VO 即模型 JSON 形状(无用户态字段,直接下发)。
package skill

import (
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type handler struct{ db *gorm.DB }

// Register mounts the public skill routes.
func Register(api *gin.RouterGroup, d *app.Deps) {
	h := &handler{db: d.DB}
	g := api.Group("/skills")
	g.Use(middleware.JWTAuth(d))
	g.GET("", h.list)
	g.POST("/:id/use", h.recordUse)
}

func atoiDefault(s string, def int) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	if s == "" {
		return def
	}
	return n
}

// list returns 上架技能,支持分类/输出类型/关键字过滤;排序 sortOrder 升序、新建在前。
func (h *handler) list(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	category := strings.TrimSpace(c.Query("category"))
	outputType := strings.TrimSpace(c.Query("outputType"))
	pageNum := atoiDefault(c.Query("pageNum"), 1)
	pageSize := atoiDefault(c.Query("pageSize"), 24)
	if pageNum < 1 {
		pageNum = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}

	tx := h.db.Model(&model.Skill{}).Where("status = 1")
	if category != "" {
		tx = tx.Where("category = ?", category)
	}
	if outputType != "" {
		tx = tx.Where("output_type = ?", outputType)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ?", like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skills")
		return
	}
	var rows []model.Skill
	if err := tx.Order("sort_order ASC, id DESC").
		Offset((pageNum - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list skills")
		return
	}
	response.Page(c, rows, total, pageNum, pageSize)
}

// recordUse bumps the skill use counter (best-effort;不存在也返回成功,
// 计数丢失不值得打断生成链路)。
func (h *handler) recordUse(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid skill id")
		return
	}
	_ = h.db.Model(&model.Skill{}).Where("id = ?", id).
		UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error
	response.OK[any](c, nil)
}
