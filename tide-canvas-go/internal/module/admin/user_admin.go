package admin

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/password"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

const (
	defaultAdminAPIQuota     = 100
	defaultAdminPoints       = 100
	defaultAdminStorageQuota = int64(1073741824)
)

// UserAdminService 用户管理服务（对齐 AdminUserController）。
type UserAdminService struct {
	repo *Repository
}

// NewUserAdminService 构造。
func NewUserAdminService(repo *Repository) *UserAdminService {
	return &UserAdminService{repo: repo}
}

// List 用户分页列表（对齐 AdminUserController.list）。
func (s *UserAdminService) List(q *UserQuery) ([]UserVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageUsers(q)
	if err != nil {
		return nil, 0, err
	}
	return toUserVOList(records), total, nil
}

// Get 用户详情（对齐 AdminUserController.get）；按 public_id 查询。
func (s *UserAdminService) Get(publicID string) (*UserVO, error) {
	user, err := s.repo.FindUserByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ecode.NotFound.WithMessage("用户不存在")
	}
	vo := toUserVO(user)
	return &vo, nil
}

// Create 管理员手动创建用户。
func (s *UserAdminService) Create(dto *UserCreateDTO) (*UserVO, error) {
	username := strings.TrimSpace(dto.Username)
	email := strings.TrimSpace(dto.Email)
	nickname := strings.TrimSpace(dto.Nickname)
	phone := strings.TrimSpace(dto.Phone)
	if username == "" {
		return nil, ecode.BadRequest.WithMessage("用户名不能为空")
	}
	if email == "" {
		return nil, ecode.BadRequest.WithMessage("邮箱不能为空")
	}
	if strings.TrimSpace(dto.Password) == "" {
		return nil, ecode.BadRequest.WithMessage("密码不能为空")
	}
	if nickname == "" {
		nickname = username
	}

	if exists, err := s.repo.ExistsUserByEmail(email); err != nil {
		return nil, err
	} else if exists {
		return nil, ecode.EmailExists
	}
	if exists, err := s.repo.ExistsUserByUsername(username); err != nil {
		return nil, err
	} else if exists {
		return nil, ecode.UsernameExists
	}
	if exists, err := s.repo.ExistsUserByNickname(nickname, nil); err != nil {
		return nil, err
	} else if exists {
		return nil, ecode.BadRequest.WithMessage("昵称已存在")
	}

	role := adminIntValue(dto.Role, 0)
	if role != 0 && role != 9 {
		return nil, ecode.BadRequest.WithMessage("角色参数无效")
	}
	vipLevel := adminIntValue(dto.VipLevel, 1)
	if vipLevel < 1 {
		return nil, ecode.BadRequest.WithMessage("会员等级无效")
	}
	concurrencyUnlimited := adminIntValue(dto.ConcurrencyUnlimited, 0)
	if concurrencyUnlimited != 0 && concurrencyUnlimited != 1 {
		return nil, ecode.BadRequest.WithMessage("免并发限制参数无效")
	}
	status := adminIntValue(dto.Status, 1)
	if status != 0 && status != 1 {
		return nil, ecode.BadRequest.WithMessage("状态参数无效")
	}
	apiQuota := adminIntValue(dto.APIQuota, defaultAdminAPIQuota)
	if apiQuota < 0 {
		return nil, ecode.BadRequest.WithMessage("API 额度不能为负数")
	}
	points := adminIntValue(dto.Points, defaultAdminPoints)
	if points < 0 {
		return nil, ecode.BadRequest.WithMessage("初始积分不能为负数")
	}
	storageQuota := adminInt64Value(dto.StorageQuota, defaultAdminStorageQuota)
	if storageQuota < 0 {
		return nil, ecode.BadRequest.WithMessage("存储额度不能为负数")
	}

	var roleID *int64
	if role == 9 && dto.RoleID != nil {
		v := *dto.RoleID
		roleID = &v
	}

	hashed, err := password.Hash(dto.Password)
	if err != nil {
		return nil, err
	}
	user := &model.SysUser{
		Username:             username,
		Email:                email,
		Phone:                phone,
		Password:             hashed,
		Nickname:             nickname,
		Role:                 role,
		VipLevel:             vipLevel,
		ConcurrencyUnlimited: concurrencyUnlimited,
		RoleID:               roleID,
		Status:               status,
		APIQuota:             apiQuota,
		Points:               points,
		IsAuthor:             0,
		StorageQuota:         storageQuota,
	}
	if err := s.repo.CreateUser(user); err != nil {
		return nil, err
	}
	vo := toUserVO(user)
	return &vo, nil
}

