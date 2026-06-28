// Package inspiration owns the PUBLIC 灵感 read API (prompt library + curated
// collections), consumed by the user-facing /inspire page. These are the public
// counterparts of the admin curation screens (internal/handler/admin/g2_inspiration),
// reusing the same Collection / PromptLib tables.
//
//	GET    /api/inspiration/prompts           ?pageNum&pageSize&keyword&sort  -> PageData<PromptVO>
//	GET    /api/inspiration/collections       ?pageNum&pageSize&keyword       -> PageData<CollectionVO>
//	POST   /api/inspiration/prompts/:id/adopt                                 -> { adoptions }
package inspiration

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// Register mounts the public inspiration routes on the /api group.
func Register(api *gin.RouterGroup, d *app.Deps) {
	h := &handler{db: d.DB}
	g := api.Group("/inspiration")
	g.GET("/prompts", h.listPrompts)
	g.GET("/collections", h.listCollections)
	// adopt is an unauthenticated counter bump (also the "hot" sort key), so it is
	// rate-limited per IP to blunt scripted inflation / ranking manipulation.
	g.POST("/prompts/:id/adopt", middleware.RateLimit(d, 30, time.Minute), h.adoptPrompt)
}

type handler struct {
	db *gorm.DB
}

// PromptVO is the public prompt-library card.
type PromptVO struct {
	ID         idgen.ID `json:"id"`
	Text       string   `json:"text"`
	Tags       string   `json:"tags"`
	Adoptions  int      `json:"adoptions"`
	CoverURL   string   `json:"coverUrl"`
	CreateTime string   `json:"createTime"`
}

// CollectionVO is the public curated-collection (主题) card.
type CollectionVO struct {
	ID          idgen.ID `json:"id"`
	Title       string   `json:"title"`
	Type        string   `json:"type"`
	CoverURL    string   `json:"coverUrl"`
	Tags        string   `json:"tags"`
	Description string   `json:"description"`
}

type pageQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Sort     string `form:"sort"` // prompts: hot (default) | new
}

func (q *pageQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 24
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.Keyword = strings.TrimSpace(q.Keyword)
	q.Sort = strings.ToLower(strings.TrimSpace(q.Sort))
}

func (q *pageQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// listPrompts returns a page of prompt-library entries. sort=new orders by
// recency; anything else (default) orders by adoptions (most-used first).
func (h *handler) listPrompts(c *gin.Context) {
	var q pageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.PromptLib{})
	if q.Keyword != "" {
		like := "%" + escapeLike(q.Keyword) + "%"
		tx = tx.Where("text LIKE ? OR tags LIKE ?", like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list prompts")
		return
	}

	order := "adoptions DESC, create_time DESC"
	if q.Sort == "new" {
		order = "create_time DESC"
	}
	var rows []model.PromptLib
	if err := tx.Order(order).Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list prompts")
		return
	}

	vos := make([]PromptVO, 0, len(rows))
	for i := range rows {
		p := &rows[i]
		vos = append(vos, PromptVO{
			ID:         p.ID,
			Text:       p.Text,
			Tags:       p.Tags,
			Adoptions:  p.Adoptions,
			CoverURL:   p.CoverURL,
			CreateTime: formatTime(p.CreateTime),
		})
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// listCollections returns a page of VISIBLE curated collections (主题 / 提示词包).
func (h *handler) listCollections(c *gin.Context) {
	var q pageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.Collection{}).Where("visible = ?", true)
	if q.Keyword != "" {
		like := "%" + escapeLike(q.Keyword) + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list collections")
		return
	}

	var rows []model.Collection
	if err := tx.Order("sort_order ASC, create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list collections")
		return
	}

	vos := make([]CollectionVO, 0, len(rows))
	for i := range rows {
		m := &rows[i]
		vos = append(vos, CollectionVO{
			ID:          m.ID,
			Title:       m.Title,
			Type:        m.Type,
			CoverURL:    m.CoverURL,
			Tags:        m.Tags,
			Description: m.Description,
		})
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// adoptPrompt bumps a prompt's adoption counter (called when a user 套用 a prompt
// into the studio) and returns the new count. Public + idempotent-per-call.
func (h *handler) adoptPrompt(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid id")
		return
	}
	if err := h.db.Model(&model.PromptLib{}).Where("id = ?", id).
		UpdateColumn("adoptions", gorm.Expr("adoptions + 1")).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to adopt prompt")
		return
	}
	var p model.PromptLib
	if err := h.db.Select("adoptions").Where("id = ?", id).First(&p).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "prompt not found")
		return
	}
	response.OK(c, gin.H{"adoptions": p.Adoptions})
}

// escapeLike escapes LIKE wildcards so user input matches literally.
func escapeLike(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return r.Replace(s)
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
