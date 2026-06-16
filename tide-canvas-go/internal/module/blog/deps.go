package blog

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// PointsService 积分能力依赖（对齐旧 PointsService 中博客模块所需子集）。
// 方法名/签名与 points.Service 对齐，points 模块迁移后由 router.New 直接注入其实现。
// txType 取 points 包导出常量（如 points.TxBlogView / TxTipOut / TxTipIn）。
// TODO(wire): 由 router.New 注入 points.Service。
type PointsService interface {
	// AddPoints 加积分并写流水（amount>0，bizID 可空）。
	AddPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// DeductPoints 扣积分并写流水；余额不足返回 ecode.PointsInsufficient。
	DeductPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// AddPointsTx / DeductPointsTx 在调用方事务 tx 内加 / 扣积分并写流水（与博客购买/打赏的业务写入同一物理事务）。
	AddPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
	DeductPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
}

// Notifier 通知投递（跨模块可选依赖）：点赞 / 打赏博客成功后给作者发通知。
// 由 notification.Service 实现，router.New 装配时注入；nil 安全（不发通知）。
// 方法签名对齐 notification.Service.CreateNotification。
//
// 说明：博客无评论功能。已接入「点赞博客」(type=like) 与「打赏博客」(type=tip)，targetType 均为 blog，
// actor==作者(自赞/自赏) 时由通知层自动跳过。
type Notifier interface {
	CreateNotification(receiverID, actorID int64, typ, targetType string, targetID int64, content string) error
}

// UserFinder 用户只读查询（跨模块只读依赖，避免直接耦合 user 模块实现）。
// 博客 VO 需作者昵称/头像，并把作者内部 user_id 映射为对外 public_id；列表按作者过滤时
// 还需将 public_id 反解为内部主键。仅读取，绝不向外暴露雪花主键，也不写入。
// TODO(wire): 由 router.New 注入（默认 NewDBUserFinder(db) 直读 sys_user）。
type UserFinder interface {
	// FindUser 按内部主键查询用户，未找到返回 (nil, nil)。
	FindUser(id int64) (*model.SysUser, error)
	// FindUsers 批量按内部主键查询，返回 内部用户ID → 用户 的映射（缺失的ID不在结果中）。
	FindUsers(ids []int64) (map[int64]*model.SysUser, error)
	// IDByPublicID 按对外 public_id 反查内部主键，未找到返回 (nil, nil)。
	IDByPublicID(publicID string) (*int64, error)
}

// DBUserFinder 基于共享数据库连接的 UserFinder：只读 sys_user。
// 仅读取作者展示所需字段与 id/public_id 映射，不触及敏感字段，也不写入。
type DBUserFinder struct{ db *gorm.DB }

// NewDBUserFinder 构造（传入 router 中共享的 *gorm.DB 或 userRepo.DB()）。
func NewDBUserFinder(db *gorm.DB) *DBUserFinder { return &DBUserFinder{db: db} }

// FindUser 按主键查询用户，未找到返回 (nil, nil)。
func (f *DBUserFinder) FindUser(id int64) (*model.SysUser, error) {
	var u model.SysUser
	err := f.db.First(&u, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

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
