package team

import (
	"crypto/rand"
	"math/big"
	"strings"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

const (
	// priceFactorKey 团队加价系数在 sys_config 的键。
	priceFactorKey = "team.price.factor"
	// codeAlphabet 邀请码字符集（剔除易混淆字符 I/O/0/1）。
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	// codeLen 邀请码长度。
	codeLen = 8

	// roleMember 团队内角色：成员。
	roleMember = 0
	// roleAdmin 团队内角色：管理员（创建者）。
	roleAdmin = 1
)

// defaultFactor 读不到/非法配置时的默认加价系数 1.5。
var defaultFactor = decimal.RequireFromString("1.5")

// Service 团队业务逻辑（对齐 TeamServiceImpl）。业务错误返回 *ecode.Error。
type Service struct {
	repo   *Repository
	db     *gorm.DB
	logger *logrus.Logger
}

// NewService 构造团队服务。
func NewService(repo *Repository, logger *logrus.Logger) *Service {
	return &Service{repo: repo, db: repo.DB(), logger: logger}
}

// CreateTeam 创建团队：校验未在团队 → 建团队(member_count=1) → 写管理员成员 → 写用户 team_id 缓存。
func (s *Service) CreateTeam(userID int64, req *CreateReq) (*TeamVO, error) {
	if err := s.assertNotInTeam(s.repo, userID); err != nil {
		return nil, err
	}
	code, err := s.generateUniqueCode()
	if err != nil {
		return nil, err
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		r := s.repo.WithTx(tx)
		team := &model.Team{
			Name:        strings.TrimSpace(req.Name),
			OwnerID:     userID,
			InviteCode:  code,
			MemberCount: 1,
		}
		if err := r.CreateTeam(team); err != nil {
			return err
		}
		if err := r.CreateMember(&model.TeamMember{TeamID: team.ID, UserID: userID, Role: roleAdmin}); err != nil {
			return err
		}
		return r.SetUserTeam(userID, &team.ID)
	})
	if err != nil {
		return nil, err
	}
	return s.GetMyTeam(userID)
}

// JoinByCode 凭邀请码加入团队：校验未在团队 → 找团队 → 写成员(并发兜底) → 成员数+1 → 写缓存。
func (s *Service) JoinByCode(userID int64, req *JoinReq) (*TeamVO, error) {
	if err := s.assertNotInTeam(s.repo, userID); err != nil {
		return nil, err
	}
	team, err := s.repo.FindTeamByInviteCode(strings.TrimSpace(req.InviteCode))
	if err != nil {
		return nil, err
	}
	if team == nil {
		return nil, ecode.NotFound.WithMessage("邀请码无效")
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		r := s.repo.WithTx(tx)
		if err := r.CreateMember(&model.TeamMember{TeamID: team.ID, UserID: userID, Role: roleMember}); err != nil {
			// uk_user_id 并发兜底：若已存在成员关系，按「已在一个团队中」处理。
			if existing, qErr := r.FindMembershipByUser(userID); qErr == nil && existing != nil {
				return ecode.BadRequest.WithMessage("您已在一个团队中")
			}
			return err
		}
		if err := r.BumpMemberCount(team.ID, 1); err != nil {
			return err
		}
		return r.SetUserTeam(userID, &team.ID)
	})
	if err != nil {
		return nil, err
	}
	return s.GetMyTeam(userID)
}

// LeaveTeam 退出团队（管理员需先解散）。物理删除成员关系以释放 uk_user_id。
func (s *Service) LeaveTeam(userID int64) error {
	member, err := s.repo.FindMembershipByUser(userID)
	if err != nil {
		return err
	}
	if member == nil {
		return ecode.BadRequest.WithMessage("您不在任何团队中")
	}
	if member.Role == roleAdmin {
		return ecode.BadRequest.WithMessage("团队管理员需先解散团队")
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		r := s.repo.WithTx(tx)
		if err := r.PhysicalDeleteMemberByID(member.ID); err != nil {
			return err
		}
		if err := r.BumpMemberCount(member.TeamID, -1); err != nil {
			return err
		}
		return r.SetUserTeam(userID, nil)
	})
}

