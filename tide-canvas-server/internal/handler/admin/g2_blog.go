package admin

// g2_blog.go (group g2, content management) owns the admin 博客管理 surface:
// 自建文章 CRUD + Telegram 频道源管理与同步。与前台 /blog（内容包 blog.go 的
// 公开读取面）同表同源（LINKAGE）：这里的发布/下架/删除即刻反映到前台列表。
//
// Telegram 同步：抓公开频道网页预览 t.me/s/<username>（internal/pkg/tgfeed），
// 只导入含文字的消息，图片下载后转存到本站对象存储（tg CDN 链接会过期且境内
// 不可达），按 (channel_id, tg_msg_id) 幂等去重——重复同步不会产生重复文章。

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/storage"
	"tidecanvas/internal/pkg/tgfeed"
)

// RegisterBlog mounts the admin blog routes on the (already JWTAuth+AdminOnly
// gated) /admin group.
//
// Routes:
//
//	GET    /admin/blog/posts             -> PageData<AdminBlogPostVO>
//	POST   /admin/blog/posts             BlogPostCreateDTO -> AdminBlogPostVO
//	PUT    /admin/blog/posts/:id         BlogPostUpdateDTO -> AdminBlogPostVO
//	DELETE /admin/blog/posts/:id         -> void
//	GET    /admin/blog/channels          -> []BlogChannelVO
//	POST   /admin/blog/channels          BlogChannelCreateDTO -> BlogChannelVO
//	PUT    /admin/blog/channels/:id      BlogChannelUpdateDTO -> BlogChannelVO
//	DELETE /admin/blog/channels/:id      -> void（仅删频道行，已导入文章保留）
//	POST   /admin/blog/channels/:id/sync -> BlogSyncResultVO
func RegisterBlog(g *gin.RouterGroup, d *app.Deps) {
	h := &blogHandler{
		db:    d.DB,
		store: d.Storage,
		relay: relaychat.New(d.Cfg.Relay.BaseURL, d.Cfg.Relay.APIKey),
	}

	posts := g.Group("/blog/posts")
	posts.GET("", h.listPosts)
	posts.POST("", h.createPost)
	// 编辑弹窗「AI 优化」：去广告引流/理顺文案，结果回填表单（见 g2_blog_ai.go）。
	posts.POST("/ai-polish", h.aiPolish)
	// 批量上架/下架：作用于与列表一致的筛选范围（来源/频道）。
	posts.POST("/batch-status", h.batchStatus)
	posts.PUT("/:id", h.updatePost)
	posts.DELETE("/:id", h.removePost)

	ch := g.Group("/blog/channels")
	ch.GET("", h.listChannels)
	ch.POST("", h.createChannel)
	ch.PUT("/:id", h.updateChannel)
	ch.DELETE("/:id", h.removeChannel)
	ch.POST("/:id/sync", h.syncChannel)
}

type blogHandler struct {
	db    *gorm.DB
	store storage.StorageStrategy
	// relay is the text-model client for「AI 优化」; nil when无中转站密钥。
	relay *relaychat.Client
}

// blogSyncMu serializes channel syncs within this process：并发点两次「同步」
// 会对同一 (channel, msg) 竞态插入重复文章（索引非唯一，见 model/blog.go）。
var blogSyncMu sync.Mutex

// ---- VO / DTO ----

// AdminBlogPostVO is the admin view of a blog_post row（含状态与来源明细）.
type AdminBlogPostVO struct {
	ID        idgen.ID `json:"id"`
	Source    string   `json:"source"` // self | telegram
	ChannelID idgen.ID `json:"channelId"`
	// ChannelTitle/ChannelUsername 标注 telegram 文章的具体来源频道
	//（频道已删除时仍按历史行回填，不留空白）。
	ChannelTitle    string `json:"channelTitle"`
	ChannelUsername string `json:"channelUsername"`
	TgMsgID         int64  `json:"tgMsgId"`
	Title           string `json:"title"`
	Summary         string `json:"summary"`
	CoverURL        string `json:"coverUrl"`
	Content         string `json:"content"`
	Status          int    `json:"status"` // 0 草稿, 1 已发布
	ViewCount       int64  `json:"viewCount"`
	PublishedAt     string `json:"publishedAt"`
	CreateTime      string `json:"createTime"`
	UpdateTime      string `json:"updateTime"`
}

