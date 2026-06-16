package blog

import (
	"encoding/json"
	"strings"

	"github.com/sirupsen/logrus"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/internal/module/points"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Service 博客业务逻辑（对齐 BlogServiceImpl）。
type Service struct {
	repo   *Repository
	users  UserFinder
	points PointsService
	db     *gorm.DB
	logger *logrus.Logger
}

// NewService 构造博客服务。
// users / points 为跨模块依赖（见 deps.go）：users 注入 NewDBUserFinder(db)；
// points 注入 points.Service（其 AddPoints / DeductPoints 满足 PointsService）。logger 可为 nil。
func NewService(repo *Repository, users UserFinder, pointsSvc PointsService, logger *logrus.Logger) *Service {
	return &Service{repo: repo, users: users, points: pointsSvc, db: repo.DB(), logger: logger}
}

// 编译期断言：points.Service 满足本模块所需的 PointsService（含 *Tx 变体）。
var _ PointsService = (points.Service)(nil)

// pageData 服务层分页载荷，由 handler 转交 response.Page 输出。
type pageData struct {
	Records  []BlogVO
	Total    int64
	PageNum  int
	PageSize int
}

// CreateBlog 创建博客（对齐 createBlog）：校验签约作者，落库默认状态。
func (s *Service) CreateBlog(userID int64, req *BlogCreateReq) (*BlogVO, error) {
	user, err := s.users.FindUser(userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ecode.AccountNotFound
	}
	if user.IsAuthor != 1 {
		return nil, ecode.NotAuthor
	}

	pointsRequired := 0
	if req.PointsRequired != nil {
		pointsRequired = *req.PointsRequired
	}
	blog := &model.BlogPost{
		AuthorID:       userID,
		Title:          req.Title,
		Content:        req.Content,
		Summary:        req.Summary,
		CoverImage:     req.CoverImage,
		Category:       req.Category,
		Tags:           toTagsJSON(req.Tags),
		PointsRequired: pointsRequired,
		ViewCount:      0,
		LikeCount:      0,
		CommentCount:   0,
		TipTotal:       0,
		Status:         1,
	}
	if err := s.repo.Create(blog); err != nil {
		return nil, err
	}
	return s.toBlogVO(blog, &userID)
}

// UpdateBlog 更新博客（对齐 updateBlog）：校验所有权，仅更新传入字段。
func (s *Service) UpdateBlog(userID int64, publicID string, req *BlogUpdateReq) error {
	blog, err := s.getAndCheckOwnership(userID, publicID)
	if err != nil {
		return err
	}

	if strings.TrimSpace(req.Title) != "" {
		blog.Title = req.Title
	}
	if req.Content != nil {
		blog.Content = *req.Content
	}
	if req.Summary != nil {
		blog.Summary = *req.Summary
	}
	if req.CoverImage != nil {
		blog.CoverImage = *req.CoverImage
	}
	if req.Category != nil {
		blog.Category = *req.Category
	}
	if req.hasTags() {
		blog.Tags = toTagsJSON(req.Tags)
	}
	if req.PointsRequired != nil {
		blog.PointsRequired = *req.PointsRequired
	}
	if req.Status != nil {
		blog.Status = *req.Status
	}
	return s.repo.Update(blog)
}

// DeleteBlog 删除博客（对齐 deleteBlog）：校验所有权后逻辑删除。
func (s *Service) DeleteBlog(userID int64, publicID string) error {
	blog, err := s.getAndCheckOwnership(userID, publicID)
	if err != nil {
		return err
	}
	return s.repo.DeleteByID(blog.ID)
}

// GetBlog 博客详情（对齐 getBlog）：自增浏览量 + 付费内容访问控制。currentUserID 可为 nil（未登录）。
func (s *Service) GetBlog(publicID string, currentUserID *int64) (*BlogDetailVO, error) {
	blog, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if blog == nil {
		return nil, ecode.NotFound.WithMessage("博客不存在")
	}

	// 原子自增浏览量（对齐旧逻辑：详情接口每次访问 +1）。
	if err := s.repo.IncrViewCount(blog.ID); err != nil {
		return nil, err
	}

	liked, err := s.checkLiked(currentUserID, blog.ID)
	if err != nil {
		return nil, err
	}
	author, err := s.users.FindUser(blog.AuthorID)
	if err != nil {
		return nil, err
	}

	vo := BlogDetailVO{BlogVO: s.baseVO(blog, author, liked)}
	// 浏览量在 VO 中展示自增后的值（对齐旧 vo.setViewCount(blog.getViewCount() + 1)）。
	vo.ViewCount = blog.ViewCount + 1

	// 付费内容访问控制（对齐旧 getBlog）。
	isAuthor := currentUserID != nil && *currentUserID == blog.AuthorID
	purchased := false
	if blog.PointsRequired > 0 {
		if currentUserID != nil {
			purchased, err = s.repo.ExistsPurchase(*currentUserID, blog.ID)
			if err != nil {
				return nil, err
			}
		}
		// 非作者且未购买：正文不可见。
		if !isAuthor && !purchased {
			vo.Content = ""
		} else {
			vo.Content = blog.Content
		}
	} else {
		// 免费博客：正文直接可见。
		vo.Content = blog.Content
		purchased = true
	}
	vo.Purchased = purchased || isAuthor
	return &vo, nil
}

// ListBlogs 博客列表分页（对齐 listBlogs）。currentUserID 可为 nil（未登录）。
func (s *Service) ListBlogs(query *BlogQuery, currentUserID *int64) (*pageData, error) {
	query.normalize()

	// authorId 对外为 public_id，需解析为内部主键再过滤（旧后端直接用内部 Long）。
	authorID, err := s.resolveAuthorID(query.AuthorID)
	if err != nil {
		return nil, err
	}
	opts := PageOptions{
		Keyword:  strings.TrimSpace(query.Keyword),
		Category: strings.TrimSpace(query.Category),
		AuthorID: authorID,
		FreeOnly: query.Free != nil && *query.Free,
		PageNum:  query.PageNum,
		PageSize: query.PageSize,
	}
	records, total, err := s.repo.Page(opts)
	if err != nil {
		return nil, err
	}
	vos, err := s.toBlogVOs(records, currentUserID)
	if err != nil {
		return nil, err
	}
	return &pageData{Records: vos, Total: total, PageNum: query.PageNum, PageSize: query.PageSize}, nil
}

// ListMyBlogs 我的博客列表分页（对齐 listMyBlogs）：强制 author_id = 当前用户，忽略 query.authorId / free。
func (s *Service) ListMyBlogs(userID int64, query *BlogQuery) (*pageData, error) {
	query.normalize()
	opts := PageOptions{
		Keyword:  strings.TrimSpace(query.Keyword),
		Category: strings.TrimSpace(query.Category),
		AuthorID: &userID,
		PageNum:  query.PageNum,
		PageSize: query.PageSize,
	}
	records, total, err := s.repo.Page(opts)
	if err != nil {
		return nil, err
	}
	cur := userID
	vos, err := s.toBlogVOs(records, &cur)
	if err != nil {
		return nil, err
	}
	return &pageData{Records: vos, Total: total, PageNum: query.PageNum, PageSize: query.PageSize}, nil
}

// PurchaseBlog 购买付费博客（对齐 purchaseBlog）。
//
// 单事务原子：在一个 db.Transaction 内按旧顺序串行「扣买家积分 → 写购买记录 → 加作者积分」，
// 积分变动改用 points 的 *Tx 变体并复用同一 tx，任一步失败整笔回滚（不会出现扣了买家却没写购买记录、
// 或写了记录却没给作者加分的中间态）。
func (s *Service) PurchaseBlog(userID int64, publicID string) error {
	blog, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if blog == nil {
		return ecode.NotFound.WithMessage("博客不存在")
	}
	if blog.PointsRequired <= 0 {
		return ecode.BadRequest.WithMessage("该博客无需购买")
	}

	// 检查是否已购买（对齐旧 checkPurchased → BLOG_ALREADY_PURCHASED）。
	purchased, err := s.repo.ExistsPurchase(userID, blog.ID)
	if err != nil {
		return err
	}
	if purchased {
		return ecode.BlogAlreadyPurchased
	}

	pointsRequired := blog.PointsRequired
	bizID := blog.ID

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		// 扣减买家积分（余额不足由 points 模块返回 ecode.PointsInsufficient）。
		if err := s.points.DeductPointsTx(tx, userID, pointsRequired, points.TxBlogView, &bizID, "购买博客: "+blog.Title); err != nil {
			return err
		}
		// 写入购买记录。
		if err := s.repo.CreatePurchase(tx, &model.BlogPurchase{
			UserID:     userID,
			BlogID:     blog.ID,
			PointsPaid: pointsRequired,
		}); err != nil {
			return err
		}
		// 作者获得积分（对齐旧 TIP_IN）。
		if err := s.points.AddPointsTx(tx, blog.AuthorID, pointsRequired, points.TxTipIn, &bizID, "博客被购买: "+blog.Title); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}

	s.logf("博客购买成功: userId=%d, blogId=%d, points=%d", userID, blog.ID, pointsRequired)
	return nil
}

