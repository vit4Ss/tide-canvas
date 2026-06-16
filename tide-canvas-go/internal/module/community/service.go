package community

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// contentPreviewLength 列表/详情预览截取长度（对齐 CONTENT_PREVIEW_LENGTH=200）。
const contentPreviewLength = 200

// maxContentImages 从正文提取图片的上限（对齐旧 extractImages 的 9 张上限）。
const maxContentImages = 9

// imagePattern 提取 Markdown 图片地址（对齐 IMAGE_PATTERN）。
var imagePattern = regexp.MustCompile(`!\[[^\]]*]\(\s*([^)\s]+)`)

// stripMarkdown 用到的正则（对齐 stripMarkdown 的多条 replaceAll）。
var (
	mdCodeBlock = regexp.MustCompile("(?s)```.*?```")                        // 代码块
	mdImage     = regexp.MustCompile(`!\[[^\]]*]\([^)]*\)`)                  // 图片
	mdLink      = regexp.MustCompile(`\[([^\]]*)]\([^)]*\)`)                 // 链接 -> 文字
	mdLinePfx   = regexp.MustCompile(`(?m)^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+`) // 行首标记
	mdEmphasis  = regexp.MustCompile("[*_~`]")                               // 强调/行内代码符号
	mdSpaces    = regexp.MustCompile(`\s+`)                                  // 折叠空白
)

// Service 社区业务逻辑（对齐 CommunityServiceImpl）。
type Service struct {
	repo *Repository
	db   *gorm.DB
	// sanitizer 富文本/Markdown 正文清洗策略（UGC：放行常见富文本、剥离脚本与危险属性）。
	sanitizer *bluemonday.Policy
}

// NewService 构造社区服务。
func NewService(repo *Repository) *Service {
	return &Service{repo: repo, db: repo.DB(), sanitizer: bluemonday.UGCPolicy()}
}

// CreatePost 创建帖子（对齐 createPost）：正文清洗 → 写入（默认计数为0、status=1）。
func (s *Service) CreatePost(userID int64, req *PostCreateReq) (*PostVO, error) {
	post := &model.CommunityPost{
		UserID:       userID,
		Title:        req.Title,
		Content:      s.sanitize(req.Content),
		Images:       toJSONArray(req.Images),
		Category:     req.Category,
		Tags:         toJSONArray(req.Tags),
		ViewCount:    0,
		LikeCount:    0,
		CommentCount: 0,
		Status:       1,
	}
	if err := s.repo.CreatePost(post); err != nil {
		return nil, err
	}
	return s.toPostVO(post, userID)
}

