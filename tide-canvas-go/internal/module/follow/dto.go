// Package follow 关注模块：关注 / 取关 / 关注状态 / 我关注的列表 / 关注我的列表，
// 是后续通知系统的前置能力。
//
// 关注关系存于 sys_follow（中间表，无 public_id）。对外路径参数与 VO 中的用户标识
// 一律用 public_id，绝不暴露雪花主键（遵循对外ID规范）。作者昵称/头像与 public_id 映射
// 通过本模块定义的 UserFinder 由 router.New 注入只读投影，避免直接耦合 user 模块实现。
package follow

import "time"

// FollowQuery 关注/粉丝列表分页查询（对齐其他模块 PageQuery 默认值）。
type FollowQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize 归一化分页参数（pageNum≥1，1≤pageSize≤100，默认 20）。
func (q *FollowQuery) normalize() {
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

// FollowUserVO 关注/粉丝列表中的用户摘要视图。
// id 为该用户的对外 public_id（不暴露雪花主键）。
// following 表示「当前请求用户是否已关注该用户」；followedBy 表示「该用户是否关注了当前请求用户」。
// 二者皆 true 即互相关注（前端据此展示「互相关注」）。
type FollowUserVO struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	Nickname   string `json:"nickname"`
	Avatar     string `json:"avatar"`
	Following  bool   `json:"following"`
	FollowedBy bool   `json:"followedBy"`
	// FollowTime 建立该关注关系的时间（列表按此倒序）。
	FollowTime time.Time `json:"followTime"`
}

// FollowStatusVO 关注状态视图（GET /api/follow/:userId/status）。
// following：当前用户是否已关注对方；followedBy：对方是否关注了当前用户。
type FollowStatusVO struct {
	Following  bool `json:"following"`
	FollowedBy bool `json:"followedBy"`
}
