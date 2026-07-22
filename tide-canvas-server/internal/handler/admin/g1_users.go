package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/auth"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g1_users.go backs admin user management and permission-role CRUD.
//
// LINKAGE: users come from the SAME `users` table the app authenticates against,
// and roles from the SAME `sys_role` table referenced by User.RoleID — so
// changing a user's status/points/role here immediately affects the real user,
// and editing a role here is what the auth/admin layer reads. There is no
// parallel admin-only copy of either table.

// RegisterUsers mounts the user-management and role routes on the admin group.
//
//	GET    /users               AdminUserQuery -> PageData<AdminUserVO>
//	GET    /users/:id           -> AdminUserVO
//	PUT    /users/:id           AdminUserUpdateDTO -> AdminUserVO
//	DELETE /users/:id           -> void
//	POST   /users/:id/points    PointAdjustDTO -> {points}
//	GET    /roles               -> []RoleVO
//	POST   /roles               RoleSaveDTO -> RoleVO
//	PUT    /roles/:id           RoleSaveDTO -> RoleVO
//	DELETE /roles/:id           -> void
//
// The :id param lives under the static /users and /roles parents, so it is never
// a sibling of another static segment (gin rejects static/param siblings).
func RegisterUsers(g *gin.RouterGroup, d *app.Deps) {
	h := &userHandler{db: d.DB}

	g.GET("/users", h.listUsers)
	// 快速生成用户:静态段先于 :id 注册(gin 拒绝 static/param 兄弟段的歧义)
	g.POST("/users/generate", h.generateUser)
	g.GET("/users/:id", h.getUser)
	g.PUT("/users/:id", h.updateUser)
	g.DELETE("/users/:id", h.deleteUser)
	g.POST("/users/:id/points", h.adjustPoints)

	g.GET("/roles", h.listRoles)
	g.POST("/roles", h.createRole)
	g.PUT("/roles/:id", h.updateRole)
	g.DELETE("/roles/:id", h.deleteRole)
}

type userHandler struct {
	db *gorm.DB
}

// ----- VOs ------------------------------------------------------------------

// AdminUserVO is the admin view of a user. It mirrors the user-facing fields plus
// derived counts useful to operators. ids are idgen.ID (string JSON).
type AdminUserVO struct {
	ID            idgen.ID `json:"id"`
	Username      string   `json:"username"`
	Email         string   `json:"email"`
	Phone         string   `json:"phone"`
	Nickname      string   `json:"nickname"`
	Avatar        string   `json:"avatar"`
	Role          int      `json:"role"`
	RoleID        idgen.ID `json:"roleId"`
	VipLevel      int      `json:"vipLevel"`
	// PlanName is the display name of the user's current plan, derived from the
	// real plan table via vip_level (0 → the free plan). Read-only convenience.
	PlanName      string   `json:"planName"`
	Status        int      `json:"status"`
	ApiQuota      int64    `json:"apiQuota"`
	Points        int64    `json:"points"`
	IsAuthor      int      `json:"isAuthor"`
	StorageQuota  int64    `json:"storageQuota"`
	StorageUsed   int64    `json:"storageUsed"`
	ProjectCount  int64    `json:"projectCount"`
	PostCount     int64    `json:"postCount"`
	CreateTime    string   `json:"createTime"`
	LastLoginTime string   `json:"lastLoginTime"`
}

// RoleVO is the admin view of a permission role (sys_role).
type RoleVO struct {
	ID          idgen.ID `json:"id"`
	Name        string   `json:"name"`
	Code        string   `json:"code"`
	Permissions string   `json:"permissions"` // JSON array of permission keys (raw)
	Description string   `json:"description"`
	Status      int      `json:"status"`
	CreateTime  string   `json:"createTime"`
	UpdateTime  string   `json:"updateTime"`
}

// ----- DTOs -----------------------------------------------------------------