// UpdatePost 更新帖子（对齐 updatePost）：校验所有权 → 仅更新传入字段（正文清洗）。
func (s *Service) UpdatePost(userID int64, publicID string, req *PostUpdateReq) error {
	post, err := s.getAndCheckOwnership(userID, publicID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(req.Title) != "" {
		post.Title = req.Title
	}
	if req.Content != nil {
		post.Content = s.sanitize(*req.Content)
	}
	if req.Images != nil {
		post.Images = toJSONArray(*req.Images)
	}
	if req.Category != nil {
		post.Category = *req.Category
	}
	if req.Tags != nil {
		post.Tags = toJSONArray(*req.Tags)
	}
	if req.Status != nil {
		post.Status = *req.Status
	}
	return s.repo.SavePost(post)
}

// DeletePost 删除帖子（对齐 deletePost）：校验所有权 → 逻辑删除。
func (s *Service) DeletePost(userID int64, publicID string) error {
	post, err := s.getAndCheckOwnership(userID, publicID)
	if err != nil {
		return err
	}
	return s.repo.DeletePostByID(post.ID)
}

// GetPost 帖子详情（对齐 getPost）：取帖子 → 原子浏览量+1 → 组装详情（含完整正文 + liked）。
// currentUserID<=0 表示匿名访问（liked 恒 false）。
func (s *Service) GetPost(publicID string, currentUserID int64) (*PostDetailVO, error) {
	post, err := s.repo.FindPostByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if post == nil {
		return nil, ecode.NotFound.WithMessage("帖子不存在")
	}

	// 原子自增浏览量（失败不阻断详情返回）。
	_ = s.repo.IncrPostViewCount(post.ID)

	base, err := s.toPostVO(post, currentUserID)
	if err != nil {
		return nil, err
	}
	// 回显时浏览量体现本次 +1（对齐旧版 vo.setViewCount(post.getViewCount() + 1)）。
	base.ViewCount = post.ViewCount + 1
	return &PostDetailVO{PostVO: *base, Content: post.Content}, nil
}

// ListPosts 帖子分页（对齐 listPosts）：可选关键词/分类/作者过滤，按创建时间倒序。
func (s *Service) ListPosts(query *PostQuery, currentUserID int64) (*pageData, error) {
	query.normalize()

	// 作者过滤：对外传入 public_id，解析为内部 user_id；解析不到则返回空页。
	var authorID int64
	if strings.TrimSpace(query.UserID) != "" {
		var u model.SysUser
		err := s.db.Model(&model.SysUser{}).Select("id").
			Where("public_id = ?", query.UserID).First(&u).Error
		if err != nil {
			if isNotFound(err) {
				return &pageData{Records: []*PostVO{}, Total: 0, PageNum: query.PageNum, PageSize: query.PageSize}, nil
			}
			return nil, err
		}
		authorID = u.ID
	}

	records, total, err := s.repo.PagePosts(query.Keyword, query.Category, authorID, query.PageNum, query.PageSize)
	if err != nil {
		return nil, err
	}
	vos, err := s.toPostVOs(records, currentUserID)
	if err != nil {
		return nil, err
	}
	return &pageData{Records: vos, Total: total, PageNum: query.PageNum, PageSize: query.PageSize}, nil
}

// pageData 服务层分页载荷，由 handler 转交 response.Page 输出。
type pageData struct {
	Records  []*PostVO
	Total    int64
	PageNum  int
	PageSize int
}

// ToggleLikePost 切换帖子点赞（对齐 toggleLikePost）：已赞则取消并 like_count-1，未赞则新增并 like_count+1。
// 返回 true=已点赞，false=已取消。整体在事务内保证点赞记录与计数一致。
func (s *Service) ToggleLikePost(userID int64, publicID string) (bool, error) {
	post, err := s.repo.FindPostByPublicID(publicID)
	if err != nil {
		return false, err
	}
	if post == nil {
		return false, ecode.NotFound.WithMessage("帖子不存在")
	}

	liked := false
	err = s.db.Transaction(func(tx *gorm.DB) error {
		txRepo := &Repository{db: tx}
		existing, err := txRepo.FindLike(userID, model.LikeTargetPost, post.ID)
		if err != nil {
			return err
		}
		if existing != nil {
			// 取消点赞
			if err := txRepo.DeleteLikeByID(existing.ID); err != nil {
				return err
			}
			if err := txRepo.DecrPostLikeCount(post.ID); err != nil {
				return err
			}
			liked = false
			return nil
		}
		// 新增点赞（create_time 由 BaseModel autoCreateTime 注入）
		if err := txRepo.CreateLike(&model.CommunityLike{
			UserID:     userID,
			TargetType: model.LikeTargetPost,
			TargetID:   post.ID,
		}); err != nil {
			return err
		}
		if err := txRepo.IncrPostLikeCount(post.ID); err != nil {
			return err
		}
		liked = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return liked, nil
}

// AddComment 发表评论（对齐 addComment）：校验帖子存在 → 解析父评论 public_id → 写入 → 帖子评论数+1。
func (s *Service) AddComment(userID int64, postPublicID string, req *CommentCreateReq) (*CommentVO, error) {
	post, err := s.repo.FindPostByPublicID(postPublicID)
	if err != nil {
		return nil, err
	}
	if post == nil {
		return nil, ecode.NotFound.WithMessage("帖子不存在")
	}

	// 解析父评论 public_id → 内部 id（楼中楼回复）。父评论须属于同一帖子。
	var parentID *int64
	if strings.TrimSpace(req.ParentID) != "" {
		var parent model.CommunityComment
		err := s.db.Where("public_id = ?", req.ParentID).First(&parent).Error
		if err != nil {
			if isNotFound(err) {
				return nil, ecode.NotFound.WithMessage("父评论不存在")
			}
			return nil, err
		}
		if parent.PostID != post.ID {
			return nil, ecode.BadRequest.WithMessage("父评论不属于该帖子")
		}
		pid := parent.ID
		parentID = &pid
	}

	comment := &model.CommunityComment{
		PostID:    post.ID,
		UserID:    userID,
		ParentID:  parentID,
		Content:   s.sanitize(req.Content),
		LikeCount: 0,
		Status:    1,
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		txRepo := &Repository{db: tx}
		if err := txRepo.CreateComment(comment); err != nil {
			return err
		}
		return txRepo.IncrPostCommentCount(post.ID)
	})
	if err != nil {
		return nil, err
	}
	return s.toCommentVO(comment, s.singleUser(comment.UserID)), nil
}

// ListComments 帖子评论树（对齐 listComments）：按创建时间升序取全部 → 按 parentId 组装楼中楼。
func (s *Service) ListComments(postPublicID string) ([]*CommentVO, error) {
	post, err := s.repo.FindPostByPublicID(postPublicID)
	if err != nil {
		return nil, err
	}
	if post == nil {
		return nil, ecode.NotFound.WithMessage("帖子不存在")
	}

	comments, err := s.repo.ListCommentsByPostID(post.ID)
	if err != nil {
		return nil, err
	}
	if len(comments) == 0 {
		return []*CommentVO{}, nil
	}

	// 批量解析作者投影
	authorIDs := make([]int64, 0, len(comments))
	for i := range comments {
		authorIDs = append(authorIDs, comments[i].UserID)
	}
	users, err := s.repo.UsersByIDs(authorIDs)
	if err != nil {
		return nil, err
	}

	// 先建立 内部id → VO 映射，并用内部 parentID 组装树（对外 parentId 用 public_id 回填）。
	voByID := make(map[int64]*CommentVO, len(comments))
	order := make([]*model.CommunityComment, 0, len(comments))
	for i := range comments {
		c := &comments[i]
		voByID[c.ID] = s.toCommentVO(c, users[c.UserID])
		order = append(order, c)
	}

	// 组装树：非顶层评论挂到父评论 replies 下；顶层评论收集为返回列表。
	// 对齐旧版语义：parentId 非空但父评论不在列表内（如父评论已软删）的孤儿回复，既不挂载也不进顶层（被丢弃）。
	topLevel := make([]*CommentVO, 0)
	for _, c := range order {
		vo := voByID[c.ID]
		if c.ParentID == nil {
			topLevel = append(topLevel, vo)
			continue
		}
		if parentVO, ok := voByID[*c.ParentID]; ok {
			parentVO.Replies = append(parentVO.Replies, vo)
			vo.ParentID = parentVO.ID // 对外父ID为父评论 public_id
		}
	}
	return topLevel, nil
}

// DeleteComment 删除评论（对齐 deleteComment）：校验存在与归属 → 逻辑删除 → 帖子评论数-1。
func (s *Service) DeleteComment(userID int64, commentPublicID string) error {
	var comment model.CommunityComment
	err := s.db.Where("public_id = ?", commentPublicID).First(&comment).Error
	if err != nil {
		if isNotFound(err) {
			return ecode.NotFound.WithMessage("评论不存在")
		}
		return err
	}
	if comment.UserID != userID {
		return ecode.Forbidden.WithMessage("无权删除该评论")
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		txRepo := &Repository{db: tx}
		if err := txRepo.DeleteCommentByID(comment.ID); err != nil {
			return err
		}
		return txRepo.DecrPostCommentCount(comment.PostID)
	})
}

// ============================= 私有方法 =============================

// getAndCheckOwnership 取帖子并校验所有权（对齐 getAndCheckOwnership）：不存在 404，非本人 403。
func (s *Service) getAndCheckOwnership(userID int64, publicID string) (*model.CommunityPost, error) {
	post, err := s.repo.FindPostByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if post == nil {
		return nil, ecode.NotFound.WithMessage("帖子不存在")
	}
	if post.UserID != userID {
		return nil, ecode.Forbidden.WithMessage("无权操作该帖子")
	}
	return post, nil
}

// toPostVO 单条帖子概要 VO。
func (s *Service) toPostVO(post *model.CommunityPost, currentUserID int64) (*PostVO, error) {
	vos, err := s.toPostVOs([]model.CommunityPost{*post}, currentUserID)
	if err != nil {
		return nil, err
	}
	return vos[0], nil
}

// toPostVOs 批量帖子概要 VO：批量解析作者投影与当前用户点赞标记（避免逐行查询）。
func (s *Service) toPostVOs(list []model.CommunityPost, currentUserID int64) ([]*PostVO, error) {
	if len(list) == 0 {
		return []*PostVO{}, nil
	}
	postIDs := make([]int64, 0, len(list))
	authorIDSet := make(map[int64]struct{}, len(list))
	for i := range list {
		postIDs = append(postIDs, list[i].ID)
		authorIDSet[list[i].UserID] = struct{}{}
	}
	authorIDs := make([]int64, 0, len(authorIDSet))
	for id := range authorIDSet {
		authorIDs = append(authorIDs, id)
	}
	users, err := s.repo.UsersByIDs(authorIDs)
	if err != nil {
		return nil, err
	}
	likedSet, err := s.repo.LikedTargetIDs(currentUserID, model.LikeTargetPost, postIDs)
	if err != nil {
		return nil, err
	}

	vos := make([]*PostVO, 0, len(list))
	for i := range list {
		p := &list[i]
		u := users[p.UserID]
		_, liked := likedSet[p.ID]
		vos = append(vos, &PostVO{
			ID:             p.PublicID,
			UserID:         u.PublicID,
			Nickname:       u.Nickname,
			Avatar:         u.Avatar,
			Title:          p.Title,
			ContentPreview: buildContentPreview(p.Content),
			ContentImages:  extractImages(p.Content),
			Images:         jsonString(p.Images),
			Category:       p.Category,
			Tags:           jsonString(p.Tags),
			ViewCount:      p.ViewCount,
			LikeCount:      p.LikeCount,
			CommentCount:   p.CommentCount,
			Liked:          liked,
			CreateTime:     p.CreateTime,
		})
	}
	return vos, nil
}

// toCommentVO 单条评论 VO（replies 初始为空切片，父ID树形组装时回填，见 ListComments）。
func (s *Service) toCommentVO(c *model.CommunityComment, author userProjection) *CommentVO {
	return &CommentVO{
		ID:         c.PublicID,
		UserID:     author.PublicID,
		Nickname:   author.Nickname,
		Avatar:     author.Avatar,
		Content:    c.Content,
		ParentID:   "", // 树形组装时回填父评论 public_id
		LikeCount:  c.LikeCount,
		CreateTime: c.CreateTime,
		Replies:    []*CommentVO{},
	}
}

// singleUser 取单个作者投影（缺失返回零值）。
func (s *Service) singleUser(userID int64) userProjection {
	users, err := s.repo.UsersByIDs([]int64{userID})
	if err != nil {
		return userProjection{}
	}
	return users[userID]
}

// sanitize 富文本/Markdown 正文清洗（去脚本与危险属性，防 XSS）。空串原样返回。
func (s *Service) sanitize(content string) string {
	if content == "" {
		return ""
	}
	return s.sanitizer.Sanitize(content)
}

// ============================= 工具函数 =============================

// isNotFound 判断 GORM 记录不存在。
func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

// toJSONArray 将字符串切片序列化为 JSON 数组（对齐 toJsonString：空/nil 落库为 NULL）。
// 返回 datatypes.JSON（与 model.CommunityPost.Images/Tags 列类型一致）。
func toJSONArray(list []string) datatypes.JSON {
	if len(list) == 0 {
		return nil
	}
	b, err := json.Marshal(list)
	if err != nil {
		return nil
	}
	return datatypes.JSON(b)
}

// jsonString 将 datatypes.JSON 原样转字符串（与旧版 VO 直接回显 JSON 文本一致）。
func jsonString(j datatypes.JSON) string {
	if len(j) == 0 {
		return ""
	}
	return string(j)
}

// buildContentPreview 构建内容预览（去 Markdown 后截取前 200 字符，对齐 buildContentPreview）。
// 按 rune 截断，避免截断多字节中文。
func buildContentPreview(content string) string {
	text := stripMarkdown(content)
	if text == "" {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= contentPreviewLength {
		return text
	}
	return string(runes[:contentPreviewLength]) + "..."
}

// extractImages 提取正文中的 Markdown 图片地址，最多 9 张（对齐 extractImages）。
func extractImages(content string) []string {
	if content == "" {
		return []string{}
	}
	matches := imagePattern.FindAllStringSubmatch(content, -1)
	urls := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(urls) >= maxContentImages {
			break
		}
		if len(m) > 1 {
			urls = append(urls, m[1])
		}
	}
	return urls
}

// stripMarkdown 去除 Markdown 标记转纯文本（对齐 stripMarkdown 的多步替换）。
func stripMarkdown(md string) string {
	if md == "" {
		return ""
	}
	text := md
	text = mdCodeBlock.ReplaceAllString(text, " ") // 代码块
	text = mdImage.ReplaceAllString(text, " ")     // 图片
	text = mdLink.ReplaceAllString(text, "$1")     // 链接 -> 文字
	text = mdLinePfx.ReplaceAllString(text, "")    // 行首标记
	text = mdEmphasis.ReplaceAllString(text, "")   // 强调/行内代码符号
	text = mdSpaces.ReplaceAllString(text, " ")    // 折叠空白
	return strings.TrimSpace(text)
}
