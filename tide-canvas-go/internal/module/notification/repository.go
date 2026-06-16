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
