// Package banner Banner 轮播图模块：公开列表（首页轮播）+ 管理端 CRUD。
// 对齐旧 BannerController / AdminBannerController（banner 无独立 service，旧版直接用 mapper，
// 这里按 guide 拆成 repository + service 两层）。
package banner

import "time"

// CreateReq 新增 Banner 请求（对齐 BannerCreateDTO）。
type CreateReq struct {
	Title     string `json:"title" binding:"required"`
	ImageURL  string `json:"imageUrl" binding:"required"`
	LinkURL   string `json:"linkUrl"`
	SortOrder *int   `json:"sortOrder"`
	Status    *int   `json:"status"`
}

// UpdateReq 更新 Banner 请求（对齐 BannerUpdateDTO，全字段可选；仅非 nil 字段参与更新）。
type UpdateReq struct {
	Title     *string `json:"title"`
	ImageURL  *string `json:"imageUrl"`
	LinkURL   *string `json:"linkUrl"`
	SortOrder *int    `json:"sortOrder"`
	Status    *int    `json:"status"`
}

// BannerVO Banner 视图（对齐 BannerVO）。
// SysBanner 基于 SoftDeleteModel，无 public_id，故 id 直接暴露雪花主键（int64）。
type BannerVO struct {
	ID         int64     `json:"id"`
	Title      string    `json:"title"`
	ImageURL   string    `json:"imageUrl"`
	LinkURL    string    `json:"linkUrl"`
	SortOrder  int       `json:"sortOrder"`
	Status     int       `json:"status"`
	CreateTime time.Time `json:"createTime"`
}
