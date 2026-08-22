package model

import "tidecanvas/internal/pkg/idgen"

// skill.go — 技能(Skill):把「提示词模板 + 指定模型 + 默认参数」打包成可复用
// 卡片,在 /chat、创作台与画布节点的输入框以 chip 附着,发送时模板与用户描述
// 合并生成。v1 仅官方运营(后台 /admin/skills 管理),无 UGC;多步骤工作流类
// 技能(多分镜编排)超出单次生成架构,不在本表表达范围。

// Skill is an official generation template card (技能广场条目)。Wire shape
// mirrors tide-canvas-web/src/types/skill.ts SkillVO.
type Skill struct {
	BaseModel

	Title       string `gorm:"column:title;size:64;not null" json:"title"`
	Description string `gorm:"column:description;size:255" json:"description"`
	// Operator-facing guidance belongs to the mutable catalog metadata layer.
	// It is intentionally separate from PromptTemplate so copy edits do not
	// change execution behavior or create a new immutable version.
	UsageScenario     string `gorm:"column:usage_scenario;type:text" json:"usageScenario"`
	HowTo             string `gorm:"column:how_to;type:text" json:"howTo"`
	OutputDescription string `gorm:"column:output_description;type:text" json:"outputDescription"`
	CoverURL          string `gorm:"column:cover_url;size:512" json:"coverUrl"`
	// Category:专业影视/商业广告/短剧漫剧/动漫游戏/音乐MV/自媒体创作/通用技能…
	// 自由串,前后台用同一份推荐目录(web types/skill.ts SKILL_CATEGORIES)。
	Category string `gorm:"column:category;size:32;index" json:"category"`
	// OutputType:image | video | audio | text | file——卡片角标 + 各入口按模态过滤
	// (图片节点只列 image 技能)。
	OutputType string `gorm:"column:output_type;size:16;index" json:"outputType"`
	// PromptTemplate 为技能的核心提示词;发送时与用户描述合并(模板在前)。
	PromptTemplate string `gorm:"column:prompt_template;type:longtext" json:"promptTemplate"`
	// ModelID 关联的模型卡(AiModelVO.modelId 上游键;空 = 不指定,用户当前模型)。
	ModelID string `gorm:"column:model_id;size:128" json:"modelId"`
	// DefaultParams JSON 对象,如 {"aspectRatio":"16:9","resolution":"720P","duration":5};
	// 各入口按自己支持的键应用,未知键忽略。
	DefaultParams string `gorm:"column:default_params;type:text" json:"defaultParams"`
	AuthorName    string `gorm:"column:author_name;size:64" json:"authorName"`
	// SeedKey 官方种子的稳定标识(ensureBaselineSkills 按此判存,后台改标题/
	// 删除都不会被种子重建)。空 = 非种子来源;不下发前端。
	SeedKey string `gorm:"column:seed_key;size:64;default:'';index" json:"-"`
	// Status:0 下架 / 1 上架(公开列表仅返回上架)。
	Status    int   `gorm:"column:status;default:1" json:"status"`
	SortOrder int   `gorm:"column:sort_order;default:0" json:"sortOrder"`
	UseCount  int64 `gorm:"column:use_count;default:0" json:"useCount"`
	// Kind identifies the runtime semantics of the currently published version.
	// Existing rows are backfilled as preset, preserving the original v1 behavior.
	Kind string `gorm:"column:kind;size:16;not null;default:'preset';index" json:"kind"`
	// CurrentVersionID pins the version served by the public catalog and selected
	// for new runs. Existing direct /api/ai/generate + skillId calls continue to
	// read the legacy fields above during the compatibility window.
	CurrentVersionID idgen.ID `gorm:"column:current_version_id;default:0;index" json:"currentVersionId"`
}

// TableName overrides the default pluralization.
func (Skill) TableName() string { return "skill" }
