package model

// StudioTemplate is an operator-curated recipe for Studio, separate from a
// canvas-only style preset or a private Skill. Imported results start as drafts.
type StudioTemplate struct {
	BaseModel
	Kind         string                     `gorm:"size:16;not null;index:idx_studio_catalog,priority:1" json:"kind"`
	MediaType    string                     `gorm:"size:16;not null;index:idx_studio_catalog,priority:2" json:"mediaType"`
	Title        string                     `gorm:"size:128;not null" json:"title"`
	Description  string                     `gorm:"size:512" json:"description"`
	Category     string                     `gorm:"size:64;index" json:"category"`
	Prompt       string                     `gorm:"type:text" json:"prompt"`
	CoverURL     string                     `gorm:"size:2048" json:"coverUrl"`
	PreviewURL   string                     `gorm:"size:2048" json:"previewUrl"`
	AuthorName   string                     `gorm:"size:64" json:"authorName"`
	InputHint    string                     `gorm:"size:1024" json:"inputHint"`
	Mode         string                     `gorm:"size:16" json:"mode"`
	ModelKey     string                     `gorm:"size:128" json:"modelKey"`
	Requirements StudioTemplateRequirements `gorm:"serializer:json;type:text" json:"requirements"`
	Options      StudioTemplateOptions      `gorm:"serializer:json;type:text" json:"options"`
	Status       int                        `gorm:"not null;default:0;index:idx_studio_catalog,priority:3" json:"status"`
	SortOrder    int                        `gorm:"not null;default:0" json:"sortOrder"`
	Uses         int64                      `gorm:"not null;default:0" json:"uses"`
	// Never expose the source task/user or their private reference uploads.
	SourceKey *string `gorm:"size:96;uniqueIndex" json:"-"`
}

func (StudioTemplate) TableName() string { return "studio_template" }

type StudioTemplateRequirements struct {
	Images int `json:"images"`
	Videos int `json:"videos"`
	Audio  int `json:"audio"`
}

type StudioTemplateOptions struct {
	AspectRatio string `json:"aspectRatio,omitempty"`
	Resolution  string `json:"resolution,omitempty"`
	Duration    int    `json:"duration,omitempty"`
	Quality     string `json:"quality,omitempty"`
}