// BlogPostCreateDTO creates a self-written post.
type BlogPostCreateDTO struct {
	Title    string `json:"title" binding:"required,max=255"`
	Summary  string `json:"summary" binding:"omitempty,max=512"`
	CoverURL string `json:"coverUrl" binding:"omitempty,max=1024"`
	Content  string `json:"content" binding:"omitempty"`
	Status   *int   `json:"status" binding:"omitempty,oneof=0 1"`
}

// BlogPostUpdateDTO is a partial update; nil fields are left unchanged. 对
// telegram 来源的文章同样适用（可改标题/摘要/正文/上下架）。
type BlogPostUpdateDTO struct {
	Title    *string `json:"title" binding:"omitempty,max=255"`
	Summary  *string `json:"summary" binding:"omitempty,max=512"`
	CoverURL *string `json:"coverUrl" binding:"omitempty,max=1024"`
	Content  *string `json:"content" binding:"omitempty"`
	Status   *int    `json:"status" binding:"omitempty,oneof=0 1"`
}

// BlogChannelVO is the admin view of a blog_channel row.
type BlogChannelVO struct {
	ID         idgen.ID `json:"id"`
	Username   string   `json:"username"`
	Title      string   `json:"title"`
	Enabled    bool     `json:"enabled"`
	LastMsgID  int64    `json:"lastMsgId"`
	LastSyncAt string   `json:"lastSyncAt"`
	PostCount  int64    `json:"postCount"`
	CreateTime string   `json:"createTime"`
}

// BlogChannelCreateDTO adds a channel source.
type BlogChannelCreateDTO struct {
	// Username 接受 @handle / t.me 链接 / 裸 handle，服务端归一化。
	Username string `json:"username" binding:"required,max=128"`
	Title    string `json:"title" binding:"omitempty,max=128"`
}

// BlogChannelUpdateDTO is a partial update.
type BlogChannelUpdateDTO struct {
	Title   *string `json:"title" binding:"omitempty,max=128"`
	Enabled *bool   `json:"enabled" binding:"omitempty"`
}

// BlogSyncResultVO reports one sync run.
type BlogSyncResultVO struct {
	ChannelTitle string `json:"channelTitle"`
	Created      int    `json:"created"`      // 新导入文章数
	SkippedEmpty int    `json:"skippedEmpty"` // 无文字消息（跳过）
	ImageFailed  int    `json:"imageFailed"`  // 转存失败、保留原 CDN 链接的图片数
}

// ---- posts ----

func (h *blogHandler) listPosts(c *gin.Context) {
	var q g5PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.BlogPost{})
	// Type 复用为来源筛选（self|telegram），Status 为 0|1；channelId 精确到频道。
	if q.Type != "" {
		tx = tx.Where("source = ?", q.Type)
	}
	if q.Status != "" {
		tx = tx.Where("status = ?", q.Status)
	}
	if cid := strings.TrimSpace(c.Query("channelId")); cid != "" {
		if id, err := idgen.Parse(cid); err == nil && id != 0 {
			tx = tx.Where("channel_id = ?", id)
		}
	}
	if q.Keyword != "" {
		kw := "%" + q.Keyword + "%"
		tx = tx.Where("title LIKE ? OR summary LIKE ?", kw, kw)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count posts")
		return
	}
	var rows []model.BlogPost
	if err := tx.Order("COALESCE(published_at, create_time) DESC, id DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list posts")
		return
	}
	// 批量回填来源频道名（Unscoped：频道删除后其历史文章仍标注原频道）。
	chIDs := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		if rows[i].ChannelID != 0 {
			chIDs = append(chIDs, rows[i].ChannelID)
		}
	}
	chName := map[idgen.ID]model.BlogChannel{}
	if len(chIDs) > 0 {
		var chs []model.BlogChannel
		if err := h.db.Unscoped().Where("id IN ?", chIDs).Find(&chs).Error; err == nil {
			for _, ch := range chs {
				chName[ch.ID] = ch
			}
		}
	}

	vos := make([]AdminBlogPostVO, len(rows))
	for i := range rows {
		vos[i] = toAdminBlogPostVO(&rows[i])
		if ch, ok := chName[rows[i].ChannelID]; ok {
			vos[i].ChannelTitle = ch.Title
			vos[i].ChannelUsername = ch.Username
			if vos[i].ChannelTitle == "" {
				vos[i].ChannelTitle = "@" + ch.Username
			}
		}
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// BlogBatchStatusDTO applies a status to every post in the filter scope.
type BlogBatchStatusDTO struct {
	Status    *int   `json:"status" binding:"required,oneof=0 1"`
	Source    string `json:"source" binding:"omitempty,oneof=self telegram"`
	ChannelID string `json:"channelId" binding:"omitempty,max=32"`
}

// batchStatus handles POST /admin/blog/posts/batch-status：全部上架/全部下架。
// 上架时给还没有发布时间的行补 published_at（telegram 文章带原消息时间，
// COALESCE 不覆盖）。
func (h *blogHandler) batchStatus(c *gin.Context) {
	var dto BlogBatchStatusDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	tx := h.db.Model(&model.BlogPost{}).Where("status <> ?", *dto.Status)
	if dto.Source != "" {
		tx = tx.Where("source = ?", dto.Source)
	}
	if cid := strings.TrimSpace(dto.ChannelID); cid != "" {
		id, err := idgen.Parse(cid)
		if err != nil || id == 0 {
			response.Fail(c, response.CodeBadRequest, "invalid channelId")
			return
		}
		tx = tx.Where("channel_id = ?", id)
	}
	fields := map[string]any{"status": *dto.Status}
	if *dto.Status == model.BlogStatusPublished {
		fields["published_at"] = gorm.Expr("COALESCE(published_at, NOW())")
	}
	res := tx.Updates(fields)
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to update posts")
		return
	}
	response.OK(c, gin.H{"updated": res.RowsAffected})
}

