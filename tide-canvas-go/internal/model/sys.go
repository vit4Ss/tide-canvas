package model

// SysBanner Banner表 sys_banner（管理端配置）。
type SysBanner struct {
	SoftDeleteModel
	Title     string `json:"title" gorm:"column:title"`
	ImageURL  string `json:"imageUrl" gorm:"column:image_url"`
	LinkURL   string `json:"linkUrl" gorm:"column:link_url"`
	SortOrder int    `json:"sortOrder" gorm:"column:sort_order"`
	Status    int    `json:"status" gorm:"column:status"`
}

// TableName 表名。
func (SysBanner) TableName() string { return "sys_banner" }

// SysConfig 系统配置表 sys_config（config_key 即业务标识）。
type SysConfig struct {
	SoftDeleteModel
	ConfigKey   string `json:"configKey" gorm:"column:config_key"`
	ConfigValue string `json:"configValue" gorm:"column:config_value"`
	Description string `json:"description" gorm:"column:description"`
}

// TableName 表名。
func (SysConfig) TableName() string { return "sys_config" }

// EmailTemplate 邮件模板表 email_template（template_code 系统内置标识）。
type EmailTemplate struct {
	SoftDeleteModel
	TemplateCode string `json:"templateCode" gorm:"column:template_code"`
	TemplateName string `json:"templateName" gorm:"column:template_name"`
	Subject      string `json:"subject" gorm:"column:subject"`
	Content      string `json:"content" gorm:"column:content"`
	Variables    string `json:"variables" gorm:"column:variables"`
	Enabled      int    `json:"enabled" gorm:"column:enabled"`
	Remark       string `json:"remark" gorm:"column:remark"`
}

// TableName 表名。
func (EmailTemplate) TableName() string { return "email_template" }
