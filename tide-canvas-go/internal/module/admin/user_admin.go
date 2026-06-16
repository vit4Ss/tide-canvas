package admin

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
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

// toUserVO 单个用户转 VO。id 取 public_id；teamId 非空视为在团队。
func toUserVO(u *model.SysUser) UserVO {
	return UserVO{
		ID:            u.PublicID,
		Username:      u.Username,
		Email:         u.Email,
		Phone:         u.Phone,
		Nickname:      u.Nickname,
		Avatar:        u.Avatar,
		Role:          u.Role,
		RoleID:        u.RoleID,
		Status:        u.Status,
		APIQuota:      u.APIQuota,
		Points:        u.Points,
		IsAuthor:      u.IsAuthor,
		StorageQuota:  u.StorageQuota,
		TeamID:        u.TeamID,
		InTeam:        u.TeamID != nil,
		CreateTime:    u.CreateTime,
		LastLoginTime: u.LastLoginTime,
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
