package model

// CanvasProject 画布项目表 canvas_project。
type CanvasProject struct {
	PublicModel
	UserID      int64  `json:"-" gorm:"column:user_id"`
	Name        string `json:"name" gorm:"column:name"`
	Description string `json:"description" gorm:"column:description"`
	Thumbnail   string `json:"thumbnail" gorm:"column:thumbnail"`
	// CanvasData 画布 JSON（LONGTEXT）；列表查询应不 SELECT 此列，仅详情返回。
	CanvasData string `json:"canvasData,omitempty" gorm:"column:canvas_data"`
	IsPublic   int    `json:"isPublic" gorm:"column:is_public"`
	ShareToken string `json:"shareToken,omitempty" gorm:"column:share_token"`
	URLToken   string `json:"urlToken,omitempty" gorm:"column:url_token"`
	Status     int    `json:"status" gorm:"column:status"`
}

// TableName 表名。
func (CanvasProject) TableName() string { return "canvas_project" }