// AdminUserQuery is the query for GET /users.
//
//	keyword?    matches username/email/nickname/phone
//	role?       exact User.Role (0 user / 9 admin) — sent as a pointer so 0 is distinguishable from "unset"
//	status?     exact User.Status (0 disabled / 1 active)
//	subscribed? "1" filters paying members (vip_level >= 1，购买套餐结算时提升)——
//	            用户列表的「订阅用户」标签用它；"0" 筛免费用户 (vip_level = 0，
//	            即 FREE 档)——「普通用户」标签 = role=0 且 subscribed=0，与订阅
//	            用户互斥。role=1 的旧 VIP 档从不被支付链路写入，不再作为筛选口径。
type AdminUserQuery struct {
	PageNum    int    `form:"pageNum"`
	PageSize   int    `form:"pageSize"`
	Keyword    string `form:"keyword"`
	Role       *int   `form:"role"`
	Status     *int   `form:"status"`
	Subscribed string `form:"subscribed"`
}

func (q *AdminUserQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.Keyword = strings.TrimSpace(q.Keyword)
}

func (q *AdminUserQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// AdminUserUpdateDTO is the body for PUT /users/:id. All fields are pointers so
// the admin can update any subset; absent fields are left untouched.
type AdminUserUpdateDTO struct {
	Role     *int   `json:"role"`
	Status   *int   `json:"status"`
	ApiQuota *int64 `json:"apiQuota"`
	Points   *int64 `json:"points"`
	VipLevel *int   `json:"vipLevel"`
	RoleID   *string `json:"roleId"`
	Nickname *string `json:"nickname"`
}

// PointAdjustDTO is the body for POST /users/:id/points. amount may be negative
// (deduction) or positive (grant); remark is the ledger note.
type PointAdjustDTO struct {
	Amount int    `json:"amount" binding:"required"`
	Remark string `json:"remark" binding:"omitempty,max=255"`
}

// RoleSaveDTO is the body for POST /roles and PUT /roles/:id.
type RoleSaveDTO struct {
	Name        string `json:"name" binding:"required,max=64"`
	Code        string `json:"code" binding:"omitempty,max=64"`
	Permissions string `json:"permissions" binding:"omitempty"` // raw JSON array string
	Description string `json:"description" binding:"omitempty,max=255"`
	Status      *int   `json:"status" binding:"omitempty"`
}

// ----- user handlers --------------------------------------------------------

// planNameByVip maps vip_level → 套餐显示名，数据来源于真实 plan 表：
// features.vipLevel 优先，其次种子 code 兜底（pro→1 / max→2 / enterprise→3，
// 与 billing.vipForPlan 同口径），其余视为 0（免费档）。价格>0 却映射到 0 的
// 付费套餐不代表会员等级，跳过。同级取 sort_order 最靠前的一个。
func (h *userHandler) planNameByVip() map[int]string {
	var plans []model.Plan
	if err := h.db.Order("sort_order ASC").Find(&plans).Error; err != nil {
		return map[int]string{}
	}
	names := map[int]string{}
	for i := range plans {
		p := &plans[i]
		var f struct {
			VipLevel int `json:"vipLevel"`
		}
		if p.Features != "" {
			_ = json.Unmarshal([]byte(p.Features), &f)
		}
		level := f.VipLevel
		if level == 0 {
			switch p.Code {
			case "pro":
				level = 1
			case "max":
				level = 2
			case "enterprise":
				level = 3
			}
		}
		if level == 0 && p.Price.Sign() > 0 {
			continue
		}
		if _, ok := names[level]; !ok {
			names[level] = p.Name
		}
	}
	return names
}

// planNameFor renders the display name for a vip level with graceful fallbacks
// (unknown paid level → "VIP n"; no free plan row → "FREE").
func planNameFor(names map[int]string, level int) string {
	if n, ok := names[level]; ok {
		return n
	}
	if level > 0 {
		return fmt.Sprintf("VIP %d", level)
	}
	return "FREE"
}

// listUsers handles GET /users. Returns PageData<AdminUserVO> over the real users
// table, with keyword/role/status filters, plus per-user project & post counts.
func (h *userHandler) listUsers(c *gin.Context) {
	var q AdminUserQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.User{})
	if q.Keyword != "" {
		like := "%" + g1EscapeLike(q.Keyword) + "%"
		tx = tx.Where("username LIKE ? OR email LIKE ? OR nickname LIKE ? OR phone LIKE ?", like, like, like, like)
	}
	if q.Role != nil {
		tx = tx.Where("role = ?", *q.Role)
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if q.Subscribed == "1" {
		tx = tx.Where("vip_level >= 1")
	} else if q.Subscribed == "0" {
		tx = tx.Where("vip_level = 0")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count users")
		return
	}

	var rows []model.User
	if err := tx.Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list users")
		return
	}

	ids := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].ID)
	}
	projCounts := h.countByOwner(&model.Project{}, "owner_id", ids)
	postCounts := h.countByOwner(&model.CommunityPost{}, "user_id", ids)
	planNames := h.planNameByVip()

	vos := make([]AdminUserVO, 0, len(rows))
	for i := range rows {
		vo := toAdminUserVO(&rows[i])
		vo.ProjectCount = projCounts[rows[i].ID]
		vo.PostCount = postCounts[rows[i].ID]
		vo.PlanName = planNameFor(planNames, rows[i].VipLevel)
		vos = append(vos, vo)
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// getUser handles GET /users/:id.
func (h *userHandler) getUser(c *gin.Context) {
	id, ok := g1ParseID(c, "user")
	if !ok {
		return
	}
	u, err := h.findUser(id)
	if err != nil {
		h.failLookup(c, err, "failed to load user")
		return
	}
	vo := toAdminUserVO(u)
	vo.ProjectCount = h.countByOwner(&model.Project{}, "owner_id", []idgen.ID{id})[id]
	vo.PostCount = h.countByOwner(&model.CommunityPost{}, "user_id", []idgen.ID{id})[id]
	vo.PlanName = planNameFor(h.planNameByVip(), u.VipLevel)
	response.OK(c, vo)
}

// updateUser handles PUT /users/:id. Applies a partial update of admin-editable
// fields directly on the users table, then returns the refreshed VO.
func (h *userHandler) updateUser(c *gin.Context) {
	id, ok := g1ParseID(c, "user")
	if !ok {
		return
	}
	var dto AdminUserUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	// 运营角色(非超管)不得触碰权限体系:变更账号角色/权限角色仅超管可做,
	// 管理员账号本身也不许被运营改动(否则可禁用/清空超管账号)。
	// 只拦「实际变更」——编辑表单会原样回传当前 role,值没变不算越权。
	if middleware.CurrentRole(c) != middleware.AdminRole {
		t, err := h.findUser(id)
		if err != nil {
			h.failLookup(c, err, "failed to load user")
			return
		}
		if t.Role == middleware.AdminRole {
			response.Fail(c, response.CodeForbidden, "仅超级管理员可操作管理员账号")
			return
		}
		roleChanged := dto.Role != nil && *dto.Role != t.Role
		roleIDChanged := dto.RoleID != nil && strings.TrimSpace(*dto.RoleID) != t.RoleID.String()
		if roleChanged || roleIDChanged {
			response.Fail(c, response.CodeForbidden, "仅超级管理员可变更用户角色")
			return
		}
	}

	fields := map[string]any{}
	if dto.Role != nil {
		fields["role"] = *dto.Role
	}
	if dto.Status != nil {
		fields["status"] = *dto.Status
	}
	if dto.ApiQuota != nil {
		fields["api_quota"] = *dto.ApiQuota
	}
	if dto.Points != nil {
		fields["points"] = *dto.Points
	}
	if dto.VipLevel != nil {
		fields["vip_level"] = *dto.VipLevel
	}
	if dto.Nickname != nil {
		fields["nickname"] = strings.TrimSpace(*dto.Nickname)
	}
	if dto.RoleID != nil {
		rid, err := idgen.Parse(strings.TrimSpace(*dto.RoleID))
		if err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid roleId")
			return
		}
		fields["role_id"] = rid
	}

	if len(fields) == 0 {
		// Nothing to change; just return the current state.
		u, err := h.findUser(id)
		if err != nil {
			h.failLookup(c, err, "failed to load user")
			return
		}
		response.OK(c, toAdminUserVO(u))
		return
	}

	res := h.db.Model(&model.User{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to update user")
		return
	}
	if res.RowsAffected == 0 {
		// Either no such user, or the values were identical. Disambiguate.
		if _, err := h.findUser(id); err != nil {
			h.failLookup(c, err, "failed to update user")
			return
		}
	}

	u, err := h.findUser(id)
	if err != nil {
		h.failLookup(c, err, "failed to load user")
		return
	}

	// 改了账号角色(role/role_id)或状态(封禁即失权)会影响其后台模块权限,
	// 清缓存即时生效
	if dto.Role != nil || dto.RoleID != nil || dto.Status != nil {
		middleware.InvalidateAdminPermsCache()
	}

	// Audit security/membership-relevant changes (role, status, vip, points).
	if summary := g1SensitiveChangeSummary(dto); summary != "" {
		eventlog.Biz(&model.BizLog{
			UserID:     id,
			Action:     "user_update",
			Summary:    "管理员修改用户：" + summary,
			RefID:      id,
			RefType:    "user",
			OperatorID: middleware.CurrentUserID(c),
			Detail:     eventlog.Truncate(summary, 1024),
		})
	}

	response.OK(c, toAdminUserVO(u))
}

// g1SensitiveChangeSummary describes the security/membership-affecting fields an
// admin changed on a user, for the business log. Returns "" when none changed.
func g1SensitiveChangeSummary(dto AdminUserUpdateDTO) string {
	var parts []string
	if dto.Role != nil {
		parts = append(parts, fmt.Sprintf("角色=%d", *dto.Role))
	}
	if dto.Status != nil {
		parts = append(parts, fmt.Sprintf("状态=%d", *dto.Status))
	}
	if dto.VipLevel != nil {
		parts = append(parts, fmt.Sprintf("会员等级=%d", *dto.VipLevel))
	}
	if dto.Points != nil {
		parts = append(parts, fmt.Sprintf("积分=%d", *dto.Points))
	}
	if dto.RoleID != nil {
		parts = append(parts, fmt.Sprintf("权限组=%s", strings.TrimSpace(*dto.RoleID)))
	}
	if dto.ApiQuota != nil {
		parts = append(parts, fmt.Sprintf("API配额=%d", *dto.ApiQuota))
	}
	return strings.Join(parts, "，")
}

// deleteUser handles DELETE /users/:id (soft delete via User.Deleted).
//
// 语义：删除后账号立即无法登录/刷新会话，从前后台所有列表消失；作品、订单、
// GeneratedUserVO is the response of POST /users/generate. Password 为明文且
// 仅此一次返回(不落库、不入审计日志),供管理员抄送给用户。
type GeneratedUserVO struct {
	ID       idgen.ID `json:"id"`
	Username string   `json:"username"`
	Password string   `json:"password"`
}

// generateUser handles POST /users/generate:随机生成一组符合本地账号规范的
// 用户名+密码并创建用户(与自助注册 register-local 完全同口径:严格校验、
// 占位邮箱、默认「用户」角色、新手积分)。用户名碰撞时重试。
func (h *userHandler) generateUser(c *gin.Context) {
	for attempt := 0; attempt < 5; attempt++ {
		name, pw, err := auth.GenerateLocalCredentials()
		if err != nil {
			response.Fail(c, response.CodeServerError, "生成凭据失败")
			return
		}
		u, err := auth.CreateLocalUser(h.db, name, pw)
		if err != nil {
			if errors.Is(err, auth.ErrUsernameTaken) {
				continue // 随机撞名(约 36^-9 概率),换一组重试
			}
			response.Fail(c, response.CodeServerError, "生成用户失败")
			return
		}

		eventlog.Biz(&model.BizLog{
			UserID:     u.ID,
			Action:     "user_generate",
			Summary:    "管理员快速生成用户：" + u.Username,
			RefID:      u.ID,
			RefType:    "user",
			OperatorID: middleware.CurrentUserID(c),
		})
		response.OK(c, GeneratedUserVO{ID: u.ID, Username: u.Username, Password: pw})
		return
	}
	response.Fail(c, response.CodeServerError, "生成用户失败，请重试")
}

// 积分流水等关联数据保留（审计需要），仅账号本体不可见。删除前先把
// username/email 改写为 del.<id>. 前缀的墓碑值，释放唯一索引，让同邮箱可以
// 重新注册。已签发的 access token 到期自然失效（refresh 会因查不到用户被拒）。
//
// 保护：不能删除自己；不能删除管理员账号（需先在编辑里降为普通用户），
// 与内置角色的删除保护同口径。
func (h *userHandler) deleteUser(c *gin.Context) {
	id, ok := g1ParseID(c, "user")
	if !ok {
		return
	}
	if id == middleware.CurrentUserID(c) {
		response.Fail(c, response.CodeBadRequest, "不能删除当前登录的账号")
		return
	}

	u, err := h.findUser(id)
	if err != nil {
		h.failLookup(c, err, "failed to load user")
		return
	}
	if u.Role == 9 {
		response.Fail(c, response.CodeBadRequest, "管理员账号不可删除，请先将其降为普通用户")
		return
	}

	// Keep a human-readable trace of who this was for the business log.
	trace := u.Email
	if trace == "" {
		trace = u.Username
	}

	err = h.db.Transaction(func(tx *gorm.DB) error {
		// Tombstone-rename to free the unique username/email indexes. The id
		// prefix keeps the new values unique; truncate to the column sizes.
		fields := map[string]any{
			"username": g1Tombstone(u.Username, id, 64),
			"email":    g1Tombstone(u.Email, id, 128),
		}
		if err := tx.Model(&model.User{}).Where("id = ?", id).Updates(fields).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.User{}).Error
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to delete user")
		return
	}

	eventlog.Biz(&model.BizLog{
		UserID:     id,
		Action:     "user_delete",
		Summary:    "管理员删除用户：" + trace,
		RefID:      id,
		RefType:    "user",
		OperatorID: middleware.CurrentUserID(c),
		Detail:     eventlog.Truncate(fmt.Sprintf("username=%s email=%s", u.Username, u.Email), 1024),
	})

	response.OK[any](c, nil)
}

// g1Tombstone rewrites a unique credential as "del.<id>.<original>" clipped to
// the column size, so the original value is freed for re-registration while the
// row keeps a readable trace. Empty originals stay empty-prefixed but unique.
func g1Tombstone(original string, id idgen.ID, max int) string {
	s := fmt.Sprintf("del.%s.%s", id.String(), original)
	if len(s) > max {
		s = s[:max]
	}
	return s
}

// adjustPoints handles POST /users/:id/points. It atomically adjusts the user's
// points balance (clamped to >= 0) and writes a point_record ledger row, so the
// change is visible on the user-facing points page.
func (h *userHandler) adjustPoints(c *gin.Context) {
	id, ok := g1ParseID(c, "user")
	if !ok {
		return
	}
	var dto PointAdjustDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	// 运营不得调整管理员账号的积分(与 updateUser 的管理员账号保护同口径)
	if middleware.CurrentRole(c) != middleware.AdminRole {
		if t, err := h.findUser(id); err == nil && t.Role == middleware.AdminRole {
			response.Fail(c, response.CodeForbidden, "仅超级管理员可操作管理员账号")
			return
		}
	}

	var newBalance int64
	err := h.db.Transaction(func(tx *gorm.DB) error {
		var u model.User
		if err := tx.Select("id", "points").Where("id = ?", id).First(&u).Error; err != nil {
			return err
		}
		newBalance = u.Points + int64(dto.Amount)
		if newBalance < 0 {
			newBalance = 0
		}
		if err := tx.Model(&model.User{}).Where("id = ?", id).
			Update("points", newBalance).Error; err != nil {
			return err
		}
		remark := strings.TrimSpace(dto.Remark)
		if remark == "" {
			remark = "管理员调整"
		}
		ledger := &model.PointRecord{
			UserID:     id,
			ChangeType: changeTypeAdmin,
			Amount:     dto.Amount,
			Balance:    int(newBalance),
			Remark:     remark,
		}
		ledger.ID = idgen.Next()
		return tx.Create(ledger).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "user not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to adjust points")
		return
	}

	eventlog.Biz(&model.BizLog{
		UserID:     id,
		Action:     "points_adjust",
		Summary:    "管理员调整积分",
		Points:     int64(dto.Amount),
		RefType:    "point_record",
		OperatorID: middleware.CurrentUserID(c),
		Detail:     eventlog.Truncate(strings.TrimSpace(dto.Remark), 1024),
	})

	response.OK(c, gin.H{"points": newBalance})
}

// ----- role handlers --------------------------------------------------------

// listRoles handles GET /roles. Returns all sys_role rows (newest first).
func (h *userHandler) listRoles(c *gin.Context) {
	var rows []model.SysRole
	if err := h.db.Order("create_time DESC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list roles")
		return
	}
	vos := make([]RoleVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toRoleVO(&rows[i]))
	}
	response.OK(c, vos)
}

