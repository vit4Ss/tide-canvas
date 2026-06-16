package ai

import (
	"errors"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// ===== 跨模块注入接口（本模块内定义，勿改其他模块）=====
//
// 由 router.New 装配时注入真实实现：
//   - PointsService     ← points.Service（扣/退积分）
//   - TeamPriceProvider ← team.Service（AI 计费加价系数）
//   - ProjectFinder     ← 默认 NewDBProjectFinder(db)（团队共享项目归属校验）
//   - UserFinder        ← 默认 NewDBUserFinder(db)（日志用户名回填）
//   - FileSaver         ← 可选；nil 时结果直接存上游原 URL（见 service 转存逻辑）

// PointsService 积分扣减/返还能力（points.Service 已满足）。
// 交易类型取 points 包导出常量（points.TxAIConsume / points.TxAIRefund）。
type PointsService interface {
	// DeductPoints 扣积分并写流水。余额不足返回 ecode.PointsInsufficient。amount>0，bizID 可空。
	DeductPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// DeductPointsTx 在调用方已开启的事务 tx 内扣积分（与建任务同一事务，保证原子）。
	DeductPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
	// AddPoints 加积分并写流水（任务失败/取消/收尾退款）。amount>0，bizID 可空。
	AddPoints(userID int64, amount, txType int, bizID *int64, remark string) error
}

// TeamPriceProvider AI 计费加价系数（team.Service.GetPriceFactor 已满足）。
// 非团队成员返回 1；团队成员返回全局 team.price.factor（clamp ≥ 1）。
type TeamPriceProvider interface {
	GetPriceFactor(userID int64) decimal.Decimal
}

// ProjectFinder 画布项目归属与可见性（团队共享）只读依赖。
// 用于 public_id → 内部主键解析，以及「项目是否属于团队可见成员」校验（对齐 assertProjectOwned）。
type ProjectFinder interface {
	// ResolveProjectID 将画布 public_id 解析为内部主键；不存在返回 (0,false,nil)。空串返回 (0,false,nil)。
	ResolveProjectID(publicID string) (int64, bool, error)
	// CountOwnedByMembers 统计 projectID 属于 memberIDs 中任一成员的记录数（>0 即可见/可写）。
	CountOwnedByMembers(projectID int64, memberIDs []int64) (int64, error)
}

// TeamMemberProvider 团队共享可见成员集合（team.Service.GetTeamMemberIDs 已满足）。
// 无团队 → [userID]；有团队 → 全体成员ID（任务列表/历史/项目共享均按此口径）。
type TeamMemberProvider interface {
	GetTeamMemberIDs(userID int64) ([]int64, error)
}

// UserFinder 用户只读查询（日志列表回填用户名）。
type UserFinder interface {
	// UsernamesByIDs 批量返回 内部用户ID → 展示名（username 优先，空回退 nickname）。
	UsernamesByIDs(ids []int64) (map[int64]string, error)
}

// FileSaver 结果转存抽象（可选注入）。把上游返回的媒体 URL 转存到自有 OSS 并返回新地址。
// 旧实现未对生成结果做强制转存（图生图/视频参考要求公网 URL，由上传侧保证），故 Go 侧默认不注入：
// nil 时结果直接存上游原 URL。需要转存时由 router 注入 file 模块实现。
type FileSaver interface {
	SaveFromURL(userID int64, url string) (string, error)
}

// ===== 默认 / 降级实现 =====

// 编译期断言：默认实现满足对应接口。
var (
	_ ProjectFinder = (*DBProjectFinder)(nil)
	_ UserFinder    = (*DBUserFinder)(nil)
)

// DBProjectFinder 基于共享连接的 ProjectFinder：读 canvas_project 的 id/public_id/user_id 投影。
type DBProjectFinder struct{ db *gorm.DB }

// NewDBProjectFinder 构造。
func NewDBProjectFinder(db *gorm.DB) *DBProjectFinder { return &DBProjectFinder{db: db} }

// ResolveProjectID 画布 public_id → 内部主键。
func (f *DBProjectFinder) ResolveProjectID(publicID string) (int64, bool, error) {
	if publicID == "" {
		return 0, false, nil
	}
	var p model.CanvasProject
	err := f.db.Select("id").Where("public_id = ?", publicID).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return p.ID, true, nil
}

// CountOwnedByMembers 统计项目是否归属团队可见成员（对齐 assertProjectOwned 的 selectCount）。
func (f *DBProjectFinder) CountOwnedByMembers(projectID int64, memberIDs []int64) (int64, error) {
	if len(memberIDs) == 0 {
		return 0, nil
	}
	var n int64
	err := f.db.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id IN ?", projectID, memberIDs).
		Count(&n).Error
	return n, err
}

// DBUserFinder 基于共享连接的 UserFinder：读 sys_user 的 id/username/nickname 投影。
type DBUserFinder struct{ db *gorm.DB }

// NewDBUserFinder 构造。
func NewDBUserFinder(db *gorm.DB) *DBUserFinder { return &DBUserFinder{db: db} }

// UsernamesByIDs 批量查询 内部用户ID → 展示名（username 优先，空回退 nickname）。
func (f *DBUserFinder) UsernamesByIDs(ids []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	type row struct {
		ID       int64
		Username string
		Nickname string
	}
	var rows []row
	if err := f.db.Model(&model.SysUser{}).
		Select("id", "username", "nickname").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		name := r.Username
		if name == "" {
			name = r.Nickname
		}
		result[r.ID] = name
	}
	return result, nil
}