// TipBlog 打赏博客（对齐 tipBlog）：扣打赏者积分 → 加作者积分 → 原子更新打赏总额。
//
// 单事务原子：在一个 db.Transaction 内按旧顺序串行扣打赏者、加作者、累加 tip_total，
// 积分变动改用 *Tx 变体复用同一 tx，任一步失败整笔回滚。
func (s *Service) TipBlog(userID int64, publicID string, req *BlogTipReq) error {
	blog, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if blog == nil {
		return ecode.NotFound.WithMessage("博客不存在")
	}

	amount := *req.Amount
	bizID := blog.ID

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		// 扣减打赏者积分。
		if err := s.points.DeductPointsTx(tx, userID, amount, points.TxTipOut, &bizID, "打赏博客: "+blog.Title); err != nil {
			return err
		}
		// 作者获得打赏积分。
		if err := s.points.AddPointsTx(tx, blog.AuthorID, amount, points.TxTipIn, &bizID, "收到打赏: "+blog.Title); err != nil {
			return err
		}
		// 原子更新博客打赏总额。
		return s.repo.IncrTipTotal(tx, blog.ID, amount)
	}); err != nil {
		return err
	}

	s.logf("博客打赏成功: userId=%d, blogId=%d, amount=%d", userID, blog.ID, amount)
	return nil
}