// createRole handles POST /roles.
func (h *userHandler) createRole(c *gin.Context) {
	if !requireSuper(c, "管理权限角色") {
		return
	}
	var dto RoleSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	role := &model.SysRole{
		Name:        strings.TrimSpace(dto.Name),
		Code:        strings.TrimSpace(dto.Code),
		Permissions: strings.TrimSpace(dto.Permissions),
		Description: strings.TrimSpace(dto.Description),
		Status:      1,
	}
	if dto.Status != nil {
		role.Status = *dto.Status
	}
	role.ID = idgen.Next()
	if err := h.db.Create(role).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to create role")
		return
	}

	eventlog.Biz(&model.BizLog{
		Action:     "role_create",
		Summary:    "管理员创建权限角色：" + role.Name,
		RefID:      role.ID,
		RefType:    "role",
		OperatorID: middleware.CurrentUserID(c),
	})

	response.OK(c, toRoleVO(role))
}

// updateRole handles PUT /roles/:id.
func (h *userHandler) updateRole(c *gin.Context) {
	if !requireSuper(c, "管理权限角色") {
		return
	}
	id, ok := g1ParseID(c, "role")
	if !ok {
		return
	}
	var dto RoleSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	var role model.SysRole
	if err := h.db.Where("id = ?", id).First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "role not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load role")
		return
	}

	// 基线角色（用户/管理员）的 code 是注册默认角色与菜单兜底的锚点，不随表单改走；
	// 其余字段（名称/权限/描述/状态）照常可编辑。
	code := strings.TrimSpace(dto.Code)
	if role.Code == model.RoleCodeUser || role.Code == model.RoleCodeAdmin {
		code = role.Code
	}
	fields := map[string]any{
		"name":        strings.TrimSpace(dto.Name),
		"code":        code,
		"permissions": strings.TrimSpace(dto.Permissions),
		"description": strings.TrimSpace(dto.Description),
	}
	if dto.Status != nil {
		fields["status"] = *dto.Status
	}
	if err := h.db.Model(&model.SysRole{}).Where("id = ?", id).Updates(fields).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to update role")
		return
	}

	if err := h.db.Where("id = ?", id).First(&role).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load role")
		return
	}
	// 后台模块权限即时生效(否则最长延迟 permsCacheTTL)
	middleware.InvalidateAdminPermsCache()

	eventlog.Biz(&model.BizLog{
		Action:     "role_update",
		Summary:    "管理员修改权限角色：" + role.Name,
		RefID:      id,
		RefType:    "role",
		OperatorID: middleware.CurrentUserID(c),
	})

	response.OK(c, toRoleVO(&role))
}

