package security

import (
	"strings"
	"time"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
)

// 维度前缀（与限流中间件 actorsFor 一致：u<id> 按用户，ip<addr> 按 IP）。
const (
	actorPrefixUser = "u"
	actorPrefixIP   = "ip"
	typeUser        = "user"
	typeIP          = "ip"
)

// defaultBanSeconds 手动封禁未指定时长时的默认值（秒），对齐限流默认封禁冷却 600s。
const defaultBanSeconds = 600

// Service 安全封禁业务：基于限流中间件 Limiter 的封禁数据做查看 / 手动封禁 / 解封。
// 与限流中间件共用同一 Limiter 实例（由 router 注入），故管理端操作与自动封禁同一键空间。
type Service struct {
	limiter middleware.Limiter
}

// NewService 构造。limiter 须为与限流中间件相同的实例（router 中 SetDefaultLimiter 的同一对象）。
func NewService(limiter middleware.Limiter) *Service {
	return &Service{limiter: limiter}
}

// ListBans 列出当前所有封禁（对齐前端 adminApi.security.bans）。
// 由 Limiter.ListBans 取得（actor 已剥前缀），按 actor 维度前缀映射 type/value。
func (s *Service) ListBans() []BanInfo {
	records := s.limiter.ListBans()
	out := make([]BanInfo, 0, len(records))
	for _, r := range records {
		typ, value := splitActor(r.Actor)
		out = append(out, BanInfo{
			Actor:         r.Actor,
			Type:          typ,
			Value:         value,
			Reason:        r.Reason,
			ExpireSeconds: r.ExpireSeconds,
		})
	}
	return out
}

// Ban 手动封禁（对齐前端 adminApi.security.ban）。按 type/value 拼 actor 后封禁指定时长。
// 返回是否成功（type/value 非法时返回 false，不写入）。
func (s *Service) Ban(req *BanReq) bool {
	actor, ok := buildActor(req.Type, req.Value)
	if !ok {
		return false
	}
	seconds := req.Seconds
	if seconds <= 0 {
		seconds = defaultBanSeconds
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "管理员手动封禁"
	}
	// 与限流中间件共用键空间：传入 BanKey(actor)（含 rlBanPrefix 前缀）。
	s.limiter.Ban(middleware.BanKey(actor), time.Duration(seconds)*time.Second, reason)
	return true
}

// Unban 解封（对齐前端 adminApi.security.unban）。actor 不带前缀，Limiter.Unban 内部补前缀删除。
func (s *Service) Unban(actor string) {
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return
	}
	s.limiter.Unban(actor)
}

// ---- actor 维度解析 ----

// buildActor 由 type/value 构造不带封禁前缀的 actor（user→u<value>，ip→ip<value>）。
// value 为空或 type 不识别时返回 ("", false)。
func buildActor(typ, value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	switch typ {
	case typeUser:
		return actorPrefixUser + value, true
	case typeIP:
		return actorPrefixIP + value, true
	default:
		return "", false
	}
}

// splitActor 由 actor 还原 (type, value)：以 "ip" 开头→ip 维度，以 "u" 开头→user 维度。
// 须先判 "ip"（否则 "ip1.2.3.4" 会被 "u" 之外的分支误判）。无法识别时 type 原样为空、value 为 actor。
func splitActor(actor string) (typ, value string) {
	if strings.HasPrefix(actor, actorPrefixIP) {
		return typeIP, strings.TrimPrefix(actor, actorPrefixIP)
	}
	if strings.HasPrefix(actor, actorPrefixUser) {
		return typeUser, strings.TrimPrefix(actor, actorPrefixUser)
	}
	return "", actor
}
