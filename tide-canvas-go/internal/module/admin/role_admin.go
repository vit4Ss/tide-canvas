package admin

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// 权限通配与超级管理员编码（对齐 AdminPermissions.WILDCARD / AdminRoleServiceImpl.SUPER_CODE）。
const (
	permWildcard  = "*"
	roleSuperCode = "super"
)

// permissionCatalog 后台权限目录（操作按钮级），忠实迁移 AdminPermissions.CATALOG。
// 供角色编辑与前端按码隐藏菜单/按钮使用。
var permissionCatalog = []PermissionGroup{
	{Group: "概览", Items: []PermissionItem{
		{Code: "dashboard:view", Label: "数据面板"},
		{Code: "monitor:view", Label: "监控总览"},
	}},
	{Group: "用户与内容", Items: []PermissionItem{
		{Code: "user:view", Label: "用户-查看"},
		{Code: "user:edit", Label: "用户-编辑"},
		{Code: "content:view", Label: "内容-查看"},
		{Code: "content:audit", Label: "内容-审核"},
		{Code: "author:view", Label: "作者-查看"},
		{Code: "author:manage", Label: "作者-授予/撤销"},
		{Code: "banner:view", Label: "Banner-查看"},
		{Code: "banner:manage", Label: "Banner-增删改"},
		{Code: "file:view", Label: "文件-查看"},
		{Code: "file:delete", Label: "文件-删除"},
		{Code: "security:view", Label: "封禁-查看"},
		{Code: "security:manage", Label: "封禁-封禁/解封"},
	}},
	{Group: "营收", Items: []PermissionItem{
		{Code: "points:view", Label: "积分-查看"},
		{Code: "points:adjust", Label: "积分-调整"},
		{Code: "points:refund", Label: "积分-退还"},
		{Code: "order:view", Label: "订单-查看"},
		{Code: "order:pay", Label: "订单-确认支付"},
		{Code: "redeem:view", Label: "兑换码-查看"},
		{Code: "redeem:generate", Label: "兑换码-生成"},
		{Code: "redeem:update", Label: "兑换码-启停"},
		{Code: "redeem:delete", Label: "兑换码-删除"},
	}},
	{Group: "AI", Items: []PermissionItem{
		{Code: "provider:view", Label: "供应商-查看"},
		{Code: "provider:manage", Label: "供应商-增删改"},
		{Code: "model:view", Label: "模型-查看"},
		{Code: "model:manage", Label: "模型-增删改"},
		{Code: "handler:view", Label: "Handler-查看"},
		{Code: "handler:manage", Label: "Handler-配置"},
		{Code: "ailog:view", Label: "AI日志-查看"},
	}},
	{Group: "系统", Items: []PermissionItem{
		{Code: "email:view", Label: "邮件模板-查看"},
		{Code: "email:edit", Label: "邮件模板-编辑"},
		{Code: "setting:view", Label: "系统设置-查看"},
		{Code: "setting:edit", Label: "系统设置-编辑"},
		{Code: "role:view", Label: "角色-查看"},
		{Code: "role:manage", Label: "角色-管理"},
	}},
	{Group: "日志", Items: []PermissionItem{
		{Code: "syslog:view", Label: "系统日志-查看"},
		{Code: "syslog:delete", Label: "系统日志-删除"},
		{Code: "accesslog:view", Label: "访问日志-查看"},
		{Code: "accesslog:delete", Label: "访问日志-删除"},
		{Code: "loginlog:view", Label: "登录日志-查看"},
		{Code: "loginlog:delete", Label: "登录日志-删除"},
	}},
}

// allPermissionCodes 全部合法权限码集合（对齐 AdminPermissions.ALL_CODES）。
var allPermissionCodes = buildAllPermissionCodes()

func buildAllPermissionCodes() map[string]struct{} {
	m := make(map[string]struct{})
	for _, g := range permissionCatalog {
		for _, it := range g.Items {
			m[it.Code] = struct{}{}
		}
	}
	return m
}

// RoleAdminService 角色与权限(RBAC)服务（忠实迁移 AdminRoleServiceImpl）。
type RoleAdminService struct {
	repo *Repository
}

// NewRoleAdminService 构造。
func NewRoleAdminService(repo *Repository) *RoleAdminService {
	return &RoleAdminService{repo: repo}
}

// ListRoles 角色列表（对齐 listRoles）。
func (s *RoleAdminService) ListRoles() ([]RoleVO, error) {
	roles, err := s.repo.ListRoles()
	if err != nil {
		return nil, err
	}
	out := make([]RoleVO, 0, len(roles))
	for i := range roles {
		out = append(out, toRoleVO(&roles[i]))
	}
	return out, nil
}

// CreateRole 新增角色（对齐 createRole）。
func (s *RoleAdminService) CreateRole(dto *RoleSaveDTO) error {
	if strings.TrimSpace(dto.Name) == "" {
		return ecode.BadRequest.WithMessage("角色名不能为空")
	}
	if strings.TrimSpace(dto.Code) == "" {
		return ecode.BadRequest.WithMessage("角色编码不能为空")
	}
	exists, err := s.repo.ExistsRoleCode(dto.Code, nil)
	if err != nil {
		return err
	}
	if exists {
		return ecode.BadRequest.WithMessage("角色编码已存在")
	}
	role := &model.SysRole{
		Name:        dto.Name,
		Code:        dto.Code,
		Permissions: normalizePermissions(dto.Permissions),
		Builtin:     0,
		Remark:      dto.Remark,
	}
	return s.repo.CreateRole(role)
}

