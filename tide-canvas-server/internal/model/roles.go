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

// PermAdminAccess 是「全部后台」总开关:角色带它即拥有全部后台模块权限
// (基线管理员角色即此配置,兼容 2026-07-18 之前只有该键的旧数据)。
const PermAdminAccess = "admin.access"

// AdminModuleKeys 是后台管理各模块的细分权限键(admin.<模块>),与后台侧栏
// admin-sidebar.tsx 的导航项一一对应(模型状态与中转站同步共用 admin.models,
// 因为其接口挂在 /admin/models 之下)。新增后台模块时两端同步加键。
var AdminModuleKeys = []string{
	"admin.dashboard",     // 数据概览
	"admin.users",         // 用户管理(含角色管理)
	"admin.works",         // 作品管理
	"admin.inspiration",   // 灵感管理
	"admin.generations",   // 生成记录(每次模型调用的审计视图)
	"admin.logs",          // 日志管理(访问/登录/业务/审计)
	"admin.floors",        // 首页楼层
	"admin.blog",          // 博客管理
	"admin.styles",        // 风格管理
	"admin.skills",        // 技能管理(技能广场)
	"admin.models",        // 模型管理(含模型状态/中转站同步)
	"admin.tools",         // 工具管理
	"admin.canvas",        // 画布节点配置
	"admin.points",        // 积分管理
	"admin.pricing",       // 价格管理
	"admin.payments",      // 支付管理
	"admin.notifications", // 消息管理
	"admin.config",        // 配置管理
	"admin.email",         // 邮件配置
}

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

// AdminPermsForUser resolves后台模块权限:role=9 超管、或角色带 admin.access
// (全部后台)→ 全量模块键;否则取角色 permissions 里配置的 admin.* 明细。
// 与前台菜单的 fail-open 相反,这是后台门禁的依据,角色缺失/禁用/解析失败
// 一律 fail-closed(返回空 = 无后台权限)。
func AdminPermsForUser(db *gorm.DB, u *User) []string {
	if u == nil {
		return nil
	}
	if u.Role == 9 {
		return append([]string{}, AdminModuleKeys...)
	}
	// 被禁用的账号立即失去后台权限(JWT 不查状态,若不拦,封禁的运营在
	// token 有效期内仍能进后台)
	if u.Status != 1 || u.RoleID == 0 {
		return nil
	}
	var r SysRole
	if err := db.Where("id = ?", u.RoleID).First(&r).Error; err != nil || r.Status != 1 {
		return nil
	}
	var perms []string
	if json.Unmarshal([]byte(r.Permissions), &perms) != nil {
		return nil
	}
	has := map[string]bool{}
	for _, p := range perms {
		has[p] = true
	}
	if has[PermAdminAccess] {
		return append([]string{}, AdminModuleKeys...)
	}
	out := make([]string, 0, 4)
	for _, k := range AdminModuleKeys {
		if has[k] {
			out = append(out, k)
		}
	}
	return out
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
