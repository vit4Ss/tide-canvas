package admin

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g2_works.go is the admin "作品管理" section. LINKAGE: it reads & writes the
// SAME community_post table the public /explore (community) feed pages use, so
// any status change / deletion here is immediately reflected on the front-end.
//
// CommunityPost.Status semantics (from model.CommunityPost):
//
//	0 待审核 (pending)   1 已发布/上架 (published)   2 已下架 (offline)
//
// "精选" (featured) is not a dedicated column on community_post; it is carried
// in the post's metadata blob (stored in Content as JSON) under "featured":true,
// so the front-end feed can read it without a schema change. Toggling featured
// here rewrites that flag in place while preserving the rest of the metadata.

// RegisterWorks mounts the admin works routes on the admin group g (already
// gated by JWTAuth + AdminOnly upstream).
//
//	GET    /works                  AdminWorkQuery -> PageData<AdminWorkVO>
//	PUT    /works/:id/status       AdminWorkStatusDTO -> AdminWorkVO
//	DELETE /works/:id              -> void
//	GET    /moderation/queue       AdminWorkQuery -> PageData<AdminWorkVO>  (pending only)
//	POST   /moderation/:id/review  AdminModerationReviewDTO -> AdminWorkVO
func RegisterWorks(g *gin.RouterGroup, d *app.Deps) {
	h := &worksHandler{db: d.DB}

	g.GET("/works", h.list)
	g.PUT("/works/:id/status", h.setStatus)
	g.DELETE("/works/:id", h.remove)

	// Moderation queue is just community_post filtered to the pending status.
	g.GET("/moderation/queue", h.moderationQueue)
	g.POST("/moderation/:id/review", h.review)
}

type worksHandler struct {
	db *gorm.DB
}

// --- VOs / DTOs ---

// AdminWorkAuthorVO is the compact author block embedded in an AdminWorkVO.
type AdminWorkAuthorVO struct {
	ID     idgen.ID `json:"id"`
	Name   string   `json:"name"`
	Avatar string   `json:"avatar"`
}

// AdminWorkVO is the admin row view of a community post (a work). It exposes ALL
// statuses (unlike the public feed) plus the moderation/curation fields.
//
//	{id,title,cover,type,cat,model,tags,author{id,name,avatar},
//	 likes,comments,views,featured,status,statusText,createTime,updateTime}
type AdminWorkVO struct {
	ID         idgen.ID          `json:"id"`
	Title      string            `json:"title"`
	Cover      string            `json:"cover"`
	Type       string            `json:"type"`
	Cat        string            `json:"cat"`
	Model      string            `json:"model"`
	Tags       string            `json:"tags"`
	Author     AdminWorkAuthorVO `json:"author"`
	Likes      int               `json:"likes"`
	Comments   int               `json:"comments"`
	Views      int               `json:"views"`
	Featured   bool              `json:"featured"`
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	CreateTime string            `json:"createTime"`
	UpdateTime string            `json:"updateTime"`
}

// AdminWorkQuery is the paged/filter query for GET /works and the moderation
// queue. status is an optional pointer so 0 (待审核) is a real filter value
// rather than "unset".
type AdminWorkQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Type     string `form:"type"`
	Cat      string `form:"cat"`
	Status   *int   `form:"status"`
	Featured *bool  `form:"featured"`
}

func (q *AdminWorkQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.Keyword = strings.TrimSpace(q.Keyword)
	q.Type = strings.ToLower(strings.TrimSpace(q.Type))
	q.Cat = strings.TrimSpace(q.Cat)
}

