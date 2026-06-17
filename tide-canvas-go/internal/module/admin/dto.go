// Package admin 后台管理模块：用户管理 / 角色权限(RBAC) / 作者审核 / 邮件模板 / 积分管理 / 数据面板。
//
// 忠实迁移旧后端 controller/admin 下的 AdminUserController、AdminRoleController、
// AdminAuthorController、AdminEmailTemplateController、AdminPointsController、AdminDashboardController
// 及其对应 service。路由统一前缀 /api/admin/*。
//
// 鉴权链：JWTAuth + AdminOnly + RequiresPermission(按钮级权限码)。各接口权限码忠实迁移旧版
// @RequiresPermission（如 user:view / points:adjust，见各路由注册处与 permissionCatalog）。
// 粒度权限码清单随角色保存/下发（见 permissionCatalog / my-permissions），由 PermissionLoader 解析校验。
//
// 对外 ID 规范：
//   - 用户、作者：路径参数用 public_id（string）。
//   - 角色 SysRole 无 public_id，按主键 int64 操作（与 redeem 管理端一致）。
//   - 邮件模板无 public_id，按主键 int64 操作。
package admin

import (
	"strconv"
	"strings"
	"time"
)

// ---- 分页查询基类 ----

// PageQuery 分页查询基类（对齐旧 PageQuery 默认值与边界：pageNum>=1，1<=pageSize<=100，默认20）。
type PageQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize 校正分页参数。
func (q *PageQuery) normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// Offset 返回 SQL OFFSET。
func (q *PageQuery) Offset() int { return (q.PageNum - 1) * q.PageSize }

// ---- 用户管理 ----

// UserQuery 用户/作者列表查询（对齐 AdminUserQuery extends PageQuery）。
type UserQuery struct {
	PageQuery
	Keyword string `form:"keyword"`
	Role    *int   `form:"role"`
	Status  *int   `form:"status"`
}

// UserUpdateDTO 编辑用户（对齐 AdminUserUpdateDTO）。所有字段可选，非空才更新。
type UserUpdateDTO struct {
	Role                 *int   `json:"role"`
	VipLevel             *int   `json:"vipLevel"`
	ConcurrencyUnlimited *int   `json:"concurrencyUnlimited"` // 免AI并发限制(0否1是)；null 表示不更新
	RoleID               *int64 `json:"roleId"`               // 管理角色ID(RBAC)；null 表示不分配
	Status               *int   `json:"status"`
	APIQuota             *int   `json:"apiQuota"`
	StorageQuota         *int64 `json:"storageQuota"`
}

// UserVO 用户视图（对齐 UserVO）。id 为 public_id；teamPriceFactor / inTeam 暂不在管理端计算，置默认值。
type UserVO struct {
	ID                   string     `json:"id"` // public_id
	Username             string     `json:"username"`
	Email                string     `json:"email"`
	Phone                string     `json:"phone"`
	Nickname             string     `json:"nickname"`
	Avatar               string     `json:"avatar"`
	Role                 int        `json:"role"`
	VipLevel             int        `json:"vipLevel"`
	ConcurrencyUnlimited int        `json:"concurrencyUnlimited"`
	RoleID               *int64     `json:"roleId"`
	Status               int        `json:"status"`
	APIQuota             int        `json:"apiQuota"`
	Points               int        `json:"points"`
	IsAuthor             int        `json:"isAuthor"`
	StorageQuota         int64      `json:"storageQuota"`
	TeamID               *int64     `json:"teamId"`
	InTeam               bool       `json:"inTeam"`
	CreateTime           time.Time  `json:"createTime"`
	LastLoginTime        *time.Time `json:"lastLoginTime"`
}

// ---- 角色权限(RBAC) ----

// RoleSaveDTO 新增/编辑角色（对齐 RoleSaveDTO）。
type RoleSaveDTO struct {
	Name        string   `json:"name"`
	Code        string   `json:"code"`
	Permissions []string `json:"permissions"`
	Remark      string   `json:"remark"`
}

// RoleVO 角色视图（对齐 RoleVO）。id 为角色主键 int64（SysRole 无 public_id）。
type RoleVO struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Code        string    `json:"code"`
	Permissions []string  `json:"permissions"`
	Builtin     int       `json:"builtin"`
	Remark      string    `json:"remark"`
	CreateTime  time.Time `json:"createTime"`
	UpdateTime  time.Time `json:"updateTime"`
}

// PermissionItem 单条权限码（对齐 AdminPermissions.Item）。
type PermissionItem struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

// PermissionGroup 一组权限（对齐 AdminPermissions.Group）。
type PermissionGroup struct {
	Group string           `json:"group"`
	Items []PermissionItem `json:"items"`
}

// ---- 邮件模板 ----

// EmailTemplateUpdateDTO 更新邮件模板（对齐 EmailTemplateUpdateDTO）。
type EmailTemplateUpdateDTO struct {
	TemplateName string `json:"templateName"`
	Subject      string `json:"subject"`
	Content      string `json:"content"`
	Enabled      *int   `json:"enabled"`
	Remark       string `json:"remark"`
}

// EmailTemplatePreviewDTO 预览渲染（编辑中内容 + 变量测试值，不落库；对齐 EmailTemplatePreviewDTO）。
type EmailTemplatePreviewDTO struct {
	Subject string            `json:"subject"`
	Content string            `json:"content"`
	Params  map[string]string `json:"params"`
}

// EmailTemplateSendTestDTO 发送测试邮件（对齐 EmailTemplateSendTestDTO）。
type EmailTemplateSendTestDTO struct {
	To     string            `json:"to"`
	Params map[string]string `json:"params"`
}