func (h *blogHandler) createPost(c *gin.Context) {
	var dto BlogPostCreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	status := model.BlogStatusPublished
	if dto.Status != nil {
		status = *dto.Status
	}
	p := &model.BlogPost{
		Source:   model.BlogSourceSelf,
		Title:    strings.TrimSpace(dto.Title),
		Summary:  strings.TrimSpace(dto.Summary),
		CoverURL: strings.TrimSpace(dto.CoverURL),
		Content:  dto.Content,
		Status:   status,
	}
	if p.Summary == "" {
		p.Summary = blogSummaryFromMarkdown(p.Content, 160)
	}
	if status == model.BlogStatusPublished {
		now := time.Now()
		p.PublishedAt = &now
	}
	// status 需要强制写入：草稿的 0 会被 struct Create 按零值吞掉。
	if err := adminCreateRow(h.db, p, map[string]any{"status": p.Status}); err != nil {
		response.Fail(c, response.CodeServerError, "failed to create post")
		return
	}
	response.OK(c, toAdminBlogPostVO(p))
}

func (h *blogHandler) updatePost(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var dto BlogPostUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	var existing model.BlogPost
	if err := h.db.Where("id = ?", id).First(&existing).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "post not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load post")
		return
	}

	fields := map[string]any{}
	if dto.Title != nil {
		fields["title"] = strings.TrimSpace(*dto.Title)
	}
	if dto.Summary != nil {
		fields["summary"] = strings.TrimSpace(*dto.Summary)
	}
	if dto.CoverURL != nil {
		fields["cover_url"] = strings.TrimSpace(*dto.CoverURL)
	}
	if dto.Content != nil {
		fields["content"] = *dto.Content
	}
	if dto.Status != nil {
		fields["status"] = *dto.Status
		// 首次发布补发布时间（telegram 文章带原消息时间，不覆盖）。
		if *dto.Status == model.BlogStatusPublished && existing.PublishedAt == nil {
			fields["published_at"] = time.Now()
		}
	}
	if len(fields) > 0 {
		if err := h.db.Model(&model.BlogPost{}).Where("id = ?", id).
			Updates(fields).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to update post")
			return
		}
	}
	var row model.BlogPost
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load post")
		return
	}
	response.OK(c, toAdminBlogPostVO(&row))
}

func (h *blogHandler) removePost(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.BlogPost{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete post")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "post not found")
		return
	}
	response.OK[any](c, nil)
}

// ---- channels ----

