// Package canvas 画布项目模块：项目 CRUD / 画布数据存取 / 分享链接（对齐旧 ProjectService）。
package canvas

import "time"

// ProjectCreateReq 创建项目请求（对齐 ProjectCreateDTO）。
type ProjectCreateReq struct {
	Name        string `json:"name" binding:"required,max=128"`
	Description string `json:"description"`
}

// ProjectUpdateReq 更新项目请求（对齐 ProjectUpdateDTO）。
// 字段均为可选：name 非空才更新；description/status 用指针区分“未传”与“清空”；isPublic 指针区分未传。
type ProjectUpdateReq struct {
	Name        string  `json:"name" binding:"omitempty,max=128"`
	Description *string `json:"description"`
	Status      *int    `json:"status"`
	IsPublic    *bool   `json:"isPublic"`
}

// CanvasSaveReq 保存画布数据请求（对齐 CanvasSaveDTO）。
type CanvasSaveReq struct {
	CanvasData         string     `json:"canvasData" binding:"required"`
	Thumbnail          string     `json:"thumbnail"`
	ExpectedUpdateTime *time.Time `json:"expectedUpdateTime"`
}

// ProjectQuery 项目列表查询（对齐 ProjectQuery + PageQuery）。
type ProjectQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Status   *int   `form:"status"`
}

// normalize 归一化分页参数（对齐 PageQuery 默认值与上下限：pageNum≥1，1≤pageSize≤100，默认20）。
func (q *ProjectQuery) normalize() {
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

// ProjectVO 项目列表/概要视图（对齐 ProjectVO）。
// id 为对外 public_id；ownerId 为归属用户的 public_id（团队共享时前端据此区分自己/队友的项目）。
// 不含 canvasData 大字段（列表查询不 SELECT canvas_data）。
type ProjectVO struct {
	ID          string    `json:"id"`
	OwnerID     string    `json:"ownerId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Thumbnail   string    `json:"thumbnail"`
	Status      int       `json:"status"`
	IsPublic    bool      `json:"isPublic"`
	URLToken    string    `json:"urlToken"`
	CreateTime  time.Time `json:"createTime"`
	UpdateTime  time.Time `json:"updateTime"`
}

// ProjectDetailVO 项目详情视图（对齐 ProjectDetailVO extends ProjectVO）。
type ProjectDetailVO struct {
	ProjectVO
	CanvasData string `json:"canvasData"`
	ShareToken string `json:"shareToken"`
}

// CanvasDataVO 画布数据响应（对齐 getCanvas 返回 {canvasData}）。
type CanvasDataVO struct {
	CanvasData string    `json:"canvasData"`
	UpdateTime time.Time `json:"updateTime"`
}

// ShareVO 分享链接响应（对齐 share 返回 {shareToken, shareUrl}）。
type ShareVO struct {
	ShareToken string `json:"shareToken"`
	ShareURL   string `json:"shareUrl"`
}
