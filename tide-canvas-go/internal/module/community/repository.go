package community

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 社区数据访问（GORM）。帖子/评论逻辑删除由模型 deleted 字段自动过滤；点赞表无逻辑删除（物理删）。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供 service 做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// ============================= 帖子 =============================

// FindPostByID 按主键查询帖子，未找到返回 (nil, nil)。
func (r *Repository) FindPostByID(id int64) (*model.CommunityPost, error) {
	var p model.CommunityPost
	err := r.db.First(&p, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// FindPostByPublicID 按对外ID查询帖子，未找到返回 (nil, nil)。
func (r *Repository) FindPostByPublicID(publicID string) (*model.CommunityPost, error) {
	var p model.CommunityPost
	err := r.db.Where("public_id = ?", publicID).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreatePost 新增帖子（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) CreatePost(p *model.CommunityPost) error {
	return r.db.Create(p).Error
}

// SavePost 全量更新帖子（对齐 updateById；以主键定位，写入全部列）。
func (r *Repository) SavePost(p *model.CommunityPost) error {
	return r.db.Save(p).Error
}

// DeletePostByID 逻辑删除帖子（soft delete：置 deleted 标志）。
func (r *Repository) DeletePostByID(id int64) error {
	return r.db.Delete(&model.CommunityPost{}, id).Error
}

// IncrPostViewCount 原子自增浏览量（对齐 setSql("view_count = view_count + 1")）。
func (r *Repository) IncrPostViewCount(id int64) error {
	return r.db.Model(&model.CommunityPost{}).
		Where("id = ?", id).
		UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
}

// IncrPostLikeCount 原子自增点赞数（对齐 setSql("like_count = like_count + 1")）。
func (r *Repository) IncrPostLikeCount(id int64) error {
	return r.db.Model(&model.CommunityPost{}).
		Where("id = ?", id).
		UpdateColumn("like_count", gorm.Expr("like_count + 1")).Error
}

// DecrPostLikeCount 原子自减点赞数，仅在 like_count>0 时（对齐 setSql + gt("like_count", 0)，避免负数）。
func (r *Repository) DecrPostLikeCount(id int64) error {
	return r.db.Model(&model.CommunityPost{}).
		Where("id = ? AND like_count > 0", id).
		UpdateColumn("like_count", gorm.Expr("like_count - 1")).Error
}

// IncrPostCommentCount 原子自增评论数（对齐 setSql("comment_count = comment_count + 1")）。
func (r *Repository) IncrPostCommentCount(id int64) error {
	return r.db.Model(&model.CommunityPost{}).
		Where("id = ?", id).
		UpdateColumn("comment_count", gorm.Expr("comment_count + 1")).Error
}

// DecrPostCommentCount 原子自减评论数，仅在 comment_count>0 时（对齐 setSql + gt("comment_count", 0)）。
func (r *Repository) DecrPostCommentCount(id int64) error {
	return r.db.Model(&model.CommunityPost{}).
		Where("id = ? AND comment_count > 0", id).
		UpdateColumn("comment_count", gorm.Expr("comment_count - 1")).Error
}

// PagePosts 帖子分页（对齐 listPosts）：可选 title 模糊、category 等值、作者 user_id 等值，按 create_time 倒序。
// 返回当前页记录与总数。keyword 为空则不加标题过滤；userID<=0 则不加作者过滤。
func (r *Repository) PagePosts(keyword, category string, userID int64, pageNum, pageSize int) ([]model.CommunityPost, int64, error) {
	q := r.db.Model(&model.CommunityPost{})
	if keyword != "" {
		q = q.Where("title LIKE ?", "%"+keyword+"%")
	}
	if category != "" {
		q = q.Where("category = ?", category)
	}
	if userID > 0 {
		q = q.Where("user_id = ?", userID)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var records []model.CommunityPost
	if total > 0 {
		offset := (pageNum - 1) * pageSize
		if err := q.Order("create_time DESC").
			Offset(offset).
			Limit(pageSize).
			Find(&records).Error; err != nil {
			return nil, 0, err
		}
	}
	return records, total, nil
}

// ============================= 评论 =============================

// FindCommentByID 按主键查询评论，未找到返回 (nil, nil)。
func (r *Repository) FindCommentByID(id int64) (*model.CommunityComment, error) {
	var c model.CommunityComment
	err := r.db.First(&c, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// CreateComment 新增评论（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) CreateComment(c *model.CommunityComment) error {
	return r.db.Create(c).Error
}

// DeleteCommentByID 逻辑删除评论（soft delete）。
func (r *Repository) DeleteCommentByID(id int64) error {
	return r.db.Delete(&model.CommunityComment{}, id).Error
}

// ListCommentsByPostID 查询帖子全部评论，按 create_time 升序（对齐 listComments；树形结构在 service 层组装）。
func (r *Repository) ListCommentsByPostID(postID int64) ([]model.CommunityComment, error) {
	var comments []model.CommunityComment
	err := r.db.Where("post_id = ?", postID).
		Order("create_time ASC").
		Find(&comments).Error
	if err != nil {
		return nil, err
	}
	return comments, nil
}

// ============================= 点赞 =============================

// FindLike 查询某用户对某目标的点赞记录，未找到返回 (nil, nil)（对齐 selectOne）。
func (r *Repository) FindLike(userID int64, targetType int, targetID int64) (*model.CommunityLike, error) {
	var like model.CommunityLike
	err := r.db.Where("user_id = ? AND target_type = ? AND target_id = ?", userID, targetType, targetID).
		First(&like).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &like, nil
}

// CreateLike 新增点赞记录（community_like 对 user_id+target_type+target_id 有唯一约束）。
func (r *Repository) CreateLike(like *model.CommunityLike) error {
	return r.db.Create(like).Error
}

// DeleteLikeByID 物理删除点赞记录（点赞表无逻辑删除）。
func (r *Repository) DeleteLikeByID(id int64) error {
	return r.db.Delete(&model.CommunityLike{}, id).Error
}

// CountLike 统计某用户对某目标是否点赞（对齐 selectCount，用于 liked 标记）。
func (r *Repository) CountLike(userID int64, targetType int, targetID int64) (int64, error) {
	var n int64
	err := r.db.Model(&model.CommunityLike{}).
		Where("user_id = ? AND target_type = ? AND target_id = ?", userID, targetType, targetID).
		Count(&n).Error
	return n, err
}

// LikedTargetIDs 批量查询某用户在给定目标集合中已点赞的 target_id（避免逐条 CountLike）。
func (r *Repository) LikedTargetIDs(userID int64, targetType int, targetIDs []int64) (map[int64]struct{}, error) {
	liked := make(map[int64]struct{}, len(targetIDs))
	if userID <= 0 || len(targetIDs) == 0 {
		return liked, nil
	}
	var ids []int64
	if err := r.db.Model(&model.CommunityLike{}).
		Where("user_id = ? AND target_type = ? AND target_id IN ?", userID, targetType, targetIDs).
		Pluck("target_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		liked[id] = struct{}{}
	}
	return liked, nil
}

// ============================= 用户投影 =============================

// userProjection sys_user 的对外投影（仅公开字段，不触及敏感列）。
type userProjection struct {
	ID       int64
	PublicID string
	Nickname string
	Avatar   string
}

// UsersByIDs 批量查询作者投影（内部用户ID → 昵称/头像/public_id），缺失的ID不在结果中。
func (r *Repository) UsersByIDs(ids []int64) (map[int64]userProjection, error) {
	result := make(map[int64]userProjection, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []userProjection
	if err := r.db.Model(&model.SysUser{}).
		Select("id", "public_id", "nickname", "avatar").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ID] = row
	}
	return result, nil
}