// deleteRole handles DELETE /roles/:id (soft delete via gorm.DeletedAt).
func (h *userHandler) deleteRole(c *gin.Context) {
	if !requireSuper(c, "管理权限角色") {
		return
	}
	id, ok := g1ParseID(c, "role")
	if !ok {
		return
	}
	// 基线角色（用户/管理员）拒绝删除：注册默认角色与侧栏菜单兜底都依赖它们，
	// 与 sys_config 基线键的删除保护同口径。
	var target model.SysRole
	if err := h.db.Select("id", "code").Where("id = ?", id).First(&target).Error; err == nil {
		if target.Code == model.RoleCodeUser || target.Code == model.RoleCodeAdmin {
			response.Fail(c, response.CodeBadRequest, "内置角色（用户/管理员）不可删除")
			return
		}
	}
	res := h.db.Where("id = ?", id).Delete(&model.SysRole{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete role")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "role not found")
		return
	}
	middleware.InvalidateAdminPermsCache()

	eventlog.Biz(&model.BizLog{
		Action:     "role_delete",
		Summary:    "管理员删除权限角色",
		RefID:      id,
		RefType:    "role",
		OperatorID: middleware.CurrentUserID(c),
	})

	response.OK[any](c, nil)
}

// ----- helpers --------------------------------------------------------------

// requireSuper 拒绝非超管(role≠9)调用:角色 CRUD、变更用户角色等能改写权限
// 体系的操作只留给超管——否则拿到「用户管理」模块的运营可以给自己的角色勾满
// 后台权限或把自己的账号改成管理员,整个模块权限体系就被绕穿了。
func requireSuper(c *gin.Context, action string) bool {
	if middleware.CurrentRole(c) == middleware.AdminRole {
		return true
	}
	response.Fail(c, response.CodeForbidden, "仅超级管理员可"+action)
	return false
}

// changeTypeAdmin is the PointRecord.ChangeType for an admin manual adjustment.
const changeTypeAdmin = "admin"

// findUser loads a user by id, mapping a missing row to gorm.ErrRecordNotFound.
func (h *userHandler) findUser(id idgen.ID) (*model.User, error) {
	var u model.User
	if err := h.db.Where("id = ?", id).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// countByOwner returns a map of ownerID -> row count for the given model, scoped
// to the supplied ids and grouped by ownerCol. Empty ids yields an empty map.
func (h *userHandler) countByOwner(m any, ownerCol string, ids []idgen.ID) map[idgen.ID]int64 {
	out := map[idgen.ID]int64{}
	if len(ids) == 0 {
		return out
	}
	type cntRow struct {
		Owner idgen.ID `gorm:"column:owner"`
		N     int64    `gorm:"column:n"`
	}
	var rows []cntRow
	err := h.db.Model(m).
		Select(ownerCol+" AS owner, COUNT(*) AS n").
		Where(ownerCol+" IN ?", ids).
		Group(ownerCol).
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for i := range rows {
		out[rows[i].Owner] = rows[i].N
	}
	return out
}

// failLookup maps a lookup error to the appropriate response code.
func (h *userHandler) failLookup(c *gin.Context, err error, fallback string) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, response.CodeNotFound, "user not found")
		return
	}
	response.Fail(c, response.CodeServerError, fallback)
}

