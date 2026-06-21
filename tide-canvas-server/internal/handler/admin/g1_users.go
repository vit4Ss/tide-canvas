package admin

import (
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
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
	g.GET("/users/:id", h.getUser)
	g.PUT("/users/:id", h.updateUser)
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
//	keyword? matches username/email/nickname/phone
//	role?    exact User.Role (0 user / 1 vip / 9 admin) — sent as a pointer so 0 is distinguishable from "unset"
//	status?  exact User.Status (0 disabled / 1 active)
type AdminUserQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Role     *int   `form:"role"`
	Status   *int   `form:"status"`
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

	vos := make([]AdminUserVO, 0, len(rows))
	for i := range rows {
		vo := toAdminUserVO(&rows[i])
		vo.ProjectCount = projCounts[rows[i].ID]
		vo.PostCount = postCounts[rows[i].ID]
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
	response.OK(c, toAdminUserVO(u))
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
	response.OK(c, toRoleVO(role))
}

// updateRole handles PUT /roles/:id.
func (h *userHandler) updateRole(c *gin.Context) {
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

	fields := map[string]any{
		"name":        strings.TrimSpace(dto.Name),
		"code":        strings.TrimSpace(dto.Code),
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
	response.OK(c, toRoleVO(&role))
}

// deleteRole handles DELETE /roles/:id (soft delete via gorm.DeletedAt).
func (h *userHandler) deleteRole(c *gin.Context) {
	id, ok := g1ParseID(c, "role")
	if !ok {
		return
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
	response.OK[any](c, nil)
}

// ----- helpers --------------------------------------------------------------

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