// Update 编辑用户（对齐 AdminUserController.update）；按 public_id 定位，仅更新非空字段。
func (s *UserAdminService) Update(publicID string, dto *UserUpdateDTO) error {
	user, err := s.repo.FindUserByPublicID(publicID)
	if err != nil {
		return err
	}
	if user == nil {
		return ecode.NotFound.WithMessage("用户不存在")
	}
	columns := make(map[string]interface{})
	if dto.Role != nil {
		columns["role"] = *dto.Role
	}
	if dto.VipLevel != nil {
		columns["vip_level"] = *dto.VipLevel
	}
	if dto.ConcurrencyUnlimited != nil {
		columns["concurrency_unlimited"] = *dto.ConcurrencyUnlimited
	}
	if dto.RoleID != nil {
		columns["role_id"] = *dto.RoleID
	}
	if dto.Status != nil {
		columns["status"] = *dto.Status
	}
	if dto.APIQuota != nil {
		columns["api_quota"] = *dto.APIQuota
	}
	if dto.StorageQuota != nil {
		columns["storage_quota"] = *dto.StorageQuota
	}
	return s.repo.UpdateUserColumns(user.ID, columns)
}

// ResetPassword 管理员手动重置用户密码；按 public_id 定位。
func (s *UserAdminService) ResetPassword(publicID string, dto *UserPasswordResetDTO) error {
	user, err := s.repo.FindUserByPublicID(publicID)
	if err != nil {
		return err
	}
	if user == nil {
		return ecode.NotFound.WithMessage("用户不存在")
	}
	if strings.TrimSpace(dto.NewPassword) == "" {
		return ecode.BadRequest.WithMessage("新密码不能为空")
	}
	hashed, err := password.Hash(dto.NewPassword)
	if err != nil {
		return err
	}
	now := time.Now()
	return s.repo.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.SysUser{}).Where("id = ?", user.ID).Update("password", hashed).Error; err != nil {
			return err
		}
		// 管理员已强制改密后，作废该用户仍未使用的邮件重置链接，避免旧链接再次覆盖密码。
		return tx.Model(&model.PasswordResetToken{}).Where("user_id = ? AND used_at IS NULL", user.ID).Update("used_at", now).Error
	})
}

func adminIntValue(v *int, fallback int) int {
	if v == nil {
		return fallback
	}
	return *v
}

func adminInt64Value(v *int64, fallback int64) int64 {
	if v == nil {
		return fallback
	}
	return *v
}

// toUserVO 单个用户转 VO。id 取 public_id；teamId 非空视为在团队。
func toUserVO(u *model.SysUser) UserVO {
	return UserVO{
		ID:                   u.PublicID,
		Username:             u.Username,
		Email:                u.Email,
		Phone:                u.Phone,
		Nickname:             u.Nickname,
		Avatar:               u.Avatar,
		Role:                 u.Role,
		VipLevel:             u.VipLevel,
		ConcurrencyUnlimited: u.ConcurrencyUnlimited,
		RoleID:               u.RoleID,
		Status:               u.Status,
		APIQuota:             u.APIQuota,
		Points:               u.Points,
		IsAuthor:             u.IsAuthor,
		StorageQuota:         u.StorageQuota,
		TeamID:               u.TeamID,
		InTeam:               u.TeamID != nil,
		CreateTime:           u.CreateTime,
		LastLoginTime:        u.LastLoginTime,
	}
}

// toUserVOList 批量转 VO。
func toUserVOList(records []model.SysUser) []UserVO {
	out := make([]UserVO, 0, len(records))
	for i := range records {
		out = append(out, toUserVO(&records[i]))
	}
	return out
}

// ---- HTTP handlers（挂载于 /api/admin/users，已 JWTAuth + AdminOnly）----

// listUsers GET /api/admin/users 用户列表。
func (h *Handler) listUsers(c *gin.Context) {
	var q UserQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.userSvc.List(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// createUser POST /api/admin/users 管理员手动创建用户。
func (h *Handler) createUser(c *gin.Context) {
	var dto UserCreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.userSvc.Create(&dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// getUser GET /api/admin/users/:id 用户详情（:id 为 public_id）。
func (h *Handler) getUser(c *gin.Context) {
	vo, err := h.userSvc.Get(c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// updateUser PUT /api/admin/users/:id 编辑用户（:id 为 public_id）。
func (h *Handler) updateUser(c *gin.Context) {
	var dto UserUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.userSvc.Update(c.Param("id"), &dto); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// resetUserPassword POST /api/admin/users/:id/password 管理员手动重置用户密码（:id 为 public_id）。
func (h *Handler) resetUserPassword(c *gin.Context) {
	var dto UserPasswordResetDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.userSvc.ResetPassword(c.Param("id"), &dto); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
