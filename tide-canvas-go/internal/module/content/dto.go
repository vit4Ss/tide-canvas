// Package content 内容审核模块：管理端对公开画布作品(canvas_project, is_public=1)的
// 分页查看与审核改状态，忠实迁移旧后端 AdminContentController（CanvasProjectMapper）。
//
// 管理端路由统一前缀 /api/admin/contents，全程 JWTAuth + AdminOnly + RBAC 按钮级权限
// （content:view / content:audit）。
//
// ID 规范：canvas_project 为对外业务实体（PublicModel），列表/审核一律走 public_id，
// 绝不暴露雪花主键 id；归属用户同样只暴露其昵称/用户名（不外泄 user_id）。
package content

import "time"

// ContentQuery 内容列表查询（对齐前端 ContentQuery + AdminContentController.list 入参）。
// 仅对公开作品(is_public=1)生效；keyword 模糊匹配作品名；status 精确过滤（空为全部）。
type ContentQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Status   *int   `form:"status"`
}

// normalize 归一化分页参数（对齐 PageQuery 默认值与上下限：pageNum≥1，1≤pageSize≤100，默认20）。
func (q *ContentQuery) normalize() {
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

// Offset 返回 SQL OFFSET。
func (q *ContentQuery) Offset() int { return (q.PageNum - 1) * q.PageSize }

// ContentVO 内容审核视图（对齐前端 types/admin.ts 的 ContentVO）。
// id 为对外 public_id；ownerName 为作品归属用户的昵称/用户名（前端列「创建者」直接展示）。
type ContentVO struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Thumbnail  string    `json:"thumbnail"`
	OwnerName  string    `json:"ownerName"`
	Status     int       `json:"status"`
	CreateTime time.Time `json:"createTime"`
}

// AuditReq 审核请求体（对齐前端 adminApi.contents.audit 的 { status }）。
// status 取值对齐前端：0 草稿 / 1 已发布(通过) / 2 已下架。
type AuditReq struct {
	Status *int `json:"status"`
}
