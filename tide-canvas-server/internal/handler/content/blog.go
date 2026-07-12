package content

// blog.go — 博客的公开读取面（前台 /blog 列表 + 详情）。写入面在后台
// internal/handler/admin/g2_blog.go（自建文章 CRUD + Telegram 频道同步），
// 两端操作同一张 blog_post 表（LINKAGE）：后台发布/下架即刻反映到前台。

import (
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// ---- VO ----

// BlogPostLiteVO is the list card projection（无正文，列表页不拉 longtext）.
type BlogPostLiteVO struct {
	ID          idgen.ID `json:"id"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	CoverURL    string   `json:"coverUrl"`
	Source      string   `json:"source"` // self | telegram
	ViewCount   int64    `json:"viewCount"`
	PublishedAt string   `json:"publishedAt"`
}

// BlogPostVO is the full detail projection.
type BlogPostVO struct {
	BlogPostLiteVO
	Content string `json:"content"` // Markdown
}

// BlogListQuery binds the public list pagination.
type BlogListQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

func (q *BlogListQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 12
	}
	if q.PageSize > 50 {
		q.PageSize = 50
	}
}

func (q *BlogListQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// ---- handler ----

// blogList handles GET /api/blog/posts (public). 仅已发布，按发布时间倒序。
func (h *handler) blogList(c *gin.Context) {
	var q BlogListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()
	vos, total, err := h.svc.blogList(&q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load blog posts")
		return
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// blogDetail handles GET /api/blog/posts/:id (public). 草稿对外 404。
func (h *handler) blogDetail(c *gin.Context) {
	id, err := idgen.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid id")
		return
	}
	vo, err := h.svc.blogDetail(id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Fail(c, response.CodeNotFound, "文章不存在或已下架")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load blog post")
		return
	}
	response.OK(c, vo)
}

// ---- service ----

func (s *service) blogList(q *BlogListQuery) ([]BlogPostLiteVO, int64, error) {
	rows, total, err := s.repo.publishedBlogPosts(q.PageSize, q.offset())
	if err != nil {
		return nil, 0, err
	}
	vos := make([]BlogPostLiteVO, len(rows))
	for i := range rows {
		vos[i] = toBlogLiteVO(&rows[i])
	}
	return vos, total, nil
}

func (s *service) blogDetail(id idgen.ID) (*BlogPostVO, error) {
	row, err := s.repo.publishedBlogPost(id)
	if err != nil {
		return nil, err
	}
	// 阅读数：fire-and-forget 自增，失败不影响读取。
	s.repo.bumpBlogView(id)
	vo := &BlogPostVO{BlogPostLiteVO: toBlogLiteVO(row), Content: row.Content}
	return vo, nil
}

func toBlogLiteVO(p *model.BlogPost) BlogPostLiteVO {
	published := ""
	if p.PublishedAt != nil && !p.PublishedAt.IsZero() {
		published = p.PublishedAt.Format(time.RFC3339)
	}
	return BlogPostLiteVO{
		ID:          p.ID,
		Title:       p.Title,
		Summary:     p.Summary,
		CoverURL:    p.CoverURL,
		Source:      p.Source,
		ViewCount:   p.ViewCount,
		PublishedAt: published,
	}
}

// ---- repo ----

// publishedBlogPosts pages the published posts, newest first. 列表查询排除
// content 列（longtext），卡片用不到且避免大字段扫描。
func (r *repo) publishedBlogPosts(limit, offset int) ([]model.BlogPost, int64, error) {
	tx := r.db.Model(&model.BlogPost{}).Where("status = ?", model.BlogStatusPublished)
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.BlogPost
	err := tx.Omit("content").
		Order("published_at DESC, id DESC").
		Limit(limit).Offset(offset).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// publishedBlogPost loads one published post (draft → ErrNotFound).
func (r *repo) publishedBlogPost(id idgen.ID) (*model.BlogPost, error) {
	var row model.BlogPost
	err := r.db.Where("id = ? AND status = ?", id, model.BlogStatusPublished).
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &row, nil
}

// bumpBlogView increments the view counter (best-effort).
func (r *repo) bumpBlogView(id idgen.ID) {
	r.db.Model(&model.BlogPost{}).Where("id = ?", id).
		UpdateColumn("view_count", gorm.Expr("view_count + 1"))
}
