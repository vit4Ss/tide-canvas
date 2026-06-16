package admin

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 后台管理数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
// 聚合各后台子域所需的查询；按子域分组方法（见各 *_admin.go 中的调用）。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供上层做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// =====================================================================
// 用户管理
// =====================================================================

// PageUsers 用户分页（对齐 AdminUserController.list）。
// 关键词 like 用户名/邮箱/昵称；可按 role/status 过滤；按 create_time 倒序。
func (r *Repository) PageUsers(q *UserQuery) ([]model.SysUser, int64, error) {
	tx := r.db.Model(&model.SysUser{})
	if q.Keyword != "" {
		kw := "%" + q.Keyword + "%"
		// and 包裹 or，避免与 role/status 条件串联（对齐旧 .and(... .or() ...)）
		tx = tx.Where(
			r.db.Where("username LIKE ?", kw).
				Or("email LIKE ?", kw).
				Or("nickname LIKE ?", kw),
		)
	}
	if q.Role != nil {
		tx = tx.Where("role = ?", *q.Role)
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.SysUser
	if err := tx.Order("create_time DESC").
		Offset(q.Offset()).Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// PageAuthors 作者分页（对齐 AdminAuthorServiceImpl.listAuthors）：is_author=1，关键词仅匹配用户名。
func (r *Repository) PageAuthors(q *UserQuery) ([]model.SysUser, int64, error) {
	tx := r.db.Model(&model.SysUser{}).Where("is_author = ?", 1)
	if q.Keyword != "" {
		tx = tx.Where("username LIKE ?", "%"+q.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.SysUser
	if err := tx.Order("create_time DESC").
		Offset(q.Offset()).Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

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

// FindUserByPublicID 按 public_id 查询用户，未找到返回 (nil, nil)。
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

// UpdateUserColumns 局部更新用户指定列（自动维护 update_time）。
func (r *Repository) UpdateUserColumns(id int64, columns map[string]interface{}) error {
	if len(columns) == 0 {
		return nil
	}
	return r.db.Model(&model.SysUser{}).Where("id = ?", id).Updates(columns).Error
}

// =====================================================================
// 角色权限(RBAC)
// =====================================================================

// ListRoles 全部角色，按 id 升序（对齐 AdminRoleServiceImpl.listRoles）。
func (r *Repository) ListRoles() ([]model.SysRole, error) {
	var roles []model.SysRole
	if err := r.db.Order("id ASC").Find(&roles).Error; err != nil {
		return nil, err
	}
	return roles, nil
}

// FindRoleByID 按主键查询角色，未找到返回 (nil, nil)。
func (r *Repository) FindRoleByID(id int64) (*model.SysRole, error) {
	var role model.SysRole
	err := r.db.First(&role, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &role, nil
}

// ExistsRoleCode 角色编码是否已存在，excludeID 非空则排除该 id（对齐 existsCode）。
func (r *Repository) ExistsRoleCode(code string, excludeID *int64) (bool, error) {
	tx := r.db.Model(&model.SysRole{}).Where("code = ?", code)
	if excludeID != nil {
		tx = tx.Where("id <> ?", *excludeID)
	}
	var n int64
	if err := tx.Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// CreateRole 新增角色（主键由模型 BeforeCreate 注入）。
func (r *Repository) CreateRole(role *model.SysRole) error {
	return r.db.Create(role).Error
}

// UpdateRoleColumns 局部更新角色指定列。
func (r *Repository) UpdateRoleColumns(id int64, columns map[string]interface{}) error {
	return r.db.Model(&model.SysRole{}).Where("id = ?", id).Updates(columns).Error
}

// DeleteRole 逻辑删除角色（GORM 软删除，对齐 deleteById）。
func (r *Repository) DeleteRole(id int64) error {
	return r.db.Delete(&model.SysRole{}, id).Error
}

// CountUsersByRoleID 统计分配了某角色的用户数（对齐 deleteRole 的占用校验）。
func (r *Repository) CountUsersByRoleID(roleID int64) (int64, error) {
	var n int64
	err := r.db.Model(&model.SysUser{}).Where("role_id = ?", roleID).Count(&n).Error
	return n, err
}

// =====================================================================
// 邮件模板
// =====================================================================

// ListTemplates 全部邮件模板，按 id 升序（对齐 EmailTemplateServiceImpl.listTemplates）。
func (r *Repository) ListTemplates() ([]model.EmailTemplate, error) {
	var list []model.EmailTemplate
	if err := r.db.Order("id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// FindTemplateByID 按主键查询模板，未找到返回 (nil, nil)。
func (r *Repository) FindTemplateByID(id int64) (*model.EmailTemplate, error) {
	var t model.EmailTemplate
	err := r.db.First(&t, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateTemplateColumns 局部更新模板指定列。
func (r *Repository) UpdateTemplateColumns(id int64, columns map[string]interface{}) error {
	return r.db.Model(&model.EmailTemplate{}).Where("id = ?", id).Updates(columns).Error
}

// =====================================================================
// 积分管理 - AI 任务退款
// =====================================================================

// LockTaskByPublicIDForUpdate 行锁读取 AI 任务（SELECT ... FOR UPDATE，对齐 taskMapper.selectForUpdate），
// 须在事务中调用。未找到返回 (nil, nil)。
func (r *Repository) LockTaskByPublicIDForUpdate(tx *gorm.DB, publicID string) (*model.AiTask, error) {
	var t model.AiTask
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("public_id = ?", publicID).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CountTransactionsByBizType 统计某业务ID+类型的积分流水条数（退款防重复用）。
func (r *Repository) CountTransactionsByBizType(tx *gorm.DB, bizID int64, txType int) (int64, error) {
	var n int64
	err := tx.Model(&model.PointsTransaction{}).
		Where("biz_id = ? AND type = ?", bizID, txType).Count(&n).Error
	return n, err
}

// SumConsumeByBizType 汇总某业务ID+类型流水的扣分绝对值（退款金额=AI消耗扣分之和）。
func (r *Repository) SumConsumeByBizType(tx *gorm.DB, bizID int64, txType int) (int, error) {
	var consumes []model.PointsTransaction
	if err := tx.Where("biz_id = ? AND type = ?", bizID, txType).Find(&consumes).Error; err != nil {
		return 0, err
	}
	sum := 0
	for i := range consumes {
		a := consumes[i].Amount
		if a < 0 {
			a = -a
		}
		sum += a
	}
	return sum, nil
}

// =====================================================================
// 数据面板（聚合统计）
// =====================================================================

// CountAll 统计某模型未删除总数（GORM 自动过滤 deleted）。
func (r *Repository) CountAll(m interface{}) (int64, error) {
	var n int64
	err := r.db.Model(m).Count(&n).Error
	return n, err
}

// CountTodayByColumn 统计某模型今日（DATE(col)=CURDATE()）记录数。
func (r *Repository) CountTodayByColumn(m interface{}, col string) (int64, error) {
	var n int64
	err := r.db.Model(m).Where("DATE("+col+") = CURDATE()").Count(&n).Error
	return n, err
}

// CountTodayActiveUsers 今日活跃用户数（status=1 且今日登录过；对齐 countTodayActive）。
func (r *Repository) CountTodayActiveUsers() (int64, error) {
	var n int64
	err := r.db.Model(&model.SysUser{}).
		Where("status = 1 AND DATE(last_login_time) = CURDATE()").Count(&n).Error
	return n, err
}

// CountActiveSince 自指定时间以来活跃用户数（最近登录在窗口内，status=1；对齐 countActiveSince），用于 WAU/MAU。
func (r *Repository) CountActiveSince(since time.Time) (int64, error) {
	var n int64
	err := r.db.Model(&model.SysUser{}).
		Where("status = 1 AND last_login_time >= ?", since).Count(&n).Error
	return n, err
}

// SumTotalStorage 平台总存储字节（对齐 sumTotalStorage）。
func (r *Repository) SumTotalStorage() (int64, error) {
	var sum int64
	err := r.db.Model(&model.SysFile{}).
		Select("COALESCE(SUM(file_size), 0)").Scan(&sum).Error
	return sum, err
}

// CountTodayPv 今日访问量 PV：按 IP+半小时会话去重（对齐 countTodayPv）。
func (r *Repository) CountTodayPv() (int64, error) {
	var n int64
	err := r.db.Model(&model.AccessLog{}).
		Select("COUNT(DISTINCT CONCAT(ip, '-', FLOOR(UNIX_TIMESTAMP(create_time) / 1800)))").
		Where("DATE(create_time) = CURDATE()").Scan(&n).Error
	return n, err
}

// CountTodayUv 今日独立访客 UV（按 IP 去重，对齐 countTodayUv）。
func (r *Repository) CountTodayUv() (int64, error) {
	var n int64
	err := r.db.Model(&model.AccessLog{}).
		Select("COUNT(DISTINCT ip)").
		Where("DATE(create_time) = CURDATE()").Scan(&n).Error
	return n, err
}

// CountTodayLogins 今日成功登录次数（status=1，对齐 countTodayLogins）。
func (r *Repository) CountTodayLogins() (int64, error) {
	var n int64
	err := r.db.Model(&model.LoginLog{}).
		Where("status = 1 AND DATE(create_time) = CURDATE()").Count(&n).Error
	return n, err
}

// CountByDateRange 按 create_time 区间逐日统计某模型记录数（对齐各 countByDateRange）。
func (r *Repository) CountByDateRange(m interface{}, start, end time.Time) ([]dateCountRow, error) {
	var rows []dateCountRow
	err := r.db.Model(m).
		Select("DATE(create_time) AS date, COUNT(*) AS count").
		Where("create_time BETWEEN ? AND ?", start, end).
		Group("DATE(create_time)").Order("date").Scan(&rows).Error
	return rows, err
}

// CountActiveUsersByDateRange 按 last_login_time 区间逐日统计活跃用户数（status=1，对齐 countActiveByDateRange）。
func (r *Repository) CountActiveUsersByDateRange(start, end time.Time) ([]dateCountRow, error) {
	var rows []dateCountRow
	err := r.db.Model(&model.SysUser{}).
		Select("DATE(last_login_time) AS date, COUNT(*) AS count").
		Where("status = 1 AND last_login_time BETWEEN ? AND ?", start, end).
		Group("DATE(last_login_time)").Order("date").Scan(&rows).Error
	return rows, err
}

// PvByDateRange 逐日 PV（IP+半小时会话去重，对齐 pvByDateRange）。
func (r *Repository) PvByDateRange(start, end time.Time) ([]dateCountRow, error) {
	var rows []dateCountRow
	err := r.db.Model(&model.AccessLog{}).
		Select("DATE(create_time) AS date, COUNT(DISTINCT CONCAT(ip, '-', FLOOR(UNIX_TIMESTAMP(create_time) / 1800))) AS count").
		Where("create_time BETWEEN ? AND ?", start, end).
		Group("DATE(create_time)").Order("date").Scan(&rows).Error
	return rows, err
}

// UvByDateRange 逐日 UV（IP 去重，对齐 uvByDateRange）。
func (r *Repository) UvByDateRange(start, end time.Time) ([]dateCountRow, error) {
	var rows []dateCountRow
	err := r.db.Model(&model.AccessLog{}).
		Select("DATE(create_time) AS date, COUNT(DISTINCT ip) AS count").
		Where("create_time BETWEEN ? AND ?", start, end).
		Group("DATE(create_time)").Order("date").Scan(&rows).Error
	return rows, err
}

// LoginByDateRange 逐日成功登录次数（status=1，对齐 loginByDateRange）。
func (r *Repository) LoginByDateRange(start, end time.Time) ([]dateCountRow, error) {
	var rows []dateCountRow
	err := r.db.Model(&model.LoginLog{}).
		Select("DATE(create_time) AS date, COUNT(*) AS count").
		Where("status = 1 AND create_time BETWEEN ? AND ?", start, end).
		Group("DATE(create_time)").Order("date").Scan(&rows).Error
	return rows, err
}

// CountByHandler AI 任务按 handler 调用量（倒序，对齐 countByHandler）。返回 name=handler_name。
func (r *Repository) CountByHandler() ([]nameValueRow, error) {
	var rows []nameValueRow
	err := r.db.Model(&model.AiTask{}).
		Select("handler_name AS name, COUNT(*) AS value").
		Group("handler_name").Order("value DESC").Scan(&rows).Error
	return rows, err
}

// ModelUsageRank AI 模型使用排行 TopN（INNER JOIN ai_model，对齐 modelUsageRank）。
func (r *Repository) ModelUsageRank(limit int) ([]nameValueRow, error) {
	var rows []nameValueRow
	err := r.db.Table("ai_task AS t").
		Select("m.name AS name, COUNT(t.id) AS value").
		Joins("INNER JOIN ai_model m ON t.model_id = m.id").
		Where("t.deleted = 0").
		Group("m.name").Order("value DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}

// HandlerDisplayNames 返回 handler_name → display_name 映射（display 为空回退 handler_name）。
func (r *Repository) HandlerDisplayNames() (map[string]string, error) {
	var configs []model.AiHandlerConfig
	if err := r.db.Find(&configs).Error; err != nil {
		return nil, err
	}
	m := make(map[string]string, len(configs))
	for i := range configs {
		c := &configs[i]
		if _, ok := m[c.HandlerName]; ok {
			continue // 保留首个（对齐 toMap 的 (a,b)->a）
		}
		m[c.HandlerName] = blankToDefault(c.DisplayName, c.HandlerName)
	}
	return m, nil
}

// SelectActiveUsers 最近活跃用户列表（status=1 且 last_login_time 非空，按登录时间倒序，对齐 selectActiveUsers）。
func (r *Repository) SelectActiveUsers(limit int) ([]model.SysUser, error) {
	var users []model.SysUser
	err := r.db.Where("status = 1 AND last_login_time IS NOT NULL").
		Order("last_login_time DESC").Limit(limit).Find(&users).Error
	return users, err
}
