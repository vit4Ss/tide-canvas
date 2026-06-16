// Package blog 博客模块：发布 / 编辑 / 删除 / 列表 / 详情 / 付费阅读 / 打赏 / 点赞 / 浏览量
// （对齐旧 BlogService、BlogServiceImpl）。
//
// 付费阅读、打赏依赖积分能力：通过本模块定义的 PointsService 接口由 router.New 注入
// points.Service 复用 AddPoints / DeductPoints。作者昵称/头像与 public_id 映射通过 UserFinder
// 注入只读投影，避免直接耦合 user 模块实现。对外资源 id 一律用 public_id，绝不暴露雪花主键。
package blog

import "time"

// BlogCreateReq 博客创建请求（对齐 BlogCreateDTO）。
// title 必填且不超过 200 字符；content 必填；pointsRequired 缺省 0（免费）。
type BlogCreateReq struct {
	Title          string   `json:"title" binding:"required,max=200"`
	Content        string   `json:"content" binding:"required"`
	Summary        string   `json:"summary"`
	CoverImage     string   `json:"coverImage"`
	Category       string   `json:"category"`
	Tags           []string `json:"tags"`
	PointsRequired *int     `json:"pointsRequired"`
}

// BlogUpdateReq 博客更新请求（对齐 BlogUpdateDTO）。
// 字段均为可选：title 非空才更新；其余用指针区分“未传”与“传空/传零”（对齐旧 != null 守卫）。
type BlogUpdateReq struct {
	Title          string   `json:"title"`
	Content        *string  `json:"content"`
	Summary        *string  `json:"summary"`
	CoverImage     *string  `json:"coverImage"`
	Category       *string  `json:"category"`
	Tags           []string `json:"tags"`
	PointsRequired *int     `json:"pointsRequired"`
	Status         *int     `json:"status"`
}

// hasTags 区分“未传 tags”与“传了空数组清空”。旧 BlogUpdateDTO 用 List<String> != null 判断，
// Go 中 nil slice 表示未传、非 nil（含空）表示已传。
func (r *BlogUpdateReq) hasTags() bool { return r.Tags != nil }

// BlogTipReq 博客打赏请求（对齐 BlogTipDTO）。amount 必填且最小为 1。
type BlogTipReq struct {
	Amount *int `json:"amount" binding:"required,min=1"`
}

// BlogQuery 博客列表查询（对齐 BlogQuery + PageQuery）。
// authorId 为作者的对外 public_id（旧后端用内部 Long，这里对外统一 public_id）。
// free=true 仅查免费博客（points_required=0）。
type BlogQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Category string `form:"category"`
	AuthorID string `form:"authorId"`
	Free     *bool  `form:"free"`
}

// normalize 归一化分页参数（对齐 PageQuery 默认值与上下限：pageNum≥1，1≤pageSize≤100，默认 20）。
func (q *BlogQuery) normalize() {
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

// BlogVO 博客列表/概要视图（对齐 BlogVO）。
// id / authorId 均为对外 public_id；tags 为原始 JSON 字符串（对齐旧 VO 直接透传 tags 列文本）。
// 列表场景不含 content 正文。
type BlogVO struct {
	ID             string    `json:"id"`
	AuthorID       string    `json:"authorId"`
	AuthorName     string    `json:"authorName"`
	AuthorAvatar   string    `json:"authorAvatar"`
	Title          string    `json:"title"`
	Summary        string    `json:"summary"`
	CoverImage     string    `json:"coverImage"`
	Category       string    `json:"category"`
	Tags           string    `json:"tags"`
	PointsRequired int       `json:"pointsRequired"`
	ViewCount      int       `json:"viewCount"`
	LikeCount      int       `json:"likeCount"`
	TipTotal       int       `json:"tipTotal"`
	Liked          bool      `json:"liked"`
	Purchased      bool      `json:"purchased"`
	CreateTime     time.Time `json:"createTime"`
}

// BlogDetailVO 博客详情视图（对齐 BlogDetailVO extends BlogVO）。
// 若为付费博客且非作者未购买，content 为空字符串（对齐旧逻辑 content=null）。
type BlogDetailVO struct {
	BlogVO
	Content string `json:"content"`
}