// ToggleLikeBlog 点赞 / 取消点赞（对齐 toggleLikeBlog）：返回 true=已点赞，false=已取消。
// 点赞记录增删与 like_count 更新在同一 db.Transaction 内完成。
func (s *Service) ToggleLikeBlog(userID int64, publicID string) (bool, error) {
	blog, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return false, err
	}
	if blog == nil {
		return false, ecode.NotFound.WithMessage("博客不存在")
	}

	existing, err := s.repo.FindBlogLike(userID, blog.ID)
	if err != nil {
		return false, err
	}

	if existing != nil {
		// 取消点赞：删记录 + like_count - 1（> 0 兜底）。
		err = s.db.Transaction(func(tx *gorm.DB) error {
			if err := s.repo.DeleteLikeByID(tx, existing.ID); err != nil {
				return err
			}
			return s.repo.DecrLikeCount(tx, blog.ID)
		})
		if err != nil {
			return false, err
		}
		return false, nil
	}

	// 新增点赞：插记录 + like_count + 1。
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.repo.CreateBlogLike(tx, &model.CommunityLike{
			UserID:     userID,
			TargetType: model.LikeTargetBlog,
			TargetID:   blog.ID,
		}); err != nil {
			return err
		}
		return s.repo.IncrLikeCount(tx, blog.ID)
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

// ============================= 私有方法 =============================

// getAndCheckOwnership 按 public_id 取博客并校验所有权（对齐 getAndCheckOwnership）。
func (s *Service) getAndCheckOwnership(userID int64, publicID string) (*model.BlogPost, error) {
	blog, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if blog == nil {
		return nil, ecode.NotFound.WithMessage("博客不存在")
	}
	if blog.AuthorID != userID {
		return nil, ecode.Forbidden.WithMessage("无权操作该博客")
	}
	return blog, nil
}

// resolveAuthorID 将作者 public_id 解析为内部主键；空串返回 nil（不过滤）。
// 解析不到（public_id 不存在）时返回一个不可能命中的负数ID，保证查询为空集（对齐“按该作者查无结果”）。
func (s *Service) resolveAuthorID(publicID string) (*int64, error) {
	if strings.TrimSpace(publicID) == "" {
		return nil, nil
	}
	id, err := s.users.IDByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if id == nil {
		notFound := int64(-1)
		return &notFound, nil
	}
	return id, nil
}

