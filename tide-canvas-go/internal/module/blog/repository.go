package blog

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 博客数据访问（GORM）。博客主表 blog_post 逻辑删除由模型 deleted 字段自动过滤；
// 购买记录 blog_purchase、点赞 community_like 为中间表（无逻辑删除）。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供 service 做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// ---- blog_post ----

// FindByID 按主键查询博客，未找到返回 (nil, nil)。
func (r *Repository) FindByID(id int64) (*model.BlogPost, error) {
	var b model.BlogPost
	err := r.db.First(&b, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// FindByPublicID 按对外 public_id 查询博客，未找到返回 (nil, nil)。
func (r *Repository) FindByPublicID(publicID string) (*model.BlogPost, error) {
	var b model.BlogPost
	err := r.db.Where("public_id = ?", publicID).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// Create 新增博客（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) Create(b *model.BlogPost) error {
	return r.db.Create(b).Error
}

// Update 全量更新博客（对齐旧 updateById：按主键更新所有列）。
func (r *Repository) Update(b *model.BlogPost) error {
	return r.db.Save(b).Error
}

// DeleteByID 按主键逻辑删除博客（对齐旧 deleteById；GORM 软删除写 deleted）。
func (r *Repository) DeleteByID(id int64) error {
	return r.db.Delete(&model.BlogPost{}, id).Error
}

// IncrViewCount 原子自增浏览量：view_count = view_count + 1（对齐旧 setSql）。
func (r *Repository) IncrViewCount(id int64) error {
	return r.db.Model(&model.BlogPost{}).
		Where("id = ?", id).
		UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
}

// IncrTipTotal 原子增加打赏总额：tip_total = tip_total + amount（事务内，对齐旧 setSql）。
func (r *Repository) IncrTipTotal(tx *gorm.DB, id int64, amount int) error {
	return tx.Model(&model.BlogPost{}).
		Where("id = ?", id).
		UpdateColumn("tip_total", gorm.Expr("tip_total + ?", amount)).Error
}

// IncrLikeCount 原子点赞数 +1（事务内，对齐旧 like_count = like_count + 1）。
func (r *Repository) IncrLikeCount(tx *gorm.DB, id int64) error {
	return tx.Model(&model.BlogPost{}).
		Where("id = ?", id).
		UpdateColumn("like_count", gorm.Expr("like_count + 1")).Error
}

// DecrLikeCount 原子点赞数 -1，且 WHERE like_count > 0 兜底防止负数
// （事务内，对齐旧 like_count = like_count - 1 + gt("like_count", 0)）。
func (r *Repository) DecrLikeCount(tx *gorm.DB, id int64) error {
	return tx.Model(&model.BlogPost{}).
		Where("id = ? AND like_count > 0", id).
		UpdateColumn("like_count", gorm.Expr("like_count - 1")).Error
}

// PageOptions 博客分页过滤条件（authorID 已由 service 将 public_id 解析为内部主键）。
type PageOptions struct {
	Keyword  string
	Category string
	AuthorID *int64
	FreeOnly bool
	PageNum  int
	PageSize int
}

// Page 分页查询博客列表：按条件过滤并按 create_time 倒序，返回当页记录与总数
// （对齐 listBlogs / listMyBlogs 的 LambdaQueryWrapper）。
func (r *Repository) Page(opts PageOptions) ([]model.BlogPost, int64, error) {
	tx := r.db.Model(&model.BlogPost{})
	if opts.Keyword != "" {
		// 对齐旧 .and(w -> w.like(title).or().like(summary))：分组 OR，避免与外层 AND 串联。
		kw := "%" + opts.Keyword + "%"
		tx = tx.Where("title LIKE ? OR summary LIKE ?", kw, kw)
	}
	if opts.Category != "" {
		tx = tx.Where("category = ?", opts.Category)
	}
	if opts.AuthorID != nil {
		tx = tx.Where("author_id = ?", *opts.AuthorID)
	}
	if opts.FreeOnly {
		tx = tx.Where("points_required = ?", 0)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var records []model.BlogPost
	if err := tx.Order("create_time DESC").
		Offset((opts.PageNum - 1) * opts.PageSize).
		Limit(opts.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// ---- blog_purchase ----

// ExistsPurchase 用户是否已购买该博客（对齐 checkPurchased 的 selectCount > 0）。
func (r *Repository) ExistsPurchase(userID, blogID int64) (bool, error) {
	var n int64
	err := r.db.Model(&model.BlogPurchase{}).
		Where("user_id = ? AND blog_id = ?", userID, blogID).
		Count(&n).Error
	return n > 0, err
}

// PurchasedBlogIDs 批量返回某用户在给定博客集合中已购买的博客ID集合（列表场景批量判定购买状态，避免 N+1）。
func (r *Repository) PurchasedBlogIDs(userID int64, blogIDs []int64) (map[int64]bool, error) {
	result := make(map[int64]bool, len(blogIDs))
	if len(blogIDs) == 0 {
		return result, nil
	}
	var ids []int64
	if err := r.db.Model(&model.BlogPurchase{}).
		Where("user_id = ? AND blog_id IN ?", userID, blogIDs).
		Pluck("blog_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		result[id] = true
	}
	return result, nil
}

// CreatePurchase 写入一条购买记录（事务内）。
func (r *Repository) CreatePurchase(tx *gorm.DB, p *model.BlogPurchase) error {
	return tx.Create(p).Error
}

// ---- community_like（target_type = 博客） ----

// FindBlogLike 查询某用户对某博客的点赞记录，未找到返回 (nil, nil)
// （对齐 toggleLikeBlog 的 selectOne by user_id + target_type=BLOG + target_id）。
func (r *Repository) FindBlogLike(userID, blogID int64) (*model.CommunityLike, error) {
	var like model.CommunityLike
	err := r.db.Where("user_id = ? AND target_type = ? AND target_id = ?",
		userID, model.LikeTargetBlog, blogID).First(&like).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &like, nil
}

// CountBlogLike 统计某用户对某博客的点赞数（对齐 checkLiked 的 selectCount > 0）。
func (r *Repository) CountBlogLike(userID, blogID int64) (int64, error) {
	var n int64
	err := r.db.Model(&model.CommunityLike{}).
		Where("user_id = ? AND target_type = ? AND target_id = ?",
			userID, model.LikeTargetBlog, blogID).
		Count(&n).Error
	return n, err
}

// LikedBlogIDs 批量返回某用户在给定博客集合中已点赞的博客ID集合（列表场景批量判定点赞状态，避免 N+1）。
func (r *Repository) LikedBlogIDs(userID int64, blogIDs []int64) (map[int64]bool, error) {
	result := make(map[int64]bool, len(blogIDs))
	if len(blogIDs) == 0 {
		return result, nil
	}
	var ids []int64
	if err := r.db.Model(&model.CommunityLike{}).
		Where("user_id = ? AND target_type = ? AND target_id IN ?",
			userID, model.LikeTargetBlog, blogIDs).
		Pluck("target_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		result[id] = true
	}
	return result, nil
}

// CreateBlogLike 写入一条博客点赞记录（事务内）。
func (r *Repository) CreateBlogLike(tx *gorm.DB, like *model.CommunityLike) error {
	return tx.Create(like).Error
}

// DeleteLikeByID 按主键删除点赞记录（事务内，对齐 toggleLikeBlog 的 deleteById）。
func (r *Repository) DeleteLikeByID(tx *gorm.DB, id int64) error {
	return tx.Delete(&model.CommunityLike{}, id).Error
}
