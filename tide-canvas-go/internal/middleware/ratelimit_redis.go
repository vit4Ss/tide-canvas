package middleware

import (
	"context"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// ---------------------------------------------------------------------------
// RedisLimiter：基于 Redis 的分布式 Limiter 实现（多副本部署用）。
//
// 实现 ratelimit.go 中定义的 Limiter 接口，使旧 AbuseGuard 的「固定窗口计数 +
// 违规累计 + 冷却封禁」语义在多实例下成立（计数/封禁跨进程共享、持久、原子）。
//
// 命令映射（对齐 ratelimit.go 文件末尾的 TODO）：
//   - Allow   ：INCR key；首次（==1）EXPIRE period；count <= limit 即放行。
//   - Incr    ：INCR key；首次（==1）EXPIRE period；返回 count。
//   - Ban     ：SET key reason EX d。
//   - IsBanned：EXISTS key > 0。
//
// 「INCR + 首次 EXPIRE」用 Lua 脚本保证原子，避免高并发下 INCR 与 EXPIRE 之间
// 进程崩溃/竞态导致键永不过期（计数窗口卡死）。
//
// 在 router.New 用 NewRedisLimiter(client) 替换 NewMemoryLimiter 注入即可，
// 无需改动各路由的挂载方式（见 RateLimitOptions.Limiter）。
// ---------------------------------------------------------------------------

// incrExpireScript 原子地执行「INCR key；若结果==1 则 EXPIRE key ttl」，返回自增后的计数。
// KEYS[1]=key，ARGV[1]=ttl 秒。Allow 与 Incr 共用，差异仅在调用方对返回值的处理。
var incrExpireScript = redis.NewScript(`
local c = redis.call('INCR', KEYS[1])
if c == 1 then
	redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`)

// RedisLimiter Redis 限流后端：固定窗口计数 + 封禁，跨实例共享。
type RedisLimiter struct {
	client *redis.Client
	logger *logrus.Logger // 可为 nil；仅用于在 Redis 故障降级时记 warn
}

// NewRedisLimiter 构造 Redis 限流器。client 必须非 nil（由 redisx.New 提供）。
// logger 可为 nil（不记日志）。
func NewRedisLimiter(client *redis.Client) *RedisLimiter {
	return &RedisLimiter{client: client}
}

// WithLogger 注入用于降级告警的 logger，返回自身以便链式调用；logger 为 nil 时安全（不记日志）。
func (l *RedisLimiter) WithLogger(logger *logrus.Logger) *RedisLimiter {
	l.logger = logger
	return l
}

// warn 记一条降级 warn 日志（logger 为 nil 时静默）。
func (l *RedisLimiter) warn(format string, args ...interface{}) {
	if l.logger != nil {
		l.logger.Warnf(format, args...)
	}
}

// Allow 固定窗口计数：INCR key，首次设 period 过期；count <= limit 返回 true。
// Redis 故障时安全降级为放行（返回 true），避免误伤正常请求。
func (l *RedisLimiter) Allow(key string, limit int, period time.Duration) bool {
	count, err := l.runIncrExpire(key, period)
	if err != nil {
		l.warn("[ratelimit-redis] Allow 降级放行 key=%s: %v", key, err)
		return true // 降级放行：宁可漏限，不误伤
	}
	return count <= int64(limit)
}

// Incr 自增并返回当前计数；首次写入时按 period 设过期（用于违规累计判定阈值）。
// Redis 故障时返回 0：使违规累计判定（v >= banThreshold）不成立，从而不会误封禁。
func (l *RedisLimiter) Incr(key string, period time.Duration) int64 {
	count, err := l.runIncrExpire(key, period)
	if err != nil {
		l.warn("[ratelimit-redis] Incr 失败 key=%s: %v", key, err)
		return 0 // 降级：返回 0 使封禁阈值判定不成立，不误封
	}
	return count
}

// runIncrExpire 执行原子的「INCR + 首次 EXPIRE」脚本，返回自增后的计数。
func (l *RedisLimiter) runIncrExpire(key string, period time.Duration) (int64, error) {
	seconds := int64(period.Seconds())
	if seconds < 1 {
		seconds = 1 // EXPIRE 最小 1s，避免亚秒窗口被取整为 0（永不过期）
	}
	return incrExpireScript.Run(context.Background(), l.client, []string{key}, seconds).Int64()
}

// Ban 对 key 封禁 d 时长并记录原因：SET key reason EX d。
func (l *RedisLimiter) Ban(key string, d time.Duration, reason string) {
	if err := l.client.Set(context.Background(), key, reason, d).Err(); err != nil {
		l.warn("[ratelimit-redis] Ban 失败 key=%s: %v", key, err)
	}
}

// IsBanned key 是否处于封禁冷却中：EXISTS key > 0。
// Redis 故障时返回 false（不误判为封禁），避免误伤正常请求。
func (l *RedisLimiter) IsBanned(key string) bool {
	n, err := l.client.Exists(context.Background(), key).Result()
	if err != nil {
		l.warn("[ratelimit-redis] IsBanned 降级放行 key=%s: %v", key, err)
		return false // 降级：不误判封禁
	}
	return n > 0
}

// ListBans 枚举当前所有未过期封禁：SCAN 匹配 rlBanPrefix+"*" 收集封禁键（不用 KEYS，避免阻塞 Redis），
// 对每个键 GET 取原因、TTL 取剩余秒数。剥掉 rlBanPrefix 前缀作为 Actor 返回。
// Redis 故障或单键读取失败时降级跳过该键（不影响其余），整体返回已成功读取的部分。
func (l *RedisLimiter) ListBans() []BanRecord {
	ctx := context.Background()
	out := make([]BanRecord, 0, 16)
	var cursor uint64
	for {
		keys, next, err := l.client.Scan(ctx, cursor, rlBanPrefix+"*", 100).Result()
		if err != nil {
			l.warn("[ratelimit-redis] ListBans SCAN 失败 cursor=%d: %v", cursor, err)
			break
		}
		for _, key := range keys {
			reason, err := l.client.Get(ctx, key).Result()
			if err == redis.Nil {
				continue // 键已过期/被删，跳过
			}
			if err != nil {
				l.warn("[ratelimit-redis] ListBans GET 失败 key=%s: %v", key, err)
				continue
			}
			var remain int64
			if ttl, err := l.client.TTL(ctx, key).Result(); err == nil && ttl > 0 {
				remain = int64(ttl.Seconds())
			}
			out = append(out, BanRecord{
				Actor:         strings.TrimPrefix(key, rlBanPrefix),
				Reason:        reason,
				ExpireSeconds: remain,
			})
		}
		cursor = next
		if cursor == 0 {
			break // 游标归零：遍历结束
		}
	}
	return out
}

// Unban 解除对 actor 的封禁：DEL rlBanPrefix+actor（actor 不带前缀）。
func (l *RedisLimiter) Unban(actor string) {
	if err := l.client.Del(context.Background(), rlBanPrefix+actor).Err(); err != nil {
		l.warn("[ratelimit-redis] Unban 失败 actor=%s: %v", actor, err)
	}
}

// 编译期断言：RedisLimiter 必须实现 Limiter 接口。
var _ Limiter = (*RedisLimiter)(nil)
