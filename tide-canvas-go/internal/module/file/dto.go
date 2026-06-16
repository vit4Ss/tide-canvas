// Package file 文件/存储模块：本地上传 / OSS 直传预签名 / 登记 / 列表 / 删除 / 代理下载 / 从URL保存。
// 对齐旧 FileController + FileServiceImpl，存储抽象见 storage.go。
package file

import "time"

// PresignReq 申请前端直传凭据请求（对齐 FilePresignDTO）。
type PresignReq struct {
	// Filename 文件名，必填。
	Filename string `json:"filename" binding:"required"`
	// ContentType MIME 类型，可空（空则按 application/octet-stream 处理）。
	ContentType string `json:"contentType"`
	// FileType 可选，不传则由 contentType 推断 image / video / other。
	FileType string `json:"fileType"`
}

// RegisterReq 前端直传完成后登记文件请求（对齐 FileRegisterDTO）。
type RegisterReq struct {
	// Key presign 返回的对象键，必填。
	Key string `json:"key" binding:"required"`
	// OriginalName 原始文件名，可空（空则取对象键末段）。
	OriginalName string `json:"originalName"`
	// ContentType 仅占位：登记时以预签名票据记录的类型为准，不信任此入参（防绕过白名单）。
	ContentType string `json:"contentType"`
	// FileType 仅占位：同 ContentType，以票据为准。
	FileType string `json:"fileType"`
}

// SaveFromURLReq 从 URL 保存为素材请求（对齐旧 saveFromUrl 的 Map<String,Object> body）。
type SaveFromURLReq struct {
	URL          string `json:"url"`
	FileType     string `json:"fileType"`
	OriginalName string `json:"originalName"`
}

// ListQuery 文件列表查询（对齐 FileQuery extends PageQuery）。
type ListQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	FileType string `form:"fileType"`
	Keyword  string `form:"keyword"`
}

// normalize 套用分页默认值与边界（对齐 PageQuery：pageNum≥1，1≤pageSize≤100，默认 20）。
func (q *ListQuery) normalize() {
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

// PresignVO 前端直传凭据视图（对齐 FilePresignVO）。
// Direct=false 表示当前存储（本地）不支持直传，前端应回退到服务器中转上传。
type PresignVO struct {
	// Direct 是否可走前端直传。
	Direct bool `json:"direct"`
	// UploadURL 预签名 PUT 地址（Direct=true 时有效）。
	UploadURL string `json:"uploadUrl,omitempty"`
	// Key 对象键，登记时回传。
	Key string `json:"key,omitempty"`
	// FileURL 最终公网访问地址。
	FileURL string `json:"fileUrl,omitempty"`
	// ContentType 直传时必须随 PUT 一起发送的 Content-Type（须与签名一致）。
	ContentType string `json:"contentType,omitempty"`
}

// FileVO 文件视图（对齐 FileVO）。对外 id = public_id。
type FileVO struct {
	// ID 对外公开ID（public_id）。
	ID string `json:"id"`
	// OwnerID 归属用户对外ID（团队共享时前端据此区分自己/队友的素材）。
	OwnerID string `json:"ownerId"`
	OriginalName string    `json:"originalName"`
	FileURL      string    `json:"fileUrl"`
	FileSize     int64     `json:"fileSize"`
	FileType     string    `json:"fileType"`
	MimeType     string    `json:"mimeType"`
	StorageType  string    `json:"storageType"`
	CreateTime   time.Time `json:"createTime"`
}