func (h *blogHandler) listChannels(c *gin.Context) {
	var rows []model.BlogChannel
	if err := h.db.Order("create_time ASC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list channels")
		return
	}
	// 文章数实时统计（同步后手动删文会让缓存列漂移）。
	counts := map[idgen.ID]int64{}
	type cnt struct {
		ChannelID idgen.ID
		N         int64
	}
	var cs []cnt
	if err := h.db.Model(&model.BlogPost{}).
		Select("channel_id AS channel_id, COUNT(*) AS n").
		Where("source = ?", model.BlogSourceTelegram).
		Group("channel_id").Scan(&cs).Error; err == nil {
		for _, x := range cs {
			counts[x.ChannelID] = x.N
		}
	}
	vos := make([]BlogChannelVO, len(rows))
	for i := range rows {
		vos[i] = toBlogChannelVO(&rows[i])
		vos[i].PostCount = counts[rows[i].ID]
	}
	response.OK(c, vos)
}

func (h *blogHandler) createChannel(c *gin.Context) {
	var dto BlogChannelCreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	username, err := normalizeTgUsername(dto.Username)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	ch := &model.BlogChannel{
		Username: username,
		Title:    strings.TrimSpace(dto.Title),
		Enabled:  true,
	}
	if err := adminCreateRow(h.db, ch, nil); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			response.Fail(c, response.CodeBadRequest, "该频道已添加")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to create channel")
		return
	}
	response.OK(c, toBlogChannelVO(ch))
}

func (h *blogHandler) updateChannel(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var dto BlogChannelUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	fields := map[string]any{}
	if dto.Title != nil {
		fields["title"] = strings.TrimSpace(*dto.Title)
	}
	if dto.Enabled != nil {
		fields["enabled"] = *dto.Enabled
	}
	if len(fields) > 0 {
		res := h.db.Model(&model.BlogChannel{}).Where("id = ?", id).Updates(fields)
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to update channel")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "channel not found")
			return
		}
	}
	var row model.BlogChannel
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "channel not found")
		return
	}
	response.OK(c, toBlogChannelVO(&row))
}

// removeChannel deletes the channel row ONLY；已导入的文章是既成内容，保留并可
// 在文章列表单独管理（前端删除确认里已说明）。
func (h *blogHandler) removeChannel(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.BlogChannel{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete channel")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "channel not found")
		return
	}
	response.OK[any](c, nil)
}

// ---- sync ----

const (
	// blogSyncMaxPages caps how many preview pages (~20 msgs each) one sync
	// walks back — 首次导入最多约 100 条，之后增量同步通常只走 1 页。
	blogSyncMaxPages = 5
	// blogSyncMaxImages caps re-hosted images per message.
	blogSyncMaxImages = 6
	// blogSyncMaxVideos caps re-hosted videos per message（视频体积大）.
	blogSyncMaxVideos = 2
)

// hostedVideo is one re-hosted video attachment.
type hostedVideo struct {
	URL    string // 本站 mp4 地址
	Poster string // 封面（本站地址；转存失败时为原 CDN 地址）
}

// hostedMedia is one message's re-hosted attachments.
type hostedMedia struct {
	photos []string
	videos []hostedVideo
	failed int
}

func (h *blogHandler) syncChannel(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var ch model.BlogChannel
	if err := h.db.Where("id = ?", id).First(&ch).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "channel not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load channel")
		return
	}
	if !ch.Enabled {
		response.Fail(c, response.CodeBadRequest, "频道已停用，启用后再同步")
		return
	}

	blogSyncMu.Lock()
	defer blogSyncMu.Unlock()

	// 抓页 + 图片/视频转存都在这个预算内；预览页超时单次 20s（tgfeed），
	// 视频单个上限 80MB/180s。与 Next 代理 proxyTimeout(300s)、边缘 nginx
	// (900s) 的口径兼容。
	ctx, cancel := context.WithTimeout(c.Request.Context(), 280*time.Second)
	defer cancel()

	res, err := h.runSync(ctx, &ch)
	if err != nil {
		response.Fail(c, response.CodeServerError, "同步失败："+err.Error())
		return
	}
	response.OK(c, res)
}