// RemoveMember 移除成员（仅管理员；不能移除自己）。物理删除以释放 uk_user_id。
func (s *Service) RemoveMember(operatorID, targetUserID int64) error {
	operator, err := s.repo.FindMembershipByUser(operatorID)
	if err != nil {
		return err
	}
	if operator == nil || operator.Role != roleAdmin {
		return ecode.Forbidden.WithMessage("仅团队管理员可移除成员")
	}
	if operatorID == targetUserID {
		return ecode.BadRequest.WithMessage("管理员不能移除自己，请使用解散团队")
	}
	target, err := s.repo.FindMembershipByUser(targetUserID)
	if err != nil {
		return err
	}
	if target == nil || operator.TeamID != target.TeamID {
		return ecode.BadRequest.WithMessage("该成员不在你的团队中")
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		r := s.repo.WithTx(tx)
		if err := r.PhysicalDeleteMemberByID(target.ID); err != nil {
			return err
		}
		if err := r.BumpMemberCount(operator.TeamID, -1); err != nil {
			return err
		}
		return r.SetUserTeam(targetUserID, nil)
	})
}

// Disband 解散团队（仅管理员）：清空全体成员 team_id 缓存 → 物理删成员关系 → 团队逻辑删除。
func (s *Service) Disband(userID int64) error {
	operator, err := s.repo.FindMembershipByUser(userID)
	if err != nil {
		return err
	}
	if operator == nil || operator.Role != roleAdmin {
		return ecode.Forbidden.WithMessage("仅团队管理员可解散团队")
	}
	teamID := operator.TeamID
	memberIDs, err := s.repo.ListMemberUserIDsByTeam(teamID)
	if err != nil {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		r := s.repo.WithTx(tx)
		if err := r.ClearTeamForUsers(memberIDs); err != nil {
			return err
		}
		if err := r.PhysicalDeleteMembersByTeam(teamID); err != nil {
			return err
		}
		return r.DeleteTeam(teamID) // 团队本身逻辑删除即可
	})
}

// GetMyTeam 当前用户的团队（含成员列表）；不在团队返回 (nil, nil)。
// 读路径以 sys_user.team_id 冗余缓存为入口（忠实旧实现）。
func (s *Service) GetMyTeam(userID int64) (*TeamVO, error) {
	user, err := s.repo.FindUserByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.TeamID == nil {
		return nil, nil
	}
	team, err := s.repo.FindTeamByID(*user.TeamID)
	if err != nil {
		return nil, err
	}
	if team == nil {
		return nil, nil
	}
	members, err := s.repo.ListMembersByTeam(team.ID)
	if err != nil {
		return nil, err
	}

	ids := make([]int64, 0, len(members))
	for _, m := range members {
		ids = append(ids, m.UserID)
	}
	users, err := s.repo.ListUsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	userMap := make(map[int64]model.SysUser, len(users))
	for _, u := range users {
		userMap[u.ID] = u
	}

	memberVOs := make([]TeamMemberVO, 0, len(members))
	for _, m := range members {
		vo := TeamMemberVO{
			Role:     m.Role,
			IsOwner:  team.OwnerID == m.UserID,
			JoinTime: m.CreateTime,
		}
		if u, ok := userMap[m.UserID]; ok {
			vo.UserID = u.PublicID
			vo.Username = u.Username
			vo.Nickname = u.Nickname
			vo.Avatar = u.Avatar
		}
		memberVOs = append(memberVOs, vo)
	}

	return &TeamVO{
		ID:          team.PublicID,
		Name:        team.Name,
		InviteCode:  team.InviteCode,
		MemberCount: team.MemberCount,
		PriceFactor: s.readFactor(),
		IAmOwner:    team.OwnerID == userID,
		Members:     memberVOs,
		CreateTime:  team.CreateTime,
	}, nil
}

// GetTeamMemberIDs 当前用户可见资源的归属用户ID集合：
// 无团队 → [userID]；有团队 → 全体成员ID（用于素材/项目/历史共享）。
func (s *Service) GetTeamMemberIDs(userID int64) ([]int64, error) {
	user, err := s.repo.FindUserByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.TeamID == nil {
		return []int64{userID}, nil
	}
	ids, err := s.repo.ListMemberUserIDsByTeam(*user.TeamID)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []int64{userID}, nil
	}
	return ids, nil
}

