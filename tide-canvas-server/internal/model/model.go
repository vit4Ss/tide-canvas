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
		&AiTool{},
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
		&Team{},
		&SysRole{},

		// Admin-only sections (no public endpoint yet).
		// Inspiration / home curation.
		&Collection{},
		&PromptLib{},
		&HomeFloor{},
		// 风格预设(画布图片节点的风格选择器)
		&StylePreset{},
		&StyleFavorite{},
		&StyleUsage{},
		// Billing / growth.
		&PayChannel{},
		&PointRule{},
		&Campaign{},
		// System / platform.
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
	// 建 home_floor.type 唯一索引前先按 type 去重(保留最小 id),否则旧库若有重复
	// 楼层行会导致 AutoMigrate 建唯一索引失败、卡住启动。仅在表已存在时执行。
	if db.Migrator().HasTable(&HomeFloor{}) {
		if err := db.Exec(
			"DELETE t1 FROM home_floor t1 JOIN home_floor t2 ON t1.type = t2.type AND t1.id > t2.id",
		).Error; err != nil {
			return err
		}
	}
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
	if err := ensureBaselineFloors(db); err != nil {
		return err
	}
	// Ensure the canonical AI tools exist (idempotent) — 智能工具的能力由代码
	// 注册，策略（提示词/参数/上下线/文案）由这些行驱动，后台「工具管理」
	// 可编辑，已存在的行绝不覆盖管理员的修改。
	return ensureBaselineTools(db)
}

// ensureBaselineConfig inserts must-exist sys_config rows when missing.
func ensureBaselineConfig(db *gorm.DB) error {
	baseline := []SysConfig{
		{
			ConfigKey:   ConfigKeyFooterLinks,
			ConfigValue: DefaultFooterLinksJSON,
			Group:       "site",
			Description: "页脚链接（JSON 数组：[{title, links:[{label, href}]}]），前台 /api/site/footer 读取",
		},
		{
			ConfigKey:   ConfigKeyHomeGlobal,
			ConfigValue: DefaultHomeGlobalJSON,
			Group:       "home",
			Description: "首页全局配置（背景流光 + 首屏 CTA），后台「首页楼层」编辑，前台 /api/site/home-config 读取",
		},
	}
	for i := range baseline {
		var row SysConfig
		if err := db.Where(SysConfig{ConfigKey: baseline[i].ConfigKey}).
			Attrs(baseline[i]).
			FirstOrCreate(&row).Error; err != nil {
			return err
		}
	}
	return nil
}

