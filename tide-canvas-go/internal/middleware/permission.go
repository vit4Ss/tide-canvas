package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// RBAC 按钮级权限中间件（忠实迁移旧后端 PermissionAspect + AdminRoleServiceImpl.getUserPermissions）。
//
// 校验链：JWTAuth（注入当前用户）→ AdminOnly（限管理员）→ RequiresPermission(code)（按钮级权限码）。
// 放行规则：
//   - 超级管理员（role==9，或 role_id 为空的存量内置管理员）→ 全放行。
//   - 角色权限串含通配 "*" 或包含 code → 放行；否则 ecode.Forbidden（403）。

// permWildcard 通配权限码：拥有全部权限（对齐 AdminPermissions.WILDCARD）。
const permWildcard = "*"

// PermissionLoader 加载某用户「已解析」的权限串（CSV 或通配 "*"）。
// 约定：未分配角色 / 内置存量管理员 返回 "*"（视为超级管理员，避免被锁死）；
// 角色不存在或无任何权限返回 ""。
type PermissionLoader interface {
	LoadPermissions(userID int64) (string, error)
}

// ---------------------------------------------------------------------------
// DBPermissionLoader：默认实现，读 sys_user + sys_role（忠实迁移 getUserPermissions）。
// ---------------------------------------------------------------------------

// DBPermissionLoader 从数据库加载用户权限串。
type DBPermissionLoader struct {
	db *gorm.DB
}

// NewDBPermissionLoader 构造（注入 *gorm.DB）。
func NewDBPermissionLoader(db *gorm.DB) *DBPermissionLoader { return &DBPermissionLoader{db: db} }

// LoadPermissions 取用户角色对应的权限串（对齐 AdminRoleServiceImpl.getUserPermissions）。
//   - userID==0 → ""（无身份）。
//   - 用户不存在 或 role_id 为空 → "*"（视为超级管理员，避免存量管理员被锁死）。
//   - 角色不存在 或 权限为空 → ""。
//   - 角色权限为 "*" → "*"；否则原样返回 CSV（由中间件解析）。
func (l *DBPermissionLoader) LoadPermissions(userID int64) (string, error) {
	if userID == 0 {
		return "", nil
	}
	var user model.SysUser
	err := l.db.Select("id", "role_id").First(&user, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return permWildcard, nil
	}
	if err != nil {
		return "", err
	}
	if user.RoleID == nil {
		return permWildcard, nil
	}

	var role model.SysRole
	err = l.db.Select("id", "permissions").First(&role, *user.RoleID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	perms := strings.TrimSpace(role.Permissions)
	if perms == permWildcard {
		return permWildcard, nil
	}
	return perms, nil
}

// ---------------------------------------------------------------------------
// RequiresPermission 中间件工厂
// ---------------------------------------------------------------------------

// RequiresPermission 构造按钮级权限校验中间件，须在 JWTAuth 之后使用。
//
// 用法（在路由上挂载，loader 由 router.New 注入一次后复用）：
//
//	loader := middleware.NewDBPermissionLoader(db)
//	admin := api.Group("/admin")
//	admin.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())
//	admin.GET("/roles", middleware.RequiresPermission(loader, "role:view"), h.listRoles)
//	admin.POST("/roles", middleware.RequiresPermission(loader, "role:manage"), h.createRole)
//
// 注入自定义 PermissionLoader（如带缓存的实现）：传入实现了 PermissionLoader 的对象即可。
func RequiresPermission(loader PermissionLoader, code string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 须在 JWTAuth 之后：无当前用户视为未登录（对齐 user==null → UNAUTHORIZED）。
		uid, logged := CurrentUserID(c)
		if !logged {
			abort401(c)
			return
		}
		// 超级管理员（role==9）全放行（role_id 为空的存量管理员由 loader 返回 "*" 覆盖）。
		if RoleOf(c) == RoleAdmin {
			c.Next()
			return
		}
		perms, err := loader.LoadPermissions(uid)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"success": false, "code": ecode.ServerError.Code(), "message": ecode.ServerError.Message(),
			})
			return
		}
		if permissionsAllow(perms, code) {
			c.Next()
			return
		}
		abortForbidden(c, "无权限："+code)
	}
}

// permissionsAllow 权限串（CSV 或 "*"）是否含通配或包含 code（对齐 perms.contains 判定）。
func permissionsAllow(perms, code string) bool {
	perms = strings.TrimSpace(perms)
	if perms == "" {
		return false
	}
	if perms == permWildcard {
		return true
	}
	for _, p := range strings.Split(perms, ",") {
		p = strings.TrimSpace(p)
		if p == permWildcard || p == code {
			return true
		}
	}
	return false
}

// abortForbidden 统一以 ecode.Forbidden（403）拒绝（响应体对齐其余中间件）。
func abortForbidden(c *gin.Context, message string) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
		"success": false, "code": ecode.Forbidden.Code(), "message": message,
	})
}
