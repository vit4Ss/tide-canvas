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
		&UserFollow{},
		// Blog.
		&BlogCategory{},
		&BlogArticle{},
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
	// Backfill the market_model.type media category for rows created before the
	// column existed (idempotent: only touches rows with an empty type).
	return BackfillMarketModelType(db)
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
