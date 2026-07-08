// Package model contains all GORM entities and the AutoMigrate hook. Repos live
// in each domain package and operate on *gorm.DB; the entities are shared here
// to avoid duplication of the persisted schema.
//
// Every id / foreign-key column uses idgen.ID so JSON serialization is a string
// (the frontend relies on string IDs to avoid JS number precision loss).
package model

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// Models returns the full ordered list of entities to migrate. Keep parents
// before children where FK ordering matters.
func Models() []any {
	return []any{
		// Core FULL entities (back real endpoints).
		&User{},
		&Project{},
		&AiProvider{},
		&AiModel{},
		&AiHandler{},
		&AiTask{},
		&AiGenerationLog{},
		&File{},

		// Extended-domain skeleton entities (see *.go in this package).
		// Community.
		&CommunityPost{},
		&PostComment{},
		&PostLike{},
		&PostBookmark{},
		&UserFollow{},
		// Points / billing.
		&PointRecord{},
		&CheckinRecord{},
		&Plan{},
		&PointPackage{},
		&Order{},
		// Marketplace.
		&ModelCategory{},
		&MarketModel{},
		// IM.
		&IMConversation{},
		&IMConversationMember{},
		&IMMessage{},
		// System / misc.
		&Notification{},
		&Banner{},
		&Team{},
		&SysRole{},

		// Admin-only sections (no public endpoint yet).
		// Inspiration / home curation.
		&Collection{},
		&PromptLib{},
		&HomeFloor{},
		// Billing / growth.
		&PayChannel{},
		&PointRule{},
		&Campaign{},
		&Coupon{},
		// System / platform.
		&AdminResource{},
		&SysLog{},
		&SysConfig{},
		&EmailTemplate{},
		&ApiKey{},

		// Audit logs (written by internal/pkg/eventlog).
		&AccessLog{},
		&LoginLog{},
		&BizLog{},
		&ModelCallLog{},
	}
}

// AutoMigrate runs GORM's schema migration for every registered model. main/db
// wiring calls this after the DB connection is established. After the schema is
// in place it runs idempotent data backfills for newly added columns.
func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(Models()...); err != nil {
		return err
	}
	// Force audience/channels/variables/scope to varchar. They were originally
	// declared type:json but actually hold free text from the admin forms, which
	// MySQL's json type rejects (Error 3140) — breaking campaign / email-template /
	// api-key writes. AutoMigrate usually performs this conversion, but we alter
	// explicitly so an already-created json column is guaranteed to be migrated.
	if err := fixupFreeTextColumns(db); err != nil {
		return err
	}
	// Backfill the market_model.type media category for rows created before the
	// column existed (idempotent: only touches rows with an empty type).
	if err := BackfillMarketModelType(db); err != nil {
		return err
	}
	// Ensure baseline sys_config keys exist (idempotent). 与 demo 种子不同，这些
	// 键在任何库（包括已投产的旧库）都必须有行，才能在后台「配置管理」中被
	// 看到和编辑；已存在时绝不覆盖管理员的修改。
	if err := ensureBaselineConfig(db); err != nil {
		return err
	}
	// Ensure the canonical home floors exist (idempotent) — 首页楼层按 type 与
	// 公开首页的区块一一对应，后台的启用/排序/数量即刻作用于首页渲染。
	return ensureBaselineFloors(db)
}

// ensureBaselineConfig inserts must-exist sys_config rows when missing.
func ensureBaselineConfig(db *gorm.DB) error {
	var row SysConfig
	return db.Where(SysConfig{ConfigKey: ConfigKeyFooterLinks}).
		Attrs(SysConfig{
			ConfigValue: DefaultFooterLinksJSON,
			Group:       "site",
			Description: "页脚链接（JSON 数组：[{title, links:[{label, href}]}]），前台 /api/site/footer 读取",
		}).
		FirstOrCreate(&row).Error
}

