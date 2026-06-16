package community

// 社区模块 DTO / VO（对齐旧 PostCreateDTO / PostUpdateDTO / CommentCreateDTO / PostVO / CommentVO 等）。
//
// 对外 ID 规范：帖子、评论、作者一律以 public_id（string）暴露，绝不泄漏内部雪花主键。
// 接口路径参数 :id / :commentId 均为 public_id；VO 的 id、userId、parentId 亦为 public_id。

import "time"

// PostCreateReq 发布帖子请求（对齐 PostCreateDTO）。
type PostCreateReq struct {
	Title    string   `json:"title" binding:"required,max=200"`
	Content  string   `json:"content" binding:"required"`
	Images   []string `json:"images"`
	Category string   `json:"category"`
	Tags     []string `json:"tags"`
}

// PostUpdateReq 更新帖子请求（对齐 PostUpdateDTO）。
// 字段均为可选：title 非空才更新；content/category 用指针区分“未传”与“清空”；
// images/tags 用指针区分未传与置空数组；status 指针区分未传。
type PostUpdateReq struct {
	Title    string    `json:"title"`
	Content  *string   `json:"content"`
	Images   *[]string `json:"images"`
	Category *string   `json:"category"`
	Tags     *[]string `json:"tags"`
	Status   *int      `json:"status"`
}

// CommentCreateReq 发表评论请求（对齐 CommentCreateDTO）。
// parentId 为父评论 public_id（楼中楼回复），顶层评论留空。
type CommentCreateReq struct {
	Content  string `json:"content" binding:"required"`
	ParentID string `json:"parentId"`
}

// PostQuery 帖子列表查询（对齐 PostQuery + PageQuery）。
type PostQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Category string `form:"category"`
	// UserID 按作者 public_id 过滤（对齐旧 PostQuery.userId，但对外用 public_id）。
	UserID string `form:"userId"`
}

// normalize 归一化分页参数（对齐 PageQuery 默认值与上下限：pageNum≥1，1≤pageSize≤100，默认20）。
func (q *PostQuery) normalize() {
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

// PostVO 帖子列表/概要视图（对齐 PostVO）。
// id 为帖子 public_id；userId 为作者 public_id。images/tags 为原始 JSON 字符串（与旧版一致，前端自行解析）。
type PostVO struct {
	ID             string    `json:"id"`
	UserID         string    `json:"userId"`
	Nickname       string    `json:"nickname"`
	Avatar         string    `json:"avatar"`
	Title          string    `json:"title"`
	ContentPreview string    `json:"contentPreview"`
	Images         string    `json:"images"`
	ContentImages  []string  `json:"contentImages"`
	Category       string    `json:"category"`
	Tags           string    `json:"tags"`
	ViewCount      int       `json:"viewCount"`
	LikeCount      int       `json:"likeCount"`
	CommentCount   int       `json:"commentCount"`
	Liked          bool      `json:"liked"`
	CreateTime     time.Time `json:"createTime"`
}

// PostDetailVO 帖子详情视图（对齐 PostDetailVO extends PostVO，增加完整正文 content）。
type PostDetailVO struct {
	PostVO
	Content string `json:"content"`
}

// CommentVO 评论视图（对齐 CommentVO，楼中楼 replies 树形）。
// id 为评论 public_id；userId 为作者 public_id；parentId 为父评论 public_id（顶层为空串）。
type CommentVO struct {
	ID         string       `json:"id"`
	UserID     string       `json:"userId"`
	Nickname   string       `json:"nickname"`
	Avatar     string       `json:"avatar"`
	Content    string       `json:"content"`
	ParentID   string       `json:"parentId"`
	LikeCount  int          `json:"likeCount"`
	CreateTime time.Time    `json:"createTime"`
	Replies    []*CommentVO `json:"replies"`
}
