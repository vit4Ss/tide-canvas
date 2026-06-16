package follow

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Notifier 通知投递（跨模块可选依赖）：关注成功后给被关注者发一条「关注了你」通知。
// 由 notification.Service 实现，router.New 装配时注入；nil 表示未接入通知系统（nil 安全，不发通知）。
// 方法签名对齐 notification.Service.CreateNotification。
type Notifier interface {
	CreateNotification(receiverID, actorID int64, typ, targetType string, targetID int64, content string) error
}

// UserFinder 用户只读查询（跨模块只读依赖，避免直接耦合 user 模块实现）。
// 关注/粉丝列表需用户昵称/头像，并把内部 user_id 映射为对外 public_id；
// 关注/取关按对方 public_id 操作时还需反解为内部主键。仅读取，绝不向外暴露雪花主键，也不写入。
type UserFinder interface {
	// FindUsers 批量按内部主键查询，返回 内部用户ID → 用户 的映射（缺失的ID不在结果中）。
	FindUsers(ids []int64) (map[int64]*model.SysUser, error)
	// IDByPublicID 按对外 public_id 反查内部主键，未找到返回 (nil, nil)。
	IDByPublicID(publicID string) (*int64, error)
}

// DBUserFinder 基于共享数据库连接的 UserFinder：只读 sys_user。
// 仅读取展示所需字段与 id/public_id 映射，不触及敏感字段，也不写入。
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

// IDByPublicID 按对外 public_id 反查内部主键，未找到返回 (nil, nil)。
func (f *DBUserFinder) IDByPublicID(publicID string) (*int64, error) {
	var u model.SysUser
	err := f.db.Select("id").Where("public_id = ?", publicID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u.ID, nil
}