// CanonicalHomeFloors are the floor rows that map 1:1 onto the public
// homepage's sections. Type is the machine key the homepage matches on
// (与后台楼层编辑弹窗的「楼层类型」选项一致)；管理员改 enabled/sortOrder/
// count 即刻驱动首页的显隐、顺序与内容数量。
var CanonicalHomeFloors = []HomeFloor{
	{Name: "首屏 Hero", Subtitle: "主视觉 + 提示词输入 + 作品墙", Type: "英雄区", ContentSource: "auto", Count: 1, SortOrder: 1, Enabled: true, Layout: "carousel", Platforms: `["web"]`},
	{Name: "核心能力", Subtitle: "CORE 生成品类 + TOOL 编辑功能", Type: "能力展示", ContentSource: "manual", Count: 7, SortOrder: 2, Enabled: true, Layout: "grid", Platforms: `["web"]`},
	{Name: "无限画布", Subtitle: "节点画布演示", Type: "无限画布", ContentSource: "manual", Count: 1, SortOrder: 3, Enabled: true, Layout: "carousel", Platforms: `["web"]`},
	{Name: "作品广场", Subtitle: "社区实时作品 Coverflow", Type: "作品流", ContentSource: "auto", Count: 0, SortOrder: 4, Enabled: true, Layout: "carousel", Platforms: `["web"]`},
	{Name: "模型跑马灯", Subtitle: "在库热门模型滚动展示", Type: "模型跑马灯", ContentSource: "auto", Count: 0, SortOrder: 5, Enabled: true, Layout: "carousel", Platforms: `["web"]`},
	{Name: "常见问题", Subtitle: "首页 FAQ 折叠列表", Type: "FAQ", ContentSource: "manual", Count: 0, SortOrder: 6, Enabled: true, Layout: "list", Platforms: `["web"]`},
	{Name: "价格方案", Subtitle: "套餐卡 + 完整方案入口", Type: "价格", ContentSource: "manual", Count: 0, SortOrder: 7, Enabled: true, Layout: "grid", Platforms: `["web"]`},
}

// ensureBaselineFloors makes home_floor rows match the homepage's real
// sections: the old English demo rows (banner/works/collections — seeded when
// the floor admin had no consumer) are removed, and each canonical type is
// inserted when missing. Existing canonical rows are NEVER touched, so admin
// edits (enabled/sortOrder/count/名称) survive restarts.
func ensureBaselineFloors(db *gorm.DB) error {
	// 旧演示行：英文 type 无法映射任何首页区块，楼层接通后即为纯噪音。
	if err := db.Where("type IN ?", []string{"banner", "works", "collections"}).
		Delete(&HomeFloor{}).Error; err != nil {
		return err
	}
	for i := range CanonicalHomeFloors {
		f := CanonicalHomeFloors[i]
		var row HomeFloor
		if err := db.Where(HomeFloor{Type: f.Type}).Attrs(f).FirstOrCreate(&row).Error; err != nil {
			return err
		}
	}
	return nil
}

// fixupFreeTextColumns alters the four mis-typed json columns to varchar. Idempotent:
// on a fresh DB the columns are already varchar (no-op alter); on an existing DB they
// are converted from json. Skips columns/tables that don't exist yet.
func fixupFreeTextColumns(db *gorm.DB) error {
	fixes := []struct {
		dst   any
		field string
	}{
		{&Campaign{}, "Audience"},
		{&Campaign{}, "Channels"},
		{&EmailTemplate{}, "Variables"},
		{&ApiKey{}, "Scope"},
	}
	m := db.Migrator()
	for _, f := range fixes {
		if !m.HasTable(f.dst) || !m.HasColumn(f.dst, f.field) {
			continue
		}
		if err := m.AlterColumn(f.dst, f.field); err != nil {
			return err
		}
	}
	return nil
}