// toAdminUserVO maps a user row to the admin VO (counts are filled by the caller).
func toAdminUserVO(u *model.User) AdminUserVO {
	return AdminUserVO{
		ID:            u.ID,
		Username:      u.Username,
		Email:         u.Email,
		Phone:         u.Phone,
		Nickname:      u.Nickname,
		Avatar:        u.Avatar,
		Role:          u.Role,
		RoleID:        u.RoleID,
		VipLevel:      u.VipLevel,
		Status:        u.Status,
		ApiQuota:      u.ApiQuota,
		Points:        u.Points,
		IsAuthor:      u.IsAuthor,
		StorageQuota:  u.StorageQuota,
		StorageUsed:   u.StorageUsed,
		CreateTime:    g1FormatTime(u.CreateTime),
		LastLoginTime: g1FormatTime(u.LastLoginTime),
	}
}

// toRoleVO maps a sys_role row to its VO.
func toRoleVO(r *model.SysRole) RoleVO {
	return RoleVO{
		ID:          r.ID,
		Name:        r.Name,
		Code:        r.Code,
		Permissions: r.Permissions,
		Description: r.Description,
		Status:      r.Status,
		CreateTime:  g1FormatTime(r.CreateTime),
		UpdateTime:  g1FormatTime(r.UpdateTime),
	}
}

// g1ParseID extracts and validates the :id path param, writing a 400 on failure.
// label names the entity in the error message (e.g. "user", "role").
func g1ParseID(c *gin.Context, label string) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid "+label+" id")
		return 0, false
	}
	return id, true
}

// g1FormatTime renders a time as RFC3339, or "" for the zero value. Prefixed to
// avoid colliding with other admin groups' helpers in the same package.
func g1FormatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// g1EscapeLike escapes LIKE wildcards so user input is matched literally.
func g1EscapeLike(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return r.Replace(s)
}
