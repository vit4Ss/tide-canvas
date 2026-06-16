package follow

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 关注关系数据访问（GORM）。
//
// 关注用 ON CONFLICT DO NOTHING（MySQL 下即 INSERT IGNORE）保证幂等：命中 uk_follower_followee
// 时静默跳过，重复关注不报错。取关物理删除（sys_follow 无逻辑删除，删除即释放唯一键）。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接。
func (r *Repository) DB() *gorm.DB { return r.db }

// Follow 关注（follower 关注 followee）。幂等：已存在则不报错（INSERT IGNORE）。
func (r *Repository) Follow(followerID, followeeID int64) error {
	rel := &model.SysFollow{FollowerID: followerID, FolloweeID: followeeID}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(rel).Error
}

// Unfollow 取关（物理删除关注关系）。无记录时返回 nil（幂等）。
func (r *Repository) Unfollow(followerID, followeeID int64) error {
	return r.db.Where("follower_id = ? AND followee_id = ?", followerID, followeeID).
		Delete(&model.SysFollow{}).Error
}

// IsFollowing follower 是否已关注 followee。
func (r *Repository) IsFollowing(followerID, followeeID int64) (bool, error) {
	var n int64
	err := r.db.Model(&model.SysFollow{}).
		Where("follower_id = ? AND followee_id = ?", followerID, followeeID).
		Count(&n).Error
	return n > 0, err
}

// CountFollowing 我关注的人数（follower_id = userID）。
func (r *Repository) CountFollowing(userID int64) (int64, error) {
	var n int64
	err := r.db.Model(&model.SysFollow{}).Where("follower_id = ?", userID).Count(&n).Error
	return n, err
}

// CountFollowers 关注我的人数（followee_id = userID）。
func (r *Repository) CountFollowers(userID int64) (int64, error) {
	var n int64
	err := r.db.Model(&model.SysFollow{}).Where("followee_id = ?", userID).Count(&n).Error
	return n, err
}

// ListFollowing 我关注的人（分页）：返回关注关系行（含 followee_id 与建立时间），按时间倒序，并返回总数。
func (r *Repository) ListFollowing(userID int64, pageNum, pageSize int) ([]model.SysFollow, int64, error) {
	return r.page("follower_id = ?", userID, pageNum, pageSize)
}

// ListFollowers 关注我的人（分页）：返回关注关系行（含 follower_id 与建立时间），按时间倒序，并返回总数。
func (r *Repository) ListFollowers(userID int64, pageNum, pageSize int) ([]model.SysFollow, int64, error) {
	return r.page("followee_id = ?", userID, pageNum, pageSize)
}

// page 关注关系分页通用查询（按 create_time 倒序，id 兜底稳定排序）。
func (r *Repository) page(cond string, userID int64, pageNum, pageSize int) ([]model.SysFollow, int64, error) {
	q := r.db.Model(&model.SysFollow{}).Where(cond, userID)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.SysFollow
	if total == 0 {
		return rows, 0, nil
	}
	err := q.Order("create_time DESC, id DESC").
		Offset((pageNum - 1) * pageSize).
		Limit(pageSize).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// FollowingSet 在给定候选用户集合中，筛出 userID 已关注的那些（用于列表批量标注 following）。
// 返回 已关注的 followee_id 集合。candidateIDs 为空返回空集。
func (r *Repository) FollowingSet(userID int64, candidateIDs []int64) (map[int64]bool, error) {
	set := make(map[int64]bool, len(candidateIDs))
	if len(candidateIDs) == 0 {
		return set, nil
	}
	var ids []int64
	err := r.db.Model(&model.SysFollow{}).
		Where("follower_id = ? AND followee_id IN ?", userID, candidateIDs).
		Pluck("followee_id", &ids).Error
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		set[id] = true
	}
	return set, nil
}

// FollowerSet 在给定候选用户集合中，筛出「关注了 userID」的那些（用于列表批量标注 followedBy）。
// 返回 关注了 userID 的 follower_id 集合。candidateIDs 为空返回空集。
func (r *Repository) FollowerSet(userID int64, candidateIDs []int64) (map[int64]bool, error) {
	set := make(map[int64]bool, len(candidateIDs))
	if len(candidateIDs) == 0 {
		return set, nil
	}
	var ids []int64
	err := r.db.Model(&model.SysFollow{}).
		Where("followee_id = ? AND follower_id IN ?", userID, candidateIDs).
		Pluck("follower_id", &ids).Error
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		set[id] = true
	}
	return set, nil
}
