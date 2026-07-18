package model

// roles.go — 前台菜单权限的角色化配置（2026-07-18 用户定稿）：
//   - sys_role.permissions 存 JSON 数组：前台侧栏菜单键 + 可选的后台权限键；
//   - 基线两个角色：用户（全部前台菜单，无后台）/ 管理员（全部）；
//   - 注册默认挂「用户」角色；存量 role_id=0 的用户由 ensureBaselineRoles 回填。
// 前端 studio-rail.tsx 按 /api/auth/me 返回的 menus 过滤侧栏（配置了才展示）。

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// Baseline role codes (sys_role.code).
const (
	RoleCodeUser  = "user"
	RoleCodeAdmin = "admin"
)

// PermAdminAccess marks 后台管理 access inside a role's permissions array.
// 实际的 /api/admin 门禁仍走 JWT role=9（middleware.AdminGuard）；此键用于
// 角色配置的语义完整与前台展示后台入口的依据。
const PermAdminAccess = "admin.access"

// FrontMenuKeys are the studio-rail menu keys, 与前端 studio-rail.tsx 的
// NAV 项一一对应。新增侧栏项时两端同步加键。
var FrontMenuKeys = []string{
	"discover", // 发现 /
	"studio",   // 创作 /studio
	"chat",     // 生成 /chat
	"canvas",   // 画布 /projects
	"explore",  // 作品广场 /explore
	"inspire",  // 灵感 /inspire
	"assets",   // 资产 /assets
}

// ensureBaselineRoles inserts the 用户/管理员 roles when missing (never
// overwriting admin edits) and backfills User.RoleID for existing rows:
// role=9 老管理员 → 管理员角色，其余 → 用户角色。幂等，随 AutoMigrate 每次启动执行。
func ensureBaselineRoles(db *gorm.DB) error {
	userPerms, _ := json.Marshal(FrontMenuKeys)
	adminPerms, _ := json.Marshal(append(append([]string{}, FrontMenuKeys...), PermAdminAccess))
	baseline := []SysRole{
		{
			Name:        "用户",
			Code:        RoleCodeUser,
			Permissions: string(userPerms),
			Description: "默认角色：拥有全部前台菜单，无后台权限（注册用户自动获得）",
			Status:      1,
		},
		{
			Name:        "管理员",
			Code:        RoleCodeAdmin,
			Permissions: string(adminPerms),
			Description: "全部前台菜单与后台管理权限",
			Status:      1,
		},
	}
	for i := range baseline {
		// 先含软删查同 code 行：code 唯一索引不含 deleted 列，被删过的行直接重插
		// 会撞唯一键、卡住启动——遇软删行原位恢复（deleted=NULL、启用），缺行才插入，
		// 存活行绝不覆盖管理员的修改。
		var row SysRole
		err := db.Unscoped().Where("code = ?", baseline[i].Code).First(&row).Error
		switch {
		case err == nil && row.Deleted.Valid:
			if err := db.Unscoped().Model(&SysRole{}).Where("id = ?", row.ID).
				Updates(map[string]any{"deleted": nil, "status": 1}).Error; err != nil {
				return err
			}
		case errors.Is(err, gorm.ErrRecordNotFound):
			if err := db.Create(&baseline[i]).Error; err != nil {
				return err
			}
		case err != nil:
			return err
		}
	}

	adminID := RoleIDByCode(db, RoleCodeAdmin)
	if adminID != 0 {
		if err := db.Model(&User{}).Where("role_id = 0 AND role = 9").
			Update("role_id", adminID).Error; err != nil {
			return err
		}
	}
	userID := RoleIDByCode(db, RoleCodeUser)
	if userID != 0 {
		if err := db.Model(&User{}).Where("role_id = 0 AND role <> 9").
			Update("role_id", userID).Error; err != nil {
			return err
		}
	}
	return nil
}

// RoleIDByCode returns the sys_role id for a code, or 0 when missing.
// auth 注册用它给新用户挂默认「用户」角色。
func RoleIDByCode(db *gorm.DB, code string) idgen.ID {
	var r SysRole
	if err := db.Select("id").Where("code = ?", code).First(&r).Error; err != nil {
		return 0
	}
	return r.ID
}

// MenusForUser resolves the front-menu keys the user's role grants. 兜底
// fail-open：角色缺失/禁用/权限解析失败时返回全部前台菜单（侧栏永不空白），
// 只有明确配置过的启用角色才收窄展示。
func MenusForUser(db *gorm.DB, u *User) []string {
	if u == nil {
		return FrontMenuKeys
	}
	var r SysRole
	err := error(nil)
	if u.RoleID != 0 {
		err = db.Where("id = ?", u.RoleID).First(&r).Error
	} else {
		code := RoleCodeUser
		if u.Role == 9 {
			code = RoleCodeAdmin
		}
		err = db.Where("code = ?", code).First(&r).Error
	}
	if err != nil || r.Status != 1 {
		return FrontMenuKeys
	}
	var perms []string
	if json.Unmarshal([]byte(r.Permissions), &perms) != nil {
		return FrontMenuKeys
	}
	allowed := map[string]bool{}
	for _, p := range perms {
		allowed[p] = true
	}
	// 按 FrontMenuKeys 定序输出，过滤掉非菜单键（如 admin.access）。
	out := make([]string, 0, len(FrontMenuKeys))
	for _, k := range FrontMenuKeys {
		if allowed[k] {
			out = append(out, k)
		}
	}
	return out
}
