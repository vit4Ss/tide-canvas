package canvas

import (
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// TeamProvider 团队共享关系提供者（对齐 TeamService 中项目模块所需的子集）。
// 方法名/签名与 team.Service 对齐，团队模块迁移后可直接注入其 *Service 实现本接口。
// TODO(wire): 由 router.New 注入 team 模块的真实实现（team.Service 已满足本接口）。
type TeamProvider interface {
	// GetTeamMemberIDs 当前用户可见资源的归属用户ID集合：
	// 无团队 → [userID]，有团队 → 全体成员ID（用于项目共享可见性）。
	GetTeamMemberIDs(userID int64) ([]int64, error)
	// IsTeamAdminOf operator 是否为 ownerUserID 同团队的团队管理员（用于放行删除队友项目）。
	IsTeamAdminOf(operatorID, ownerUserID int64) (bool, error)
}

// UserFinder 用户 public_id 解析（跨模块只读依赖，避免直接耦合 user 模块实现）。
// 用于把项目归属的内部 user_id 映射为对外 public_id，绝不向外暴露雪花主键。
// TODO(wire): 由 router.New 注入（默认 NewDBUserFinder(db) 直读 sys_user 投影）。
type UserFinder interface {
	// PublicIDsByIDs 批量返回 内部用户ID → public_id 的映射（缺失的ID可不在结果中）。
	PublicIDsByIDs(ids []int64) (map[int64]string, error)
}

// DefaultTeamProvider 未接入团队模块时的降级实现：等价于“用户不在任何团队”。
type DefaultTeamProvider struct{}

// GetTeamMemberIDs 无团队：可见范围仅本人。
func (DefaultTeamProvider) GetTeamMemberIDs(userID int64) ([]int64, error) {
	return []int64{userID}, nil
}

// IsTeamAdminOf 无团队：恒非管理员。
func (DefaultTeamProvider) IsTeamAdminOf(operatorID, ownerUserID int64) (bool, error) {
	return false, nil
}

// DBUserFinder 基于共享数据库连接的 UserFinder：只读 sys_user 的 id/public_id 投影做批量映射。
// 仅读取公开映射关系，不触及用户敏感字段，也不写入。
type DBUserFinder struct{ db *gorm.DB }

// NewDBUserFinder 构造（传入 router 中共享的 *gorm.DB 或 userRepo.DB()）。
func NewDBUserFinder(db *gorm.DB) *DBUserFinder { return &DBUserFinder{db: db} }

// PublicIDsByIDs 批量查询 内部用户ID → public_id 映射。
func (f *DBUserFinder) PublicIDsByIDs(ids []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	type row struct {
		ID       int64
		PublicID string
	}
	var rows []row
	if err := f.db.Model(&model.SysUser{}).
		Select("id", "public_id").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.ID] = r.PublicID
	}
	return result, nil
}