// CanonicalHomeFloors are the floor rows that map 1:1 onto the public
// homepage's sections. Type is the machine key the homepage matches on
// (与后台楼层编辑弹窗的「楼层类型」选项一致)；管理员改 enabled/sortOrder/
// count 即刻驱动首页的显隐、顺序与内容数量。
var CanonicalHomeFloors = []HomeFloor{
	// 只有「作品流」吃动态作品，其 ContentSource 为作品来源键（hot/latest，可逗号
	// 组合）；其余楼层是静态或有自己的固有来源（模型跑马灯=模型），内容源留空。
	{Name: "首屏 Hero", Subtitle: "主视觉 + 提示词输入 + 作品墙", Type: "英雄区", ContentSource: "", Count: 1, SortOrder: 1, Enabled: true},
	{Name: "核心能力", Subtitle: "CORE 生成品类 + TOOL 编辑功能", Type: "能力展示", ContentSource: "", Count: 7, SortOrder: 2, Enabled: true},
	{Name: "无限画布", Subtitle: "节点画布演示", Type: "无限画布", ContentSource: "", Count: 1, SortOrder: 3, Enabled: true},
	{Name: "作品广场", Subtitle: "社区实时作品 Coverflow", Type: "作品流", ContentSource: "hot,latest", Count: 8, SortOrder: 4, Enabled: true},
	{Name: "模型跑马灯", Subtitle: "在库热门模型滚动展示", Type: "模型跑马灯", ContentSource: "", Count: 0, SortOrder: 5, Enabled: true},
	{Name: "常见问题", Subtitle: "首页 FAQ 折叠列表", Type: "FAQ", ContentSource: "", Count: 0, SortOrder: 6, Enabled: true},
	{Name: "价格方案", Subtitle: "套餐卡 + 完整方案入口", Type: "价格", ContentSource: "", Count: 0, SortOrder: 7, Enabled: true},
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

// CanonicalAiTools are the built-in one-click AI tools (智能工具). Handler 指向
// 代码注册的生成能力（internal/handler/ai 的 handler registry）；行本身承载
// 策略：服务端预设提示词（PresetPrompt，工程化英文指令，客户端永远拿不到）、
// 附加参数、上下线与展示文案。代码注册能力，配置决定策略 —— 所以后台只有
// 编辑/排序/上下线，没有新建与删除。
var CanonicalAiTools = []AiTool{
	{
		Key: "expand", Handler: "outpaint", Enabled: true, ShowPage: true,
		Title: "智能扩图", Desc: "Outpainting 无缝向外补全画面。",
		Icon: "⤢", CoverHues: "[28,48,8]", SortOrder: 1,
		PresetPrompt: "Expand this image outward on all sides, naturally extending the existing scene, lighting, " +
			"perspective and art style to fill a larger canvas. Keep the original content unchanged and well " +
			"composed; only generate new, seamlessly blended surroundings beyond the current borders.",
	},
	{
		// 局部重绘复用通用图生图能力：没有服务端预设指令，用户描述要改的部分。
		Key: "inpaint", Handler: "image_to_image", Enabled: true, ShowPage: true,
		Title: "局部重绘", Desc: "上传图片并描述想修改的部分，AI 精准重绘。",
		Icon: "✎", CoverHues: "[330,286,12]", SortOrder: 2, NeedPrompt: true,
		Placeholder: "描述要修改的部分…\n例：把天空换成日落晚霞，保持其余不变",
	},
	{
		Key: "rmbg", Handler: "remove_bg", Enabled: true, ShowPage: true,
		Title: "一键抠图", Desc: "智能移除背景与对象，输出干净主体。",
		Icon: "⬡", CoverHues: "[95,140,70]", SortOrder: 3,
		PresetPrompt: "Completely remove the background of this image. Keep the main foreground subject perfectly intact " +
			"with clean, precise edges and no halo or leftover fringe. Place the subject on a plain solid white " +
			"background. Do not change, recolor, crop or restyle the subject itself.",
	},
	{
		// hd：前端优先选 4K 模型并展开附加参数。参数默认最高档，输出才真的
		// 更大；set-if-empty 合并，客户端显式传参仍然生效。
		Key: "upscale", Handler: "upscale", Enabled: true, ShowPage: true,
		Title: "高清放大", Desc: "无损放大图片尺寸，智能重塑高清画质。",
		Icon: "⤡", CoverHues: "[255,230,290]", SortOrder: 4, Hd: true,
		ExtraParams: `{"resolution":"4k","clarity":"4k","quality":"high"}`,
		PresetPrompt: "Upscale this image to a higher resolution. Greatly enhance sharpness, fine detail and texture " +
			"clarity, and remove blur, noise and compression artifacts. Preserve the original content, composition, " +
			"colors and style exactly — do not add, remove or alter any elements.",
	},
	{
		Key: "rmobj", Handler: "remove_object", Enabled: true, ShowPage: false,
		Title: "物体移除", Desc: "移除画面中的杂物、路人、文字与瑕疵。",
		Icon: "⌫", CoverHues: "[200,230,170]", SortOrder: 5,
		PresetPrompt: "Remove the unwanted and distracting elements from this image — stray people, clutter, text, " +
			"watermarks and blemishes — while keeping the main subject and the overall composition unchanged. " +
			"Realistically reconstruct the area behind the removed elements so the result looks natural and seamless.",
	},
	{
		Key: "relight", Handler: "relight", Enabled: true, ShowPage: false,
		Title: "智能打光", Desc: "影视级重新打光，增强画面层次与氛围。",
		Icon: "◐", CoverHues: "[40,60,260]", SortOrder: 6,
		ExtraParams: `{"quality":"high"}`,
		PresetPrompt: "Relight this image with professional, cinematic lighting. Improve the exposure, contrast and " +
			"color balance, add soft natural highlights and gentle shadows, and enhance depth and atmosphere. " +
			"Preserve the original subject, composition, colors and style — do not add, remove or move any elements.",
	},
}

// ensureBaselineTools inserts the canonical ai_tools rows when missing. 与
// ensureBaselineFloors 同款：按 Key FirstOrCreate，已存在的行绝不改动，管理员
// 对提示词/文案/排序/上下线的修改在重启后原样保留。
func ensureBaselineTools(db *gorm.DB) error {
	for i := range CanonicalAiTools {
		t := CanonicalAiTools[i]
		var row AiTool
		res := db.Where(AiTool{Key: t.Key}).Attrs(t).FirstOrCreate(&row)
		if res.Error != nil {
			return res.Error
		}
		// GORM 会在 INSERT 时用 default 标签顶替 bool 零值（false→true），
		// canonical 里 showPage=false 的行（物体移除/智能打光）会被建成 true。
		// 仅在「本次新建」时把布尔位显式写正；已有行不动，后台开关不受影响。
		if res.RowsAffected > 0 && (!t.Enabled || !t.ShowPage) {
			if err := db.Model(&AiTool{}).Where("id = ?", row.ID).
				Updates(map[string]any{"enabled": t.Enabled, "show_page": t.ShowPage}).Error; err != nil {
				return err
			}
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

// AiTool is a config-driven one-click AI tool (智能工具，如一键抠图/高清放大)。
// Handler 绑定代码注册的生成能力；本行承载后台可调的策略：服务端预设提示词
// (PresetPrompt，仅服务端使用，公开 VO 绝不外发)、附加参数、上下线与前台
// 展示配置（独立工具页 /tools/<key> + 首页卡片）。
type AiTool struct {
	ID      idgen.ID `gorm:"primaryKey;autoIncrement:false" json:"id"`
	Key     string   `gorm:"size:32;uniqueIndex" json:"key"` // URL slug（/tools/<key>）
	Handler string   `gorm:"size:64;index" json:"handler"`   // registry handler name
	Enabled bool     `gorm:"default:true" json:"enabled"`
	// ShowPage：是否有独立工具页与首页卡片（false 的工具只在创作台工具栏出现）。
	ShowPage bool   `gorm:"default:true" json:"showPage"`
	Title    string `gorm:"size:64" json:"title"`
	Desc     string `gorm:"size:255" json:"desc"`
	// PresetPrompt is the server-owned engineered EN instruction; empty for
	// non-preset tools (局部重绘 rides the plain image_to_image capability).
	PresetPrompt string `gorm:"type:text" json:"presetPrompt"`
	// ExtraParams is a JSON object text; empty = use the handler's builtin defaults.
	ExtraParams string `gorm:"size:512" json:"extraParams"`
	NeedPrompt  bool   `json:"needPrompt"`
	// Hd：前端为该工具优先选择 4K 模型并展开附加参数。
	Hd   bool   `json:"hd"`
	Icon string `gorm:"size:8" json:"icon"` // glyph char（如 ⤢）
	// CoverHues is a JSON "[h1,h2,h3]" hue triple driving the generated cover art.
	CoverHues   string    `gorm:"size:64" json:"coverHues"`
	Placeholder string    `gorm:"size:255" json:"placeholder"`
	SortOrder   int       `json:"sortOrder"`
	CreateTime  time.Time `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime  time.Time `gorm:"autoUpdateTime" json:"updateTime"`
}

// TableName overrides the default pluralized table name.
func (AiTool) TableName() string { return "ai_tools" }

// BeforeCreate assigns a snowflake ID when one has not been set explicitly
// (mirrors BaseModel; AiTool declares its columns inline like the other core
// entities in this file, so it needs its own hook for the baseline seeding).
func (t *AiTool) BeforeCreate(_ *gorm.DB) error {
	if t.ID == 0 {
		t.ID = idgen.Next()
	}
	return nil
}

// AiTask is a single AI generation task.
type AiTask struct {
	ID        idgen.ID `gorm:"primaryKey;autoIncrement:false" json:"id"`
	UserID    idgen.ID `gorm:"index" json:"userId"`
	ProjectID idgen.ID `gorm:"index" json:"projectId"`
	Handler   string   `gorm:"size:64" json:"handler"`
	ModelID   idgen.ID `gorm:"default:0" json:"modelId"`
	ModelName string   `gorm:"size:128" json:"modelName"`
	Status    int      `gorm:"default:0" json:"status"` // 0 processing,1 success,2 failed,3 cancelled
	Progress  int      `gorm:"default:0" json:"progress"`
	// PointCost is the points charged up front for this task, persisted so a
	// crash-recovery sweep can refund the exact amount without recomputing it.
	PointCost  int64     `gorm:"default:0" json:"pointCost"`
	Input      string    `gorm:"type:text" json:"input"`
	ResultUrl  string    `gorm:"size:1024" json:"resultUrl"`
	ResultMeta string    `gorm:"type:text" json:"resultMeta"`
	ErrorMsg   string    `gorm:"size:1024" json:"errorMsg"`
	CreateTime time.Time `gorm:"autoCreateTime" json:"createTime"`
	UpdateTime time.Time `gorm:"autoUpdateTime" json:"updateTime"`
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