// EmailTemplateVO 邮件模板视图（对齐 EmailTemplateVO）。id 为模板主键 int64。
type EmailTemplateVO struct {
	ID           int64                     `json:"id"`
	TemplateCode string                    `json:"templateCode"`
	TemplateName string                    `json:"templateName"`
	Subject      string                    `json:"subject"`
	Content      string                    `json:"content"`
	Variables    []EmailTemplateVariableVO `json:"variables"`
	Enabled      int                       `json:"enabled"`
	Remark       string                    `json:"remark"`
	UpdateTime   time.Time                 `json:"updateTime"`
}

// EmailTemplateVariableVO 模板变量说明（对齐 EmailTemplateVO.VariableVO）。
type EmailTemplateVariableVO struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Sample      string `json:"sample"`
}

// EmailRenderVO 模板渲染结果（对齐 EmailRenderVO）。
type EmailRenderVO struct {
	Subject          string   `json:"subject"`
	HTML             string   `json:"html"`
	MissingVariables []string `json:"missingVariables"`
}

// ---- 积分管理 ----

// PointsAdjustDTO 手动调整用户积分（对齐 AdminPointsAdjustDTO）。
// 注意：UserID 用 public_id（对外不暴露雪花主键）。Amount 正为加、负为扣。
type PointsAdjustDTO struct {
	UserID string `json:"userId"` // 用户 public_id
	Amount *int   `json:"amount"`
	Remark string `json:"remark"`
}

// TaskRefundDTO 对失败 AI 任务退还积分（对齐 AdminTaskRefundDTO）。
// TaskID 用 public_id（ai_task 对外以 public_id 引用）。
type TaskRefundDTO struct {
	TaskID string `json:"taskId"` // 任务 public_id
	Reason string `json:"reason"`
}

// ---- 数据面板 ----

// DashboardOverviewVO 数据概览（对齐 DashboardOverviewVO）。
type DashboardOverviewVO struct {
	TotalUsers        int64 `json:"totalUsers"`
	TodayNewUsers     int64 `json:"todayNewUsers"`
	ActiveUsers       int64 `json:"activeUsers"` // 今日活跃(DAU)
	TotalApiCalls     int64 `json:"totalApiCalls"`
	TodayApiCalls     int64 `json:"todayApiCalls"`
	TotalProjects     int64 `json:"totalProjects"`
	TodayNewProjects  int64 `json:"todayNewProjects"`
	TotalStorageBytes int64 `json:"totalStorageBytes"`
	TodayVisits       int64 `json:"todayVisits"`   // PV
	TodayVisitors     int64 `json:"todayVisitors"` // UV
	TodayLogins       int64 `json:"todayLogins"`
	ActiveWeek        int64 `json:"activeWeek"`  // WAU
	ActiveMonth       int64 `json:"activeMonth"` // MAU
}

// DashboardChartsVO 图表数据（对齐 DashboardChartsVO）。
type DashboardChartsVO struct {
	UserTrend      []DailyTrendVO    `json:"userTrend"`
	AiDistribution []NameValueVO     `json:"aiDistribution"`
	DailyCreation  []DailyCreationVO `json:"dailyCreation"`
	ModelUsage     []NameValueVO     `json:"modelUsage"`
	VisitTrend     []DailyVisitVO    `json:"visitTrend"`
	LoginTrend     []DailyCountVO    `json:"loginTrend"`
}

// DailyTrendVO 近7天用户增长/活跃（对齐 DashboardChartsVO.DailyTrendVO）。
type DailyTrendVO struct {
	Date        string `json:"date"`
	NewUsers    int64  `json:"newUsers"`
	ActiveUsers int64  `json:"activeUsers"`
}

// DailyCreationVO 近7天创作量（对齐 DashboardChartsVO.DailyCreationVO）。
type DailyCreationVO struct {
	Date     string `json:"date"`
	Projects int64  `json:"projects"`
	AiCalls  int64  `json:"aiCalls"`
}

// NameValueVO 名称-数值对（AI 分布 / 模型排行，对齐 DashboardChartsVO.NameValueVO）。
type NameValueVO struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}

// DailyVisitVO 近7天访问趋势（对齐 DashboardChartsVO.DailyVisitVO）。
type DailyVisitVO struct {
	Date string `json:"date"`
	PV   int64  `json:"pv"`
	UV   int64  `json:"uv"`
}

// DailyCountVO 近7天登录趋势（对齐 DashboardChartsVO.DailyCountVO）。
type DailyCountVO struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// ActiveUserVO 最近活跃用户条目（对齐 ActiveUserVO）。id 为 public_id。
type ActiveUserVO struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	Nickname      string     `json:"nickname"`
	Avatar        string     `json:"avatar"`
	Points        int        `json:"points"`
	LastLoginTime *time.Time `json:"lastLoginTime"`
}

// dateCountRow 日期-计数聚合行（GORM Scan 目标，对齐旧 Map<String,Object> 的 date/count）。
type dateCountRow struct {
	Date  string `gorm:"column:date"`
	Count int64  `gorm:"column:count"`
}

// nameValueRow 名称-数值聚合行（GORM Scan 目标）。
type nameValueRow struct {
	Name  string `gorm:"column:name"`
	Value int64  `gorm:"column:value"`
}

// blankToDefault 空白字符串回退默认值（对齐 StringUtils.hasText 守卫）。
func blankToDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// parseInt64Param 解析 int64 路径参数（角色 / 邮件模板等无 public_id 的资源按主键操作）。
func parseInt64Param(s string) (int64, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
