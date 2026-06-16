package notification

import (
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// UserFinder 用户只读查询（跨模块只读依赖，避免直接耦合 user 模块实现）。
// 通知列表需触发者（actor）昵称/头像，并把内部 user_id 映射为对外 public_id。
// 仅读取展示所需字段，绝不向外暴露雪花主键，也不写入。参考 follow.DBUserFinder。
type UserFinder interface {
	// FindUsers 批量按内部主键查询，返回 内部用户ID → 用户 的映射（缺失的ID不在结果中）。
	FindUsers(ids []int64) (map[int64]*model.SysUser, error)
}

// TargetFinder 目标内容(帖子/博客)对外ID反解：把内部雪花主键批量映射为 public_id。
// 用于把通知的 target_id 转为前端可跳转的 targetPublicId；转不到（已删/不存在）则不在结果中（VO 留空串）。
type TargetFinder interface {
	// PostPublicIDs 批量按帖子内部ID查 public_id，返回 内部ID → public_id 映射。
	PostPublicIDs(ids []int64) (map[int64]string, error)
	// BlogPublicIDs 批量按博客内部ID查 public_id，返回 内部ID → public_id 映射。
	BlogPublicIDs(ids []int64) (map[int64]string, error)
}

// DBUserFinder 基于共享数据库连接的 UserFinder：只读 sys_user。
type DBUserFinder struct{ db *gorm.DB }

// NewDBUserFinder 构造（传入 router 中共享的 *gorm.DB）。
func NewDBUserFinder(db *gorm.DB) *DBUserFinder { return &DBUserFinder{db: db} }

// FindUsers 批量按主键查询，返回 内部用户ID → 用户 映射。
func (f *DBUserFinder) FindUsers(ids []int64) (map[int64]*model.SysUser, error) {
	result := make(map[int64]*model.SysUser, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var users []model.SysUser
	if err := f.db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for i := range users {
		result[users[i].ID] = &users[i]
	}
	return result, nil
}

// DBTargetFinder 基于共享数据库连接的 TargetFinder：只读 community_post / blog_post 的 id↔public_id 投影。
type DBTargetFinder struct{ db *gorm.DB }

// NewDBTargetFinder 构造（传入 router 中共享的 *gorm.DB）。
func NewDBTargetFinder(db *gorm.DB) *DBTargetFinder { return &DBTargetFinder{db: db} }

// idPublic 内部ID与 public_id 的投影行。
type idPublic struct {
	ID       int64
	PublicID string
}

// PostPublicIDs 批量按帖子内部ID查 public_id（含已逻辑删除的帖子也尽量反解，便于历史通知跳转）。
func (f *DBTargetFinder) PostPublicIDs(ids []int64) (map[int64]string, error) {
	return f.publicIDs(&model.CommunityPost{}, ids)
}

// BlogPublicIDs 批量按博客内部ID查 public_id。
func (f *DBTargetFinder) BlogPublicIDs(ids []int64) (map[int64]string, error) {
	return f.publicIDs(&model.BlogPost{}, ids)
}

// publicIDs 通用 id→public_id 反解。Unscoped 忽略逻辑删除，使被删内容的历史通知仍可拿到 public_id。
func (f *DBTargetFinder) publicIDs(modelPtr interface{}, ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var rows []idPublic
	if err := f.db.Unscoped().Model(modelPtr).
		Select("id", "public_id").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ID] = row.PublicID
	}
	return out, nil
}