// GetPriceFactor AI 消耗加价系数（对齐 TeamService.getPriceFactor，供 auth/AI 计费注入）：
// 非团队成员返回 1；团队成员读 sys_config 的 team.price.factor（clamp ≥ 1）。
// 团队成员关系以 sys_user.team_id 冗余缓存为准（忠实旧实现）。
// 签名无 error 以满足 auth.TeamPriceProvider 接口；任何读取异常按安全侧回退（非成员→1）。
func (s *Service) GetPriceFactor(userID int64) decimal.Decimal {
	user, err := s.repo.FindUserByID(userID)
	if err != nil || user == nil || user.TeamID == nil {
		return decimal.NewFromInt(1)
	}
	return s.readFactor()
}

// IsTeamAdminOf operator 是否为 ownerUserID 同团队的团队管理员
// （用于放行删除队友资源，对齐 isTeamAdminOf）。判定以 team_member 表为准。
func (s *Service) IsTeamAdminOf(operatorID, ownerUserID int64) (bool, error) {
	operator, err := s.repo.FindMembershipByUser(operatorID)
	if err != nil {
		return false, err
	}
	if operator == nil || operator.Role != roleAdmin {
		return false, nil
	}
	target, err := s.repo.FindMembershipByUser(ownerUserID)
	if err != nil {
		return false, err
	}
	return target != nil && operator.TeamID == target.TeamID, nil
}

// ResolveUserID 将对外 public_id 解析为内部用户主键（移除成员的路径参数用）。
// 用户不存在返回 404，遵循对外ID规范不暴露雪花主键。
func (s *Service) ResolveUserID(publicID string) (int64, error) {
	if strings.TrimSpace(publicID) == "" {
		return 0, ecode.BadRequest
	}
	u, err := s.repo.FindUserByPublicID(publicID)
	if err != nil {
		return 0, err
	}
	if u == nil {
		return 0, ecode.AccountNotFound
	}
	return u.ID, nil
}

// ===== 内部辅助 =====

// assertNotInTeam 校验用户当前不在任何团队（以 team_member 为准）。
func (s *Service) assertNotInTeam(r *Repository, userID int64) error {
	m, err := r.FindMembershipByUser(userID)
	if err != nil {
		return err
	}
	if m != nil {
		return ecode.BadRequest.WithMessage("您已在一个团队中，请先退出")
	}
	return nil
}

// readFactor 全局加价系数，clamp ≥ 1（永不比个人便宜）；读不到/非法回退默认 1.5。
func (s *Service) readFactor() decimal.Decimal {
	factor := defaultFactor
	cfg, err := s.repo.FindConfigByKey(priceFactorKey)
	if err == nil && cfg != nil && strings.TrimSpace(cfg.ConfigValue) != "" {
		if parsed, pErr := decimal.NewFromString(strings.TrimSpace(cfg.ConfigValue)); pErr == nil {
			factor = parsed
		} else if s.logger != nil {
			s.logger.Warnf("Invalid %s config '%s', using default %s", priceFactorKey, cfg.ConfigValue, defaultFactor)
		}
	}
	if factor.LessThan(decimal.NewFromInt(1)) {
		return decimal.NewFromInt(1)
	}
	return factor
}

// generateUniqueCode 生成全局唯一邀请码：8 位、加密随机、字符集剔除易混淆字符；
// 最多重试 5 次仍冲突则回退取 UUID 前 8 位大写（对齐旧 generateUniqueCode）。
func (s *Service) generateUniqueCode() (string, error) {
	for attempt := 0; attempt < 5; attempt++ {
		code, err := randomCode()
		if err != nil {
			return "", err
		}
		count, err := s.repo.CountTeamByInviteCode(code)
		if err != nil {
			return "", err
		}
		if count == 0 {
			return code, nil
		}
	}
	fallback := strings.ToUpper(strings.ReplaceAll(uuid.NewString(), "-", "")[:codeLen])
	return fallback, nil
}

// randomCode 用加密随机数从字符集取 codeLen 个字符。
func randomCode() (string, error) {
	alphabetLen := big.NewInt(int64(len(codeAlphabet)))
	var sb strings.Builder
	sb.Grow(codeLen)
	for i := 0; i < codeLen; i++ {
		n, err := rand.Int(rand.Reader, alphabetLen)
		if err != nil {
			return "", err
		}
		sb.WriteByte(codeAlphabet[n.Int64()])
	}
	return sb.String(), nil
}