// checkLiked 当前用户是否已点赞（对齐 checkLiked）。currentUserID 为 nil 返回 false。
func (s *Service) checkLiked(currentUserID *int64, blogID int64) (bool, error) {
	if currentUserID == nil {
		return false, nil
	}
	n, err := s.repo.CountBlogLike(*currentUserID, blogID)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// baseVO 组装 BlogVO 公共字段（不含 liked / purchased 的语义判定外，作者信息从 author 取）。
func (s *Service) baseVO(blog *model.BlogPost, author *model.SysUser, liked bool) BlogVO {
	vo := BlogVO{
		ID:             blog.PublicID,
		Title:          blog.Title,
		Summary:        blog.Summary,
		CoverImage:     blog.CoverImage,
		Category:       blog.Category,
		Tags:           jsonToString(blog.Tags),
		PointsRequired: blog.PointsRequired,
		ViewCount:      blog.ViewCount,
		LikeCount:      blog.LikeCount,
		TipTotal:       blog.TipTotal,
		Liked:          liked,
		CreateTime:     blog.CreateTime,
	}
	if author != nil {
		vo.AuthorID = author.PublicID
		vo.AuthorName = author.Nickname
		vo.AuthorAvatar = author.Avatar
	}
	return vo
}

// toBlogVO 单条博客转 VO（对齐 toBlogVO）：含 liked / purchased 判定。
func (s *Service) toBlogVO(blog *model.BlogPost, currentUserID *int64) (*BlogVO, error) {
	author, err := s.users.FindUser(blog.AuthorID)
	if err != nil {
		return nil, err
	}
	liked, err := s.checkLiked(currentUserID, blog.ID)
	if err != nil {
		return nil, err
	}
	vo := s.baseVO(blog, author, liked)

	// 列表场景购买状态（对齐 toBlogVO 末尾逻辑）。
	isAuthor := currentUserID != nil && *currentUserID == blog.AuthorID
	if isAuthor || blog.PointsRequired == 0 {
		vo.Purchased = true
	} else if currentUserID != nil {
		purchased, err := s.repo.ExistsPurchase(*currentUserID, blog.ID)
		if err != nil {
			return nil, err
		}
		vo.Purchased = purchased
	}
	return &vo, nil
}

// toBlogVOs 批量博客转 VO：批量预取作者信息、点赞/购买状态，避免逐条 N+1。
func (s *Service) toBlogVOs(blogs []model.BlogPost, currentUserID *int64) ([]BlogVO, error) {
	out := make([]BlogVO, 0, len(blogs))
	if len(blogs) == 0 {
		return out, nil
	}

	// 收集作者ID与博客ID。
	authorIDSet := make(map[int64]struct{}, len(blogs))
	blogIDs := make([]int64, 0, len(blogs))
	for i := range blogs {
		authorIDSet[blogs[i].AuthorID] = struct{}{}
		blogIDs = append(blogIDs, blogs[i].ID)
	}
	authorIDs := make([]int64, 0, len(authorIDSet))
	for id := range authorIDSet {
		authorIDs = append(authorIDs, id)
	}
	authors, err := s.users.FindUsers(authorIDs)
	if err != nil {
		return nil, err
	}

	// 批量点赞 / 购买状态（仅登录用户）。
	var likedSet, purchasedSet map[int64]bool
	if currentUserID != nil {
		likedSet, err = s.repo.LikedBlogIDs(*currentUserID, blogIDs)
		if err != nil {
			return nil, err
		}
		purchasedSet, err = s.repo.PurchasedBlogIDs(*currentUserID, blogIDs)
		if err != nil {
			return nil, err
		}
	}

	for i := range blogs {
		blog := &blogs[i]
		author := authors[blog.AuthorID]
		vo := s.baseVO(blog, author, likedSet[blog.ID])

		isAuthor := currentUserID != nil && *currentUserID == blog.AuthorID
		if isAuthor || blog.PointsRequired == 0 {
			vo.Purchased = true
		} else if currentUserID != nil {
			vo.Purchased = purchasedSet[blog.ID]
		}
		out = append(out, vo)
	}
	return out, nil
}

func (s *Service) logf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Infof(format, args...)
	}
}

// ---- tags JSON 互转 ----

// toTagsJSON 将标签列表序列化为 JSON 列值（对齐旧 toJsonString）。
// nil 或空列表落库为 JSON null（对齐旧返回 null）；序列化失败也落 null。
func toTagsJSON(tags []string) datatypes.JSON {
	if len(tags) == 0 {
		return nil
	}
	b, err := json.Marshal(tags)
	if err != nil {
		return nil
	}
	return datatypes.JSON(b)
}

// jsonToString 将 tags JSON 列原样转为字符串（对齐旧 VO 直接透传 tags 列文本）。空列返回空串。
func jsonToString(j datatypes.JSON) string {
	if len(j) == 0 {
		return ""
	}
	return string(j)
}