// User is an application user / account.
type User struct {
	ID                   idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	Username             string    `gorm:"size:64;uniqueIndex" json:"username"`
	Email                string    `gorm:"size:128;uniqueIndex" json:"email"`
	Phone                string    `gorm:"size:32" json:"phone"`
	Nickname             string    `gorm:"size:64" json:"nickname"`
	Avatar               string    `gorm:"size:512" json:"avatar"`
	PasswordHash         string    `gorm:"size:255" json:"-"`
	Role                 int       `gorm:"default:0" json:"role"` // 0 user, 1 vip, 9 admin
	RoleID               idgen.ID  `gorm:"default:0" json:"roleId"`
	VipLevel             int       `gorm:"default:0" json:"vipLevel"`
	ConcurrencyUnlimited int       `gorm:"default:0" json:"concurrencyUnlimited"`
	Status               int       `gorm:"default:1" json:"status"` // 0 disabled, 1 active
	ApiQuota             int64     `gorm:"default:0" json:"apiQuota"`
	Points               int64     `gorm:"default:0" json:"points"`
	IsAuthor             int       `gorm:"default:0" json:"isAuthor"`
	StorageQuota         int64     `gorm:"default:0" json:"storageQuota"`
	StorageUsed          int64     `gorm:"default:0" json:"storageUsed"`
	TeamID               idgen.ID  `gorm:"default:0" json:"teamId"`
	CreateTime           time.Time `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime           time.Time `gorm:"autoUpdateTime" json:"updateTime"`
	LastLoginTime        time.Time `json:"lastLoginTime"`
}

// TableName overrides the default pluralized table name.
func (User) TableName() string { return "users" }

// Project is a canvas project owned by a user.
type Project struct {
	ID          idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	OwnerID     idgen.ID  `gorm:"index" json:"ownerId"`
	Name        string    `gorm:"size:255" json:"name"`
	Description string    `gorm:"size:1024" json:"description"`
	Thumbnail   string    `gorm:"size:512" json:"thumbnail"`
	CanvasData  string    `gorm:"type:longtext" json:"canvasData"`
	Status      int       `gorm:"default:0" json:"status"` // 0 draft, 1 published
	IsPublic    bool      `gorm:"default:false" json:"isPublic"`
	UrlToken    string    `gorm:"size:64;index" json:"urlToken"`
	ShareToken  string    `gorm:"size:64;index" json:"shareToken"`
	CreateTime  time.Time `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime  time.Time `gorm:"autoUpdateTime" json:"updateTime"`
}

// TableName overrides the default pluralized table name.
func (Project) TableName() string { return "projects" }

// AiModel is a configured upstream AI model.
type AiModel struct {
	ID                idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	Name              string    `gorm:"size:128" json:"name"`
	Icon              string    `gorm:"size:512" json:"icon"`
	ModelID           string    `gorm:"size:128;index" json:"modelId"` // upstream model identifier
	Type              string    `gorm:"size:32" json:"type"`           // image|video|text|audio
	SupportedHandlers string    `gorm:"type:text" json:"supportedHandlers"`
	Config            string    `gorm:"type:text" json:"config"`
	PointCost         int64     `gorm:"default:0" json:"pointCost"`
	Enabled           bool      `gorm:"default:true" json:"enabled"`
	SortOrder         int       `gorm:"default:0" json:"sortOrder"`
	CreateTime        time.Time `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime        time.Time `gorm:"autoUpdateTime" json:"updateTime"`
}

// TableName overrides the default pluralized table name.
func (AiModel) TableName() string { return "ai_models" }

// AiHandler is a registered generation handler (capability).
type AiHandler struct {
	ID             idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	HandlerName    string    `gorm:"size:64;uniqueIndex" json:"handlerName"`
	Name           string    `gorm:"size:128" json:"name"`
	DisplayName    string    `gorm:"size:128" json:"displayName"`
	Description    string    `gorm:"size:1024" json:"description"`
	InputSchema    string    `gorm:"type:text" json:"inputSchema"`
	IsAsync        bool      `gorm:"default:false" json:"isAsync"`
	DefaultModelID idgen.ID  `gorm:"default:0" json:"defaultModelId"`
	PointCost      int64     `gorm:"default:0" json:"pointCost"`
	Enabled        bool      `gorm:"default:true" json:"enabled"`
	SortOrder      int       `gorm:"default:0" json:"sortOrder"`
	CreateTime     time.Time `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime     time.Time `gorm:"autoUpdateTime" json:"updateTime"`
}

// TableName overrides the default pluralized table name.
func (AiHandler) TableName() string { return "ai_handlers" }