// runSync walks the channel preview from newest backwards, imports messages
// newer than LastMsgID, and advances the watermark.
func (h *blogHandler) runSync(ctx context.Context, ch *model.BlogChannel) (*BlogSyncResultVO, error) {
	out := &BlogSyncResultVO{}
	var fresh []tgfeed.Message
	beforeID := int64(0)

	for page := 0; page < blogSyncMaxPages; page++ {
		pg, err := tgfeed.FetchPage(ctx, ch.Username, beforeID)
		if err != nil {
			// 首页就失败 → 整体失败；翻旧页失败 → 用已抓到的部分继续。
			if page == 0 {
				return nil, err
			}
			break
		}
		if out.ChannelTitle == "" {
			out.ChannelTitle = pg.ChannelTitle
		}
		if len(pg.Messages) == 0 {
			break
		}
		oldest := pg.Messages[0].ID
		for _, m := range pg.Messages {
			if m.ID < oldest {
				oldest = m.ID
			}
			if m.ID > ch.LastMsgID {
				fresh = append(fresh, m)
			}
		}
		// 本页最旧的消息已越过水位 → 不必再翻更旧的页。
		if oldest <= ch.LastMsgID+1 {
			break
		}
		beforeID = oldest
	}

	// 按消息 id 升序导入，水位单调推进（中途失败不会留下空洞）。
	for i := 0; i < len(fresh); i++ {
		for j := i + 1; j < len(fresh); j++ {
			if fresh[j].ID < fresh[i].ID {
				fresh[i], fresh[j] = fresh[j], fresh[i]
			}
		}
	}

	// 阶段一：并发转存图片/视频 + 抓评论区（信号量限 6 路）。串行逐张下载曾
	// 把百条首采拖到 30s+，超过 Next 开发代理的 30s 默认超时。
	media := make([]hostedMedia, len(fresh))
	comments := make([][]tgfeed.Comment, len(fresh))
	sem := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for i := range fresh {
		if strings.TrimSpace(fresh[i].Plain) == "" {
			continue // 无文字消息不会落库，媒体也不用转存
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			media[i] = h.rehostAll(ctx, ch.Username, &fresh[i])
			// 评论区（讨论组回复）：这类频道常把完整 prompt 放在评论里，
			// 抓下来并进正文。失败/无讨论组静默跳过。
			if cs, err := tgfeed.FetchComments(ctx, ch.Username, fresh[i].ID, 10); err == nil {
				comments[i] = filterBlogComments(cs)
			}
		}(i)
	}
	wg.Wait()

	// 阶段二：按消息 id 升序落库，水位单调推进。去重用一次批查、插入分批——
	// 逐条 COUNT+INSERT 在远程库上每条都吃一个网络往返，百条首采即 10s+。
	candidateIDs := make([]int64, 0, len(fresh))
	for i := range fresh {
		if strings.TrimSpace(fresh[i].Plain) != "" {
			candidateIDs = append(candidateIDs, fresh[i].ID)
		}
	}
	dup := map[int64]bool{}
	if len(candidateIDs) > 0 {
		var existing []int64
		if err := h.db.Model(&model.BlogPost{}).
			Where("channel_id = ? AND tg_msg_id IN ?", ch.ID, candidateIDs).
			Pluck("tg_msg_id", &existing).Error; err != nil {
			return nil, fmt.Errorf("dedup lookup: %w", err)
		}
		for _, id := range existing {
			dup[id] = true
		}
	}

	maxID := ch.LastMsgID
	posts := make([]*model.BlogPost, 0, len(fresh))
	for i := range fresh {
		m := &fresh[i]
		if m.ID > maxID {
			maxID = m.ID
		}
		if strings.TrimSpace(m.Plain) == "" {
			out.SkippedEmpty++
			continue
		}
		out.ImageFailed += media[i].failed
		if dup[m.ID] {
			continue
		}
		posts = append(posts, buildTgPost(ch, m, &media[i], comments[i]))
	}
	if len(posts) > 0 {
		if err := h.db.CreateInBatches(posts, 20).Error; err != nil {
			return nil, fmt.Errorf("save posts: %w", err)
		}
	}
	out.Created = len(posts)

	// 推进水位并回填频道备注名（管理员没填时用频道自己的名字）。
	now := time.Now()
	fields := map[string]any{"last_msg_id": maxID, "last_sync_at": now}
	if strings.TrimSpace(ch.Title) == "" && out.ChannelTitle != "" {
		fields["title"] = out.ChannelTitle
	}
	if err := h.db.Model(&model.BlogChannel{}).Where("id = ?", ch.ID).
		Updates(fields).Error; err != nil {
		return nil, err
	}
	if out.ChannelTitle == "" {
		out.ChannelTitle = ch.Title
	}
	return out, nil
}

