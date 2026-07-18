package model

// SysFile 文件表 sys_file。对外以 public_id 访问。
type SysFile struct {
	PublicModel
	UserID       int64  `json:"-" gorm:"column:user_id"`
	OriginalName string `json:"originalName" gorm:"column:original_name"`
	StoredName   string `json:"storedName" gorm:"column:stored_name"`
	FilePath     string `json:"-" gorm:"column:file_path"`
	FileURL      string `json:"fileUrl" gorm:"column:file_url"`
	FileSize     int64  `json:"fileSize" gorm:"column:file_size"`
	FileType     string `json:"fileType" gorm:"column:file_type"`
	MimeType     string `json:"mimeType" gorm:"column:mime_type"`
	Hash         string `json:"-" gorm:"column:hash"`
	StorageType  string `json:"storageType" gorm:"column:storage_type"`
}

// TableName 表名。
func (SysFile) TableName() string { return "sys_file" }

// SysAdminFile 管理员资源表 sys_admin_file。用于后台配置类资源，与用户素材 sys_file 物理隔离。
type SysAdminFile struct {
	PublicModel
	AdminID      int64  `json:"-" gorm:"column:admin_id"`
	BizType      string `json:"bizType" gorm:"column:biz_type"`
	OriginalName string `json:"originalName" gorm:"column:original_name"`
	StoredName   string `json:"storedName" gorm:"column:stored_name"`
	FilePath     string `json:"-" gorm:"column:file_path"`
	FileURL      string `json:"fileUrl" gorm:"column:file_url"`
	FileSize     int64  `json:"fileSize" gorm:"column:file_size"`
	FileType     string `json:"fileType" gorm:"column:file_type"`
	MimeType     string `json:"mimeType" gorm:"column:mime_type"`
	Hash         string `json:"-" gorm:"column:hash"`
	StorageType  string `json:"storageType" gorm:"column:storage_type"`
}

// TableName 表名。
func (SysAdminFile) TableName() string { return "sys_admin_file" }
