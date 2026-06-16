// Package security 安全封禁模块：管理端查看 / 新增 / 解除限流封禁，统一挂载于 /api/admin/security/*
// （对齐前端 adminApi.security）。
//
// Java→Go 迁移补缺。封禁数据由限流中间件（middleware.Limiter）持有：自动封禁来自限流违规累计，
// 管理端可在此手动封禁 / 解封，二者共用同一 Limiter 实例与同一封禁键空间（rlBanPrefix+actor）。
//
// actor 形如 u<id>（按用户）/ ip<addr>（按 IP），与限流中间件 actorsFor 的维度前缀一致。
// 全部接口 JWTAuth + AdminOnly + RequiresPermission（查看 security:view / 封禁解封 security:manage）。
package security

// BanInfo 一条封禁记录（对齐前端 lib/api.ts 的 BanInfo）。
//
//	actor         原始封禁主体（u<id> / ip<addr>）
//	type          维度："user"（actor 以 u 开头）/ "ip"（以 ip 开头）
//	value         去掉维度前缀后的标识（用户ID / IP 地址）
//	reason        封禁原因（可空）
//	expireSeconds 距解封剩余秒数
type BanInfo struct {
	Actor         string `json:"actor"`
	Type          string `json:"type"`
	Value         string `json:"value"`
	Reason        string `json:"reason,omitempty"`
	ExpireSeconds int64  `json:"expireSeconds"`
}

// BanReq 手动封禁请求体（对齐前端 adminApi.security.ban 的 { type, value, seconds?, reason? }）。
type BanReq struct {
	Type    string `json:"type"`    // "user" | "ip"
	Value   string `json:"value"`   // 用户ID 或 IP 地址
	Seconds int64  `json:"seconds"` // 封禁时长(秒)，<=0 时用默认
	Reason  string `json:"reason"`  // 封禁原因(可选)
}

// UnbanReq 解封请求体（对齐前端 adminApi.security.unban 的 { actor }）。actor 不带封禁前缀。
type UnbanReq struct {
	Actor string `json:"actor"` // u<id> / ip<addr>
}