// rehostAll re-hosts one message's images & videos (capped)。图片失败保留原
// CDN 链接；视频失败退化为封面图（原视频链接很快过期，留着就是死链）。
func (h *blogHandler) rehostAll(ctx context.Context, username string, m *tgfeed.Message) hostedMedia {
	var out hostedMedia

	photos := m.Photos
	if len(photos) > blogSyncMaxImages {
		photos = photos[:blogSyncMaxImages]
	}
	for i, u := range photos {
		saved, err := h.rehostImage(ctx, username, m.ID, i, u)
		if err != nil {
			out.failed++
			out.photos = append(out.photos, u)
			continue
		}
		out.photos = append(out.photos, saved)
	}

	videos := m.Videos
	if len(videos) > blogSyncMaxVideos {
		videos = videos[:blogSyncMaxVideos]
	}
	for i, v := range videos {
		// 封面缩略先转存（<video poster> 与列表卡片都用它）。
		poster := v.Poster
		if poster != "" {
			if saved, err := h.rehostImage(ctx, username, m.ID, 100+i, poster); err == nil {
				poster = saved
			}
		}
		if v.URL == "" {
			// 预览没内嵌视频源（体积过大）：封面当图片兜底。
			if poster != "" {
				out.photos = append(out.photos, poster)
			}
			continue
		}
		saved, err := h.rehostVideo(ctx, username, m.ID, i, v.URL)
		if err != nil {
			out.failed++
			if poster != "" {
				out.photos = append(out.photos, poster)
			}
			continue
		}
		out.videos = append(out.videos, hostedVideo{URL: saved, Poster: poster})
	}
	return out
}

// ---- 推广尾注剥离 ----
// 频道消息末尾惯常挂自推：一条分割线 + 若干机器人/引流链接行（用户明确
// 不要）。两层规则，保守裁剪：
//  1. 末尾若存在分割线，且其后每个非空行都含 Markdown 链接（≤6 行）——
//     从分割线起整段裁掉；
//  2. 结尾的「纯链接行」（整行除链接外只剩表情/点号等符号，无文字）——
//     逐行裁掉。
// 正文中带前缀的引用链接（如「来源：[@xx](…)」）不满足任一规则，不受影响。

var (
	promoSepRe  = regexp.MustCompile(`^(?:>\s*)?[─━—–=_*\-]{6,}$`)
	promoLinkRe = regexp.MustCompile(`\[[^\]]*\]\([^)]*\)`)
	wordCharRe  = regexp.MustCompile(`[\p{L}\p{N}]`)
)

// isPureLinkLine reports whether a line is only links + decorative symbols.
func isPureLinkLine(line string) bool {
	if !strings.Contains(line, "](") {
		return false
	}
	rest := promoLinkRe.ReplaceAllString(line, "")
	return !wordCharRe.MatchString(rest)
}

// stripPromoMarkdown applies both rules to the message markdown, returning the
// cleaned text and how many non-blank tail lines were removed.
func stripPromoMarkdown(md string) (string, int) {
	lines := strings.Split(md, "\n")
	end := len(lines)
	removed := 0

	// 规则 1：分割线 + 全链接尾段。
	for i := end - 1; i >= 0 && i >= end-8; i-- {
		if !promoSepRe.MatchString(strings.TrimSpace(lines[i])) {
			continue
		}
		ok, tailNonBlank := true, 0
		for _, l := range lines[i+1 : end] {
			t := strings.TrimSpace(l)
			if t == "" {
				continue
			}
			tailNonBlank++
			if !strings.Contains(t, "](") {
				ok = false
				break
			}
		}
		if ok && tailNonBlank > 0 && tailNonBlank <= 6 {
			removed += tailNonBlank
			end = i
		}
		break
	}
	// 规则 2：结尾纯链接行。
	for end > 0 {
		t := strings.TrimSpace(lines[end-1])
		if t == "" {
			end--
			continue
		}
		if isPureLinkLine(t) {
			removed++
			end--
			continue
		}
		break
	}
	return strings.TrimRight(strings.Join(lines[:end], "\n"), "\n \t"), removed
}

