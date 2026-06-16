package notification

import (
	"strings"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 通知数据访问（GORM）。sys_notification 无逻辑删除（流水表，物理保留）。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接。
func (r *Repository) DB() *gorm.DB { return r.db }

// Create 新增一条通知（主键由模型 BeforeCreate 注入）。
func (r *Repository) Create(n *model.SysNotification) error {
	return r.db.Create(n).Error
}

// PageByReceiver 按接收者分页查询通知（按 create_time 倒序，id 兜底稳定排序）。
// typ 非空时按类型过滤。返回当前页记录与总数。
func (r *Repository) PageByReceiver(receiverID int64, typ string, pageNum, pageSize int) ([]model.SysNotification, int64, error) {
	q := r.db.Model(&model.SysNotification{}).Where("receiver_id = ?", receiverID)
	if strings.TrimSpace(typ) != "" {
		q = q.Where("type = ?", typ)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.SysNotification
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

// CountUnread 接收者未读通知数（is_read = 0）。
func (r *Repository) CountUnread(receiverID int64) (int64, error) {
	var n int64
	err := r.db.Model(&model.SysNotification{}).
		Where("receiver_id = ? AND is_read = 0", receiverID).
		Count(&n).Error
	return n, err
}

// MarkRead 将接收者名下指定 id 的通知标记为已读（带 receiver_id 约束，防越权改他人通知）。
// ids 为空直接返回。
func (r *Repository) MarkRead(receiverID int64, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	return r.db.Model(&model.SysNotification{}).
		Where("receiver_id = ? AND id IN ?", receiverID, ids).
		UpdateColumn("is_read", 1).Error
}

// MarkAllRead 将接收者全部未读通知标记为已读。
func (r *Repository) MarkAllRead(receiverID int64) error {
	return r.db.Model(&model.SysNotification{}).
		Where("receiver_id = ? AND is_read = 0", receiverID).
		UpdateColumn("is_read", 1).Error
}

// FollowedSet 在给定候选用户集合中，筛出 follower 已关注的那些（用于关注类通知批量标注 followedByMe）。
// 直接查 sys_follow（follower_id = follower AND followee_id IN followees），避免耦合 follow 模块。
// 返回 已被 follower 关注的 followee_id 集合；followees 为空返回空集。
func (r *Repository) FollowedSet(follower int64, followees []int64) (map[int64]bool, error) {
	set := make(map[int64]bool, len(followees))
	if len(followees) == 0 {
		return set, nil
	}
	var ids []int64
	err := r.db.Model(&model.SysFollow{}).
		Where("follower_id = ? AND followee_id IN ?", follower, followees).
		Pluck("followee_id", &ids).Error
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		set[id] = true
	}
	return set, nil
}