// UpdateRole 编辑角色（对齐 updateRole）：内置角色不可改编码；超级管理员权限恒为 *。
func (s *RoleAdminService) UpdateRole(id int64, dto *RoleSaveDTO) error {
	if strings.TrimSpace(dto.Name) == "" {
		return ecode.BadRequest.WithMessage("角色名不能为空")
	}
	role, err := s.repo.FindRoleByID(id)
	if err != nil {
		return err
	}
	if role == nil {
		return ecode.NotFound.WithMessage("角色不存在")
	}
	builtin := role.Builtin == 1

	columns := map[string]interface{}{
		"name":   dto.Name,
		"remark": dto.Remark,
	}
	if !builtin {
		if strings.TrimSpace(dto.Code) == "" {
			return ecode.BadRequest.WithMessage("角色编码不能为空")
		}
		exists, err := s.repo.ExistsRoleCode(dto.Code, &id)
		if err != nil {
			return err
		}
		if exists {
			return ecode.BadRequest.WithMessage("角色编码已存在")
		}
		columns["code"] = dto.Code
	}
	// 超级管理员权限恒为 *（用现库中的 code 判断，内置角色 code 未变）
	if role.Code == roleSuperCode {
		columns["permissions"] = permWildcard
	} else {
		columns["permissions"] = normalizePermissions(dto.Permissions)
	}
	return s.repo.UpdateRoleColumns(id, columns)
}

// DeleteRole 删除角色（对齐 deleteRole）：内置不可删；有管理员占用不可删。
func (s *RoleAdminService) DeleteRole(id int64) error {
	role, err := s.repo.FindRoleByID(id)
	if err != nil {
		return err
	}
	if role == nil {
		return ecode.NotFound.WithMessage("角色不存在")
	}
	if role.Builtin == 1 {
		return ecode.BadRequest.WithMessage("内置角色不可删除")
	}
	assigned, err := s.repo.CountUsersByRoleID(id)
	if err != nil {
		return err
	}
	if assigned > 0 {
		return ecode.BadRequest.WithMessage("该角色下仍有管理员，请先改派后再删除")
	}
	return s.repo.DeleteRole(id)
}

// GetUserPermissions 取某管理员的权限码集合（对齐 getUserPermissions）。
// 未分配角色（含存量管理员）视为超级管理员（返回 ["*"]），避免被锁死。
func (s *RoleAdminService) GetUserPermissions(userID int64) ([]string, error) {
	if userID == 0 {
		return []string{}, nil
	}
	user, err := s.repo.FindUserByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.RoleID == nil {
		return []string{permWildcard}, nil
	}
	role, err := s.repo.FindRoleByID(*user.RoleID)
	if err != nil {
		return nil, err
	}
	if role == nil || strings.TrimSpace(role.Permissions) == "" {
		return []string{}, nil
	}
	if strings.TrimSpace(role.Permissions) == permWildcard {
		return []string{permWildcard}, nil
	}
	return splitPermissions(role.Permissions), nil
}

// normalizePermissions 过滤为合法权限码并拼成 CSV（去重，对齐 normalizePermissions）。
func normalizePermissions(permissions []string) string {
	if len(permissions) == 0 {
		return ""
	}
	seen := make(map[string]struct{}, len(permissions))
	valid := make([]string, 0, len(permissions))
	for _, p := range permissions {
		if _, ok := allPermissionCodes[p]; !ok {
			continue
		}
		if _, dup := seen[p]; dup {
			continue
		}
		seen[p] = struct{}{}
		valid = append(valid, p)
	}
	return strings.Join(valid, ",")
}

// splitPermissions 拆 CSV 为权限码列表（trim 去空）。
func splitPermissions(csv string) []string {
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// toRoleVO 角色转 VO（permissions 解析为列表；通配返回 ["*"]，对齐 toVO）。
func toRoleVO(role *model.SysRole) RoleVO {
	var perms []string
	p := strings.TrimSpace(role.Permissions)
	switch {
	case p == permWildcard:
		perms = []string{permWildcard}
	case p != "":
		perms = splitPermissions(role.Permissions)
	default:
		perms = []string{}
	}
	return RoleVO{
		ID:          role.ID,
		Name:        role.Name,
		Code:        role.Code,
		Permissions: perms,
		Builtin:     role.Builtin,
		Remark:      role.Remark,
		CreateTime:  role.CreateTime,
		UpdateTime:  role.UpdateTime,
	}
}

// ---- HTTP handlers（挂载于 /api/admin/roles，已 JWTAuth + AdminOnly）----

// listRoles GET /api/admin/roles 角色列表。
func (h *Handler) listRoles(c *gin.Context) {
	vos, err := h.roleSvc.ListRoles()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

// permissionCatalog GET /api/admin/roles/catalog 权限目录。
func (h *Handler) permissionCatalog(c *gin.Context) {
	response.OK(c, permissionCatalog)
}

// myPermissions GET /api/admin/roles/my-permissions 当前管理员权限码（前端据此隐藏菜单/按钮，不鉴权）。
func (h *Handler) myPermissions(c *gin.Context) {
	codes, err := h.roleSvc.GetUserPermissions(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, codes)
}

// createRole POST /api/admin/roles 新增角色。
func (h *Handler) createRole(c *gin.Context) {
	var dto RoleSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.roleSvc.CreateRole(&dto); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// updateRole PUT /api/admin/roles/:id 编辑角色（:id 为角色主键 int64）。
func (h *Handler) updateRole(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	var dto RoleSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.roleSvc.UpdateRole(id, &dto); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// deleteRole DELETE /api/admin/roles/:id 删除角色（:id 为角色主键 int64）。
func (h *Handler) deleteRole(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.roleSvc.DeleteRole(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