// stripPromoPlain removes the same number of trailing non-blank lines from the
// plain rendering（行结构与 markdown 一致），保持标题/摘要口径同步。
func stripPromoPlain(plain string, removed int) string {
	if removed <= 0 {
		return plain
	}
	lines := strings.Split(plain, "\n")
	end := len(lines)
	for end > 0 && removed > 0 {
		if strings.TrimSpace(lines[end-1]) != "" {
			removed--
		}
		end--
	}
	// 顺带吃掉紧邻的分割线与空行。
	for end > 0 {
		t := strings.TrimSpace(lines[end-1])
		if t == "" || promoSepRe.MatchString(t) {
			end--
			continue
		}
		break
	}
	return strings.TrimRight(strings.Join(lines[:end], "\n"), "\n \t")
}

// filterBlogComments keeps the substantive replies（完整 prompt 这类），过滤
// 掉普通闲聊：保留含代码块的，或纯文本 ≥ 40 字的；最多 3 条。
func filterBlogComments(cs []tgfeed.Comment) []tgfeed.Comment {
	out := make([]tgfeed.Comment, 0, 3)
	for _, c := range cs {
		if len(out) == 3 {
			break
		}
		if strings.Contains(c.Markdown, "```") || len([]rune(c.Plain)) >= 40 {
			// 评论同样剥推广尾注。
			if md, removed := stripPromoMarkdown(c.Markdown); removed > 0 && strings.TrimSpace(md) != "" {
				c.Markdown = md
			}
			out = append(out, c)
		}
	}
	return out
}

// buildTgPost converts one telegram message into a published blog_post。视频
// 用 `![video](url "poster")` 约定嵌入正文最前（详情页把它渲染成播放器并隐藏
// 顶部封面，与频道里“媒体在上、文字在下”的观感一致）；评论区的实质性回复
// （完整 prompt 等）以分割线区块附在正文末尾。
func buildTgPost(ch *model.BlogChannel, m *tgfeed.Message, media *hostedMedia, comments []tgfeed.Comment) *model.BlogPost {
	// 剥掉频道自推尾注；整条都是推广时保守放弃裁剪（标题不能为空）。
	md, removed := stripPromoMarkdown(m.Markdown)
	plain := stripPromoPlain(m.Plain, removed)
	if strings.TrimSpace(plain) == "" {
		md, plain = m.Markdown, m.Plain
	}
	title, rest := splitTitle(plain)

	var b strings.Builder
	for _, v := range media.videos {
		if v.Poster != "" {
			b.WriteString("![video](" + v.URL + " \"" + v.Poster + "\")\n\n")
		} else {
			b.WriteString("![video](" + v.URL + ")\n\n")
		}
	}
	b.WriteString(md)
	// 除封面外的图片附在正文末尾（封面在详情页顶部单独展示，不重复）。
	extra := media.photos
	if len(media.videos) == 0 && len(extra) > 0 {
		extra = extra[1:] // 首图即封面
	}
	if len(extra) > 0 {
		b.WriteString("\n")
		for _, u := range extra {
			b.WriteString("\n![](" + u + ")\n")
		}
	}
	if len(comments) > 0 {
		b.WriteString("\n\n---\n\n**评论区补充**\n")
		for _, cm := range comments {
			b.WriteString("\n" + cm.Markdown + "\n")
		}
	}
	content := b.String()

	summary := collapseSpace(rest)
	if summary == "" {
		summary = collapseSpace(title)
	}
	cover := ""
	if len(media.videos) > 0 && media.videos[0].Poster != "" {
		cover = media.videos[0].Poster
	} else if len(media.photos) > 0 {
		cover = media.photos[0]
	}
	msgTime := m.Time
	return &model.BlogPost{
		Source:    model.BlogSourceTelegram,
		ChannelID: ch.ID,
		TgMsgID:   m.ID,
		Title:     truncateRunes(title, 120),
		Summary:   truncateRunes(summary, 160),
		CoverURL:  cover,
		Content:   content,
		// 导入为草稿：先审核/AI 优化，再上架（用户定稿）。发布时间仍取原
		// 消息时间，上架后前台按频道原时序排列。
		Status:      model.BlogStatusDraft,
		PublishedAt: &msgTime,
	}
}