func (q *AdminWorkQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// AdminWorkStatusDTO is the body for PUT /works/:id/status. status is required
// (0 待审核 / 1 上架 / 2 下架); featured optionally toggles the curation flag.
type AdminWorkStatusDTO struct {
	Status   *int  `json:"status" binding:"required"`
	Featured *bool `json:"featured"`
}

// AdminModerationReviewDTO is the body for POST /moderation/:id/review.
// approve=true publishes (status 1); approve=false takes the post offline
// (status 2). reason is an optional moderator note (not persisted as a column).
type AdminModerationReviewDTO struct {
	Approve *bool  `json:"approve" binding:"required"`
	Reason  string `json:"reason"`
}

// --- handlers ---

// list handles GET /works (all statuses, filterable).
func (h *worksHandler) list(c *gin.Context) {
	var q AdminWorkQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()
	h.respondList(c, &q)
}

// moderationQueue handles GET /moderation/queue: community_post filtered to the
// pending status (待审核 = 0), ignoring any client-supplied status filter.
func (h *worksHandler) moderationQueue(c *gin.Context) {
	var q AdminWorkQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()
	pending := postStatusPending
	q.Status = &pending
	q.Featured = nil
	h.respondList(c, &q)
}

func (h *worksHandler) respondList(c *gin.Context, q *AdminWorkQuery) {
	rows, total, err := h.queryPosts(q)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to list works")
		return
	}
	vos := h.toVOs(rows)
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// setStatus handles PUT /works/:id/status — 上架/下架/审核状态 + 精选 toggle.
func (h *worksHandler) setStatus(c *gin.Context) {
	id, ok := parseWorkID(c)
	if !ok {
		return
	}
	var dto AdminWorkStatusDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	if *dto.Status < 0 || *dto.Status > 2 {
		response.Fail(c, response.CodeBadRequest, "invalid status (expected 0/1/2)")
		return
	}

	post, err := h.findPost(id)
	if err != nil {
		h.failLookup(c, err)
		return
	}

	updates := map[string]any{"status": *dto.Status}
	if dto.Featured != nil {
		post.Content = setFeatured(post.Content, *dto.Featured)
		updates["content"] = post.Content
	}
	if err := h.db.Model(&model.CommunityPost{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to update work status")
		return
	}
	post.Status = *dto.Status

	vo := h.toVO(post, h.author(post.UserID), h.commentCount(post.ID))
	response.OK(c, vo)
}

// remove handles DELETE /works/:id (soft delete via GORM).
func (h *worksHandler) remove(c *gin.Context) {
	id, ok := parseWorkID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.CommunityPost{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete work")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "work not found")
		return
	}
	response.OK[any](c, nil)
}

// review handles POST /moderation/:id/review (approve -> publish / reject ->
// offline).
func (h *worksHandler) review(c *gin.Context) {
	id, ok := parseWorkID(c)
	if !ok {
		return
	}
	var dto AdminModerationReviewDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	post, err := h.findPost(id)
	if err != nil {
		h.failLookup(c, err)
		return
	}

	newStatus := postStatusOffline
	if *dto.Approve {
		newStatus = postStatusPublished
	}
	if err := h.db.Model(&model.CommunityPost{}).Where("id = ?", id).
		Update("status", newStatus).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to review work")
		return
	}
	post.Status = newStatus

	vo := h.toVO(post, h.author(post.UserID), h.commentCount(post.ID))
	response.OK(c, vo)
}

// --- persistence helpers ---

const (
	postStatusPending   = 0
	postStatusPublished = 1
	postStatusOffline   = 2
)

func (h *worksHandler) queryPosts(q *AdminWorkQuery) ([]model.CommunityPost, int64, error) {
	tx := h.db.Model(&model.CommunityPost{})

	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	// workType() classifies anything that isn't explicitly "video" as 图片, so the
	// 图片 filter must match the same set (incl. rows with no "type" key) — a plain
	// LIKE '%"type":"image"%' would hide those. The OR is wrapped in a grouped
	// sub-condition so it ANDs correctly with the other filters (GORM precedence).
	if q.Type == "video" {
		tx = tx.Where(`content LIKE ?`, `%"type":"video"%`)
	} else if q.Type == "image" {
		tx = tx.Where(h.db.Where(`content NOT LIKE ?`, `%"type":"video"%`).Or(`content IS NULL`))
	}
	if q.Cat != "" {
		tx = tx.Where("content LIKE ?", `%"cat":"`+g2EscapeLike(q.Cat)+`"%`)
	}
	if q.Featured != nil {
		if *q.Featured {
			tx = tx.Where("content LIKE ?", `%"featured":true%`)
		} else {
			tx = tx.Where(h.db.Where(`content NOT LIKE ?`, `%"featured":true%`).Or(`content IS NULL`))
		}
	}
	if q.Keyword != "" {
		like := "%" + g2EscapeLike(q.Keyword) + "%"
		tx = tx.Where("title LIKE ? OR content LIKE ? OR tags LIKE ?", like, like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.CommunityPost
	err := tx.Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (h *worksHandler) findPost(id idgen.ID) (*model.CommunityPost, error) {
	var p model.CommunityPost
	if err := h.db.Where("id = ?", id).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (h *worksHandler) author(userID idgen.ID) *model.User {
	if userID == 0 {
		return nil
	}
	var u model.User
	if err := h.db.Select("id", "username", "nickname", "avatar").
		Where("id = ?", userID).First(&u).Error; err != nil {
		return nil
	}
	return &u
}

func (h *worksHandler) authorsByIDs(ids []idgen.ID) map[idgen.ID]*model.User {
	out := map[idgen.ID]*model.User{}
	if len(ids) == 0 {
		return out
	}
	var users []model.User
	if err := h.db.Select("id", "username", "nickname", "avatar").
		Where("id IN ?", ids).Find(&users).Error; err != nil {
		return out
	}
	for i := range users {
		out[users[i].ID] = &users[i]
	}
	return out
}

func (h *worksHandler) commentCount(postID idgen.ID) int {
	var n int64
	_ = h.db.Model(&model.PostComment{}).
		Where("post_id = ? AND status = ?", postID, 1).Count(&n).Error
	return int(n)
}

func (h *worksHandler) commentCounts(postIDs []idgen.ID) map[idgen.ID]int {
	out := map[idgen.ID]int{}
	if len(postIDs) == 0 {
		return out
	}
	type row struct {
		PostID idgen.ID
		Cnt    int
	}
	var rows []row
	_ = h.db.Model(&model.PostComment{}).
		Select("post_id as post_id, COUNT(*) as cnt").
		Where("post_id IN ? AND status = ?", postIDs, 1).
		Group("post_id").Scan(&rows).Error
	for _, r := range rows {
		out[r.PostID] = r.Cnt
	}
	return out
}

func (h *worksHandler) failLookup(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, response.CodeNotFound, "work not found")
		return
	}
	response.Fail(c, response.CodeServerError, "failed to load work")
}

// --- mapping ---

func (h *worksHandler) toVOs(rows []model.CommunityPost) []AdminWorkVO {
	if len(rows) == 0 {
		return []AdminWorkVO{}
	}
	authorIDs := make([]idgen.ID, 0, len(rows))
	postIDs := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		authorIDs = append(authorIDs, rows[i].UserID)
		postIDs = append(postIDs, rows[i].ID)
	}
	authors := h.authorsByIDs(authorIDs)
	counts := h.commentCounts(postIDs)

	vos := make([]AdminWorkVO, 0, len(rows))
	for i := range rows {
		p := &rows[i]
		vos = append(vos, h.toVO(p, authors[p.UserID], counts[p.ID]))
	}
	return vos
}

func (h *worksHandler) toVO(p *model.CommunityPost, author *model.User, commentCount int) AdminWorkVO {
	m := parseWorkMeta(p.Content)
	return AdminWorkVO{
		ID:         p.ID,
		Title:      p.Title,
		Cover:      p.CoverURL,
		Type:       workType(m),
		Cat:        m.Cat,
		Model:      m.Model,
		Tags:       p.Tags,
		Author:     toWorkAuthorVO(author),
		Likes:      p.LikeCount,
		Comments:   commentCount,
		Views:      p.ViewCount,
		Featured:   m.Featured,
		Status:     p.Status,
		StatusText: workStatusText(p.Status),
		CreateTime: g2FormatTime(p.CreateTime),
		UpdateTime: g2FormatTime(p.UpdateTime),
	}
}

// workMeta mirrors the JSON metadata blob the community feed stores in the
// post's Content column, with the admin-only "featured" curation flag added.
type workMeta struct {
	Type     string `json:"type"`
	Cat      string `json:"cat"`
	Model    string `json:"model"`
	Featured bool   `json:"featured"`
}

func parseWorkMeta(content string) workMeta {
	var m workMeta
	s := strings.TrimSpace(content)
	if s == "" || s[0] != '{' {
		return m
	}
	_ = json.Unmarshal([]byte(s), &m)
	return m
}

// setFeatured rewrites the "featured" flag inside the content metadata blob,
// preserving every other key. If content is not a JSON object it is wrapped into
// a minimal one so the flag round-trips.
func setFeatured(content string, featured bool) string {
	s := strings.TrimSpace(content)
	obj := map[string]any{}
	if s != "" && s[0] == '{' {
		_ = json.Unmarshal([]byte(s), &obj)
	} else if s != "" {
		obj["desc"] = s
	}
	if featured {
		obj["featured"] = true
	} else {
		delete(obj, "featured")
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return content
	}
	return string(b)
}

func workType(m workMeta) string {
	if strings.EqualFold(m.Type, "video") {
		return "video"
	}
	return "image"
}

func workStatusText(status int) string {
	switch status {
	case postStatusPending:
		return "待审核"
	case postStatusPublished:
		return "已发布"
	case postStatusOffline:
		return "已下架"
	default:
		return "未知"
	}
}

func toWorkAuthorVO(u *model.User) AdminWorkAuthorVO {
	if u == nil {
		return AdminWorkAuthorVO{Name: "用户"}
	}
	name := strings.TrimSpace(u.Nickname)
	if name == "" {
		name = strings.TrimSpace(u.Username)
	}
	if name == "" {
		name = "用户"
	}
	return AdminWorkAuthorVO{ID: u.ID, Name: name, Avatar: u.Avatar}
}

// parseWorkID extracts and validates the :id path param.
func parseWorkID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid work id")
		return 0, false
	}
	return id, true
}

// g2FormatTime renders a time as RFC3339, or "" for the zero value. Prefixed to
// avoid colliding with other admin groups' helpers in the same package.
func g2FormatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// g2EscapeLike escapes LIKE wildcards so user input is matched literally.
func g2EscapeLike(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return r.Replace(s)
}
