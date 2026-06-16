// Package notification 站内通知模块：聚合关注 / 评论 / 点赞等动作产生的通知。
//
// 通知由各业务模块（follow / community / blog）在动作成功后通过 Notifier 接口异步投递，
// 本模块负责落库（sys_notification）、未读计数与列表查询。对外 ID 一律 public_id：
// 触发者(actor)以 public_id 暴露，关联内容以 targetPublicId（帖子/博客 public_id）暴露，
// 绝不泄漏内部雪花主键（遵循对外ID规范）。
//
// 实时推送：新通知落库后经可选 Pusher（复用 IM 的 WS 通道，由 router 回填 *im.Hub）向接收者推一条
// {"type":"notification"} 信封，触发前端角标实时 +1；Pusher 未注入时回退纯 REST（前端挂载拉未读数、打开拉列表）。
package notification

import "time"

// NotificationQuery 通知列表分页查询（对齐其他模块 PageQuery 默认值）。
// Type 为可选类型过滤（follow/comment/like），空串表示全部。
type NotificationQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Type     string `form:"type"`
}

// normalize 归一化分页参数（pageNum≥1，1≤pageSize≤100，默认 20）。
func (q *NotificationQuery) normalize() {
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

// ActorVO 触发通知者的用户摘要（id 为对外 public_id，不暴露雪花主键）。
type ActorVO struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

// NotificationVO 通知列表项视图。
//
//   - id：通知自身ID（用于按条标记已读 POST /read；通知为接收者私有的扁平流水，非对外业务实体，
//     无 public_id 一说，此处直接用内部主键，前端仅回传不展示）。
//   - actor：触发者用户摘要（含 public_id），actor 缺失（账号已删）时为零值。
//   - type：follow / comment / like。
//   - targetType：post / blog（关注类为空串）。
//   - targetPublicId：关联内容的对外 public_id（由内部 target_id 反解；无目标或反解不到为空串）。
//     前端据 targetType 跳转 /community/{targetPublicId} 或 /blogs/{targetPublicId}。
//   - content：通知摘要文案。
//   - isRead：是否已读。
//   - createTime：通知时间（列表按此倒序）。
//   - followedByMe：仅关注类(type=follow)有意义——当前用户是否已回关该 actor；
//     用于前端「回关 / 已关注」按钮的持久态。非关注类通知恒为 false。
type NotificationVO struct {
	ID             int64     `json:"id"`
	Actor          ActorVO   `json:"actor"`
	Type           string    `json:"type"`
	TargetType     string    `json:"targetType"`
	TargetPublicID string    `json:"targetPublicId"`
	Content        string    `json:"content"`
	IsRead         bool      `json:"isRead"`
	FollowedByMe   bool      `json:"followedByMe"`
	CreateTime     time.Time `json:"createTime"`
}

// ReadReq 标记已读请求（POST /api/notifications/read）。ids 为通知内部主键（前端从列表分页拿不到主键，
// 故本阶段「打开即全部已读」走 read-all；read 接口保留按 id 精确标记的能力供后续扩展）。
type ReadReq struct {
	IDs []int64 `json:"ids"`
}