// rehostVideo downloads one CDN video and saves it under the blog prefix.
func (h *blogHandler) rehostVideo(ctx context.Context, username string, msgID int64, idx int, url string) (string, error) {
	data, ct, err := tgfeed.FetchVideo(ctx, url)
	if err != nil {
		return "", err
	}
	ext := ".mp4"
	if strings.Contains(ct, "webm") {
		ext = ".webm"
	}
	key := fmt.Sprintf("blog/tg/%s/%d_v%d%s", username, msgID, idx, ext)
	return h.store.Save(ctx, key, bytes.NewReader(data), ct)
}

// rehostImage downloads one CDN image and saves it under the blog prefix.
func (h *blogHandler) rehostImage(ctx context.Context, username string, msgID int64, idx int, url string) (string, error) {
	data, ct, err := tgfeed.FetchImage(ctx, url)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("blog/tg/%s/%d_%d%s", username, msgID, idx, extByContentType(ct))
	return h.store.Save(ctx, key, bytes.NewReader(data), ct)
}

// ---- helpers ----

var tgUsernameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{3,31}$`)

// normalizeTgUsername accepts "@handle" / "https://t.me/handle" / "t.me/s/handle"
// / bare handle and returns the bare handle.
func normalizeTgUsername(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimPrefix(s, "t.me/")
	s = strings.TrimPrefix(s, "telegram.me/")
	s = strings.TrimPrefix(s, "s/")
	s = strings.TrimPrefix(s, "@")
	s = strings.TrimSuffix(s, "/")
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if !tgUsernameRe.MatchString(s) {
		return "", errors.New("频道用户名无效：应为 @handle 或 t.me 链接（字母开头，4-32 位字母/数字/下划线）")
	}
	return s, nil
}

// splitTitle returns the first non-empty line and the remaining text.
func splitTitle(plain string) (title, rest string) {
	lines := strings.Split(plain, "\n")
	for i, l := range lines {
		if t := strings.TrimSpace(l); t != "" {
			return t, strings.Join(lines[i+1:], "\n")
		}
	}
	return "", ""
}

// collapseSpace flattens all whitespace runs into single spaces.
func collapseSpace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// truncateRunes hard-caps a string at n runes (appending … when cut).
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// blogSummaryFromMarkdown derives a plain-text summary from Markdown content.
func blogSummaryFromMarkdown(md string, n int) string {
	s := md
	// 图片整体移除，链接保留文字。
	s = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`).ReplaceAllString(s, "$1")
	s = strings.NewReplacer("**", "", "__", "", "`", "", "#", "", ">", "", "*", "", "~~", "").Replace(s)
	return truncateRunes(collapseSpace(s), n)
}

// extByContentType maps an image content type to a file extension.
func extByContentType(ct string) string {
	switch {
	case strings.Contains(ct, "png"):
		return ".png"
	case strings.Contains(ct, "webp"):
		return ".webp"
	case strings.Contains(ct, "gif"):
		return ".gif"
	default:
		return ".jpg"
	}
}

func toAdminBlogPostVO(p *model.BlogPost) AdminBlogPostVO {
	published := ""
	if p.PublishedAt != nil && !p.PublishedAt.IsZero() {
		published = p.PublishedAt.Format(time.RFC3339)
	}
	return AdminBlogPostVO{
		ID:          p.ID,
		Source:      p.Source,
		ChannelID:   p.ChannelID,
		TgMsgID:     p.TgMsgID,
		Title:       p.Title,
		Summary:     p.Summary,
		CoverURL:    p.CoverURL,
		Content:     p.Content,
		Status:      p.Status,
		ViewCount:   p.ViewCount,
		PublishedAt: published,
		CreateTime:  g5FmtTime(p.CreateTime),
		UpdateTime:  g5FmtTime(p.UpdateTime),
	}
}

func toBlogChannelVO(ch *model.BlogChannel) BlogChannelVO {
	lastSync := ""
	if ch.LastSyncAt != nil && !ch.LastSyncAt.IsZero() {
		lastSync = ch.LastSyncAt.Format(time.RFC3339)
	}
	return BlogChannelVO{
		ID:         ch.ID,
		Username:   ch.Username,
		Title:      ch.Title,
		Enabled:    ch.Enabled,
		LastMsgID:  ch.LastMsgID,
		LastSyncAt: lastSync,
		PostCount:  ch.PostCount,
		CreateTime: g5FmtTime(ch.CreateTime),
	}
}