// AiTask is a single AI generation task.
type AiTask struct {
	ID           idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	UserID       idgen.ID  `gorm:"index" json:"userId"`
	ProjectID    idgen.ID  `gorm:"index" json:"projectId"`
	Handler      string    `gorm:"size:64" json:"handler"`
	ModelID      idgen.ID  `gorm:"default:0" json:"modelId"`
	ModelName    string    `gorm:"size:128" json:"modelName"`
	Status       int       `gorm:"default:0" json:"status"` // 0 processing,1 success,2 failed,3 cancelled
	Progress     int       `gorm:"default:0" json:"progress"`
	// PointCost is the points charged up front for this task, persisted so a
	// crash-recovery sweep can refund the exact amount without recomputing it.
	PointCost    int64     `gorm:"default:0" json:"pointCost"`
	Input        string    `gorm:"type:text" json:"input"`
	ResultUrl    string    `gorm:"size:1024" json:"resultUrl"`
	ResultMeta   string    `gorm:"type:text" json:"resultMeta"`
	ErrorMsg     string    `gorm:"size:1024" json:"errorMsg"`
	CreateTime   time.Time  `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime   time.Time  `gorm:"autoUpdateTime" json:"updateTime"`
	// Nullable: an in-progress task has no completion time. A non-pointer
	// time.Time would serialize the zero value as '0000-00-00 00:00:00', which
	// MySQL rejects under the default strict sql_mode (NO_ZERO_DATE).
	CompleteTime *time.Time `gorm:"default:null" json:"completeTime"`
}

// TableName overrides the default pluralized table name.
func (AiTask) TableName() string { return "ai_tasks" }

// AiGenerationLog records an upstream generation request/response for auditing.
type AiGenerationLog struct {
	ID             idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	TaskID         idgen.ID  `gorm:"index" json:"taskId"`
	UserID         idgen.ID  `gorm:"index" json:"userId"`
	ProjectID      idgen.ID  `gorm:"index" json:"projectId"`
	HandlerName    string    `gorm:"size:64" json:"handlerName"`
	OperationType  string    `gorm:"size:64" json:"operationType"`
	Model          string    `gorm:"size:128" json:"model"`
	Operation      string    `gorm:"size:128" json:"operation"`
	RequestUrl     string    `gorm:"size:1024" json:"requestUrl"`
	RequestBody    string    `gorm:"type:longtext" json:"requestBody"`
	InputParams    string    `gorm:"type:longtext" json:"inputParams"`
	HttpStatus     int       `gorm:"default:0" json:"httpStatus"`
	ResponseBody   string    `gorm:"type:longtext" json:"responseBody"`
	UpstreamTaskID string    `gorm:"size:128" json:"upstreamTaskId"`
	Success        int       `gorm:"default:0" json:"success"`
	ResultUrl      string    `gorm:"size:1024" json:"resultUrl"`
	ErrorMsg       string    `gorm:"size:1024" json:"errorMsg"`
	DurationMs     int64     `gorm:"default:0" json:"durationMs"`
	Cost           string    `gorm:"size:64" json:"cost"` // decimal as string; empty when unknown
	CreateTime     time.Time `gorm:"autoCreateTime" json:"createTime"`
}

// TableName overrides the default pluralized table name.
func (AiGenerationLog) TableName() string { return "ai_generation_logs" }

// File is an uploaded asset.
type File struct {
	ID           idgen.ID  `gorm:"primaryKey;autoIncrement:false" json:"id"`
	OwnerID      idgen.ID  `gorm:"index" json:"ownerId"`
	OriginalName string    `gorm:"size:512" json:"originalName"`
	StorageKey   string    `gorm:"size:512" json:"storageKey"`
	FileUrl      string    `gorm:"size:1024" json:"fileUrl"`
	FileSize     int64     `gorm:"default:0" json:"fileSize"`
	FileType     string    `gorm:"size:32" json:"fileType"` // image|video|other
	MimeType     string    `gorm:"size:128" json:"mimeType"`
	StorageType  string    `gorm:"size:32" json:"storageType"` // local|oss
	CreateTime   time.Time `gorm:"autoCreateTime" json:"createTime"`
}

// TableName overrides the default pluralized table name.
func (File) TableName() string { return "files" }
