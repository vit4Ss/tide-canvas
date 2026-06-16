package team

import (
	"errors"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 团队数据访问（GORM）。
//
// 注意：team_member 的 deleted 是逻辑删除，但「退出/移除/解散」必须物理删除——
// 否则软删行仍占住 uk_user_id，导致用户无法再次加入任何团队（忠实迁移旧 mapper 的
// physicalDeleteById / physicalDeleteByTeam）。物理删除统一用 Unscoped()。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供 service 做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// WithTx 返回绑定到给定事务的 Repository 副本（事务内复用各方法）。
func (r *Repository) WithTx(tx *gorm.DB) *Repository { return &Repository{db: tx} }

// ===== team =====

// FindTeamByID 按主键查询团队，未找到返回 (nil, nil)。
func (r *Repository) FindTeamByID(id int64) (*model.Team, error) {
	var t model.Team
	err := r.db.First(&t, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// FindTeamByInviteCode 按邀请码查询团队，未找到返回 (nil, nil)。
func (r *Repository) FindTeamByInviteCode(code string) (*model.Team, error) {
	var t model.Team
	err := r.db.Where("invite_code = ?", code).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CountTeamByInviteCode 统计某邀请码占用数（生成唯一码时用）。
func (r *Repository) CountTeamByInviteCode(code string) (int64, error) {
	var n int64
	err := r.db.Model(&model.Team{}).Where("invite_code = ?", code).Count(&n).Error
	return n, err
}

// CreateTeam 新增团队（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) CreateTeam(t *model.Team) error {
	return r.db.Create(t).Error
}

// DeleteTeam 逻辑删除团队（团队本身软删即可，对齐旧 deleteById）。
func (r *Repository) DeleteTeam(id int64) error {
	return r.db.Delete(&model.Team{}, id).Error
}

// BumpMemberCount 成员数增减，下限 0（对齐旧 GREATEST(member_count + delta, 0)）。
func (r *Repository) BumpMemberCount(teamID int64, delta int) error {
	return r.db.Model(&model.Team{}).
		Where("id = ?", teamID).
		Update("member_count", gorm.Expr("GREATEST(member_count + ?, 0)", delta)).Error
}

// ===== team_member =====

// FindMembershipByUser 按 user_id 查询团队成员关系（uk_user_id 保证至多一条有效行），
// 未找到返回 (nil, nil)。GORM 自动过滤 deleted=0。
func (r *Repository) FindMembershipByUser(userID int64) (*model.TeamMember, error) {
	var m model.TeamMember
	err := r.db.Where("user_id = ?", userID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// CreateMember 新增成员关系。并发下若命中 uk_user_id 唯一键会返回 error（service 兜底）。
func (r *Repository) CreateMember(m *model.TeamMember) error {
	return r.db.Create(m).Error
}

// ListMembersByTeam 按团队列出成员，按加入时间升序（对齐旧 orderByAsc(createTime)）。
func (r *Repository) ListMembersByTeam(teamID int64) ([]model.TeamMember, error) {
	var members []model.TeamMember
	err := r.db.Where("team_id = ?", teamID).Order("create_time ASC").Find(&members).Error
	return members, err
}

// ListMemberUserIDsByTeam 取团队全体成员的 user_id（对齐旧 selectUserIdsByTeam）。
func (r *Repository) ListMemberUserIDsByTeam(teamID int64) ([]int64, error) {
	var ids []int64
	err := r.db.Model(&model.TeamMember{}).
		Where("team_id = ?", teamID).
		Pluck("user_id", &ids).Error
	return ids, err
}

// PhysicalDeleteMemberByID 按主键物理删除成员关系（Unscoped 绕过软删，释放 uk_user_id）。
func (r *Repository) PhysicalDeleteMemberByID(id int64) error {
	return r.db.Unscoped().Delete(&model.TeamMember{}, id).Error
}

// PhysicalDeleteMembersByTeam 物理删除团队全部成员关系（解散用）。
func (r *Repository) PhysicalDeleteMembersByTeam(teamID int64) error {
	return r.db.Unscoped().Where("team_id = ?", teamID).Delete(&model.TeamMember{}).Error
}

// ===== sys_user（仅维护冗余 team_id 缓存 / 读取展示资料） =====

// FindUserByID 按主键查询用户，未找到返回 (nil, nil)。
func (r *Repository) FindUserByID(id int64) (*model.SysUser, error) {
	var u model.SysUser
	err := r.db.First(&u, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// FindUserByPublicID 按对外 public_id 查询用户，未找到返回 (nil, nil)。
func (r *Repository) FindUserByPublicID(publicID string) (*model.SysUser, error) {
	var u model.SysUser
	err := r.db.Where("public_id = ?", publicID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ListUsersByIDs 批量查询用户（用于成员资料展示），保持稳定无序返回。
func (r *Repository) ListUsersByIDs(ids []int64) ([]model.SysUser, error) {
	if len(ids) == 0 {
		return []model.SysUser{}, nil
	}
	var users []model.SysUser
	err := r.db.Where("id IN ?", ids).Find(&users).Error
	return users, err
}

// SetUserTeam 更新用户冗余 team_id 缓存；teamID 传 nil 表示清空（退出/解散）。
// 显式写 NULL，故用 Update 指定列而非 Updates(map) 以免被零值忽略。
func (r *Repository) SetUserTeam(userID int64, teamID *int64) error {
	return r.db.Model(&model.SysUser{}).
		Where("id = ?", userID).
		Update("team_id", teamID).Error
}

// ClearTeamForUsers 批量清空一组用户的 team_id（解散团队用）。
func (r *Repository) ClearTeamForUsers(userIDs []int64) error {
	if len(userIDs) == 0 {
		return nil
	}
	return r.db.Model(&model.SysUser{}).
		Where("id IN ?", userIDs).
		Update("team_id", nil).Error
}

// ===== sys_config（团队加价系数） =====

// FindConfigByKey 按配置键查询，未找到返回 (nil, nil)。
func (r *Repository) FindConfigByKey(key string) (*model.SysConfig, error) {
	var cfg model.SysConfig
	err := r.db.Where("config_key = ?", key).First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}
