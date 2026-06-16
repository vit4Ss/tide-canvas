package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// 反刷流 / 限流中间件（忠实迁移旧后端 AbuseGuard + RateLimitAspect + RateLimitInterceptor）。
//
// 核心模型：固定窗口计数 + 违规累计 + 冷却封禁。
//   - 计数键   rl:<name>:<actor>   ：窗口内累计请求数，窗口结束自动归零。
//   - 违规键   rlv:<name>:<actor>  ：在封禁窗口内累计「超限」次数。
//   - 封禁键   rlban:<actor>       ：冷却封禁标记，跨接口全局生效。
//
// actor 形如 u123（按用户）/ ip1.2.3.4（按 IP），即「维度前缀 + 标识」，与旧 Actor.key() 一致。
// 被封禁期间所有挂了本中间件的接口直接拒绝。超限返回 ecode.RateLimit（429）。

// Dimension 限流维度：按谁计数与封禁（对齐旧 LimitDimension）。
type Dimension int

const (
	// DimUser 按当前登录用户（认证接口）。
	DimUser Dimension = iota
	// DimIP 按客户端 IP（匿名接口，如登录/注册）。
	DimIP
	// DimUserAndIP 同时按用户与 IP，任一超限即拦截（最严，适合 AI 生成等贵操作）。
	DimUserAndIP
)

// 中间件内部使用的键前缀（对齐旧 AbuseGuard 的 Redis key 规则）。
const (
	rlCountPrefix     = "rl:"    // 计数：rl:<name>:<actor>
	rlViolationPrefix = "rlv:"   // 违规累计：rlv:<name>:<actor>
	rlBanPrefix       = "rlban:" // 封禁：rlban:<actor>
)

// Limiter 限流后端抽象：计数（固定窗口）+ 封禁。
// 默认 MemoryLimiter（单机内存）；分布式部署应换 Redis 实现，见 RedisLimiter（TODO）。
type Limiter interface {
	// Allow 在 period 窗口内对 key 计数加一；未超过 limit 返回 true，超过返回 false。
	// key 由调用方拼好（含维度前缀），如 rl:ai-generate:u123。
	Allow(key string, limit int, period time.Duration) bool
	// Incr 自增并返回当前计数（用于违规累计判定阈值）；首次写入时设置 period 过期。
	Incr(key string, period time.Duration) int64
	// Ban 对 key 封禁 d 时长并记录原因。
	Ban(key string, d time.Duration, reason string)
	// IsBanned key 是否处于封禁冷却中。
	IsBanned(key string) bool
}

// ---------------------------------------------------------------------------
// MemoryLimiter：单机内存实现（固定窗口计数 + 封禁 + 惰性/周期过期清理）。
// ---------------------------------------------------------------------------

// counterEntry 固定窗口计数项。
type counterEntry struct {
	count    int64
	expireAt time.Time
}

// banEntry 封禁项。
type banEntry struct {
	reason   string
	expireAt time.Time
}

// MemoryLimiter 进程内限流后端。sync.Mutex 保护；惰性过期 + 后台周期清理回收内存。
//
// 局限（见文件末尾说明）：仅单进程有效，多实例/重启不共享、不持久；高并发下锁有竞争。
type MemoryLimiter struct {
	mu       sync.Mutex
	counters map[string]*counterEntry
	bans     map[string]*banEntry
	now      func() time.Time // 便于测试注入；默认 time.Now
}

// NewMemoryLimiter 构造内存限流器，并启动后台过期清理协程（每分钟一次）。
func NewMemoryLimiter() *MemoryLimiter {
	l := &MemoryLimiter{
		counters: make(map[string]*counterEntry),
		bans:     make(map[string]*banEntry),
		now:      time.Now,
	}
	go l.cleanupLoop(time.Minute)
	return l
}

// Allow 固定窗口计数：窗口未到则累加，到期则重置为新窗口。未超 limit 返回 true。
func (l *MemoryLimiter) Allow(key string, limit int, period time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	e := l.counters[key]
	if e == nil || now.After(e.expireAt) {
		l.counters[key] = &counterEntry{count: 1, expireAt: now.Add(period)}
		return 1 <= int64(limit)
	}
	e.count++
	return e.count <= int64(limit)
}

// Incr 自增并返回当前计数；首次写入时按 period 设过期（对齐旧违规累计 increment+expire）。
func (l *MemoryLimiter) Incr(key string, period time.Duration) int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	e := l.counters[key]
	if e == nil || now.After(e.expireAt) {
		l.counters[key] = &counterEntry{count: 1, expireAt: now.Add(period)}
		return 1
	}
	e.count++
	return e.count
}

// Ban 写入封禁标记（冷却 d 时长）。
func (l *MemoryLimiter) Ban(key string, d time.Duration, reason string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.bans[key] = &banEntry{reason: reason, expireAt: l.now().Add(d)}
}

// IsBanned key 是否仍在封禁冷却中（顺带惰性清理过期项）。
func (l *MemoryLimiter) IsBanned(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.bans[key]
	if e == nil {
		return false
	}
	if l.now().After(e.expireAt) {
		delete(l.bans, key)
		return false
	}
	return true
}

// cleanupLoop 周期回收已过期的计数与封禁项，避免内存无限增长。
func (l *MemoryLimiter) cleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		l.mu.Lock()
		now := l.now()
		for k, e := range l.counters {
			if now.After(e.expireAt) {
				delete(l.counters, k)
			}
		}
		for k, e := range l.bans {
			if now.After(e.expireAt) {
				delete(l.bans, k)
			}
		}
		l.mu.Unlock()
	}
}

// ---------------------------------------------------------------------------
// RedisLimiter：分布式实现占位（多实例共享 / 持久 / 原子计数）。
// ---------------------------------------------------------------------------

// TODO(redis): 实现基于 Redis 的 Limiter，使旧 AbuseGuard 的语义在多实例下成立：
//   - Allow：INCR rl:<name>:<actor>，首次（==1）EXPIRE period；返回值 <= limit 即放行（原子）。
//   - Incr ：INCR rlv:<name>:<actor>，首次 EXPIRE banWindow。
//   - Ban  ：SET rlban:<actor> reason EX banSeconds。
//   - IsBanned：EXISTS rlban:<actor>。
// 需注入 *redis.Client（go.mod 增加 github.com/redis/go-redis/v9）。在 router.New 用
// RedisLimiter 替换 NewMemoryLimiter 注入即可，无需改动各路由的挂载方式。

// ---------------------------------------------------------------------------
// RateLimit 中间件工厂
// ---------------------------------------------------------------------------

// RateLimitOptions 单个限流规则配置（对齐 @RateLimit 注解 + SecurityRateLimitProperties）。
type RateLimitOptions struct {
	// Name 限流名，用于计数/违规 key 与告警；空则用「请求方法+路径」。
	Name string
	// Limit 窗口内最大次数（对齐 limit，默认 60）。
	Limit int
	// Period 窗口长度（对齐 period，默认 60s）。
	Period time.Duration
	// Dimension 计数与封禁维度（默认 DimUser）。
	Dimension Dimension
	// BanThreshold 触发封禁所需的违规累计次数；0 表示只拒当次、不封禁。
	BanThreshold int
	// BanSeconds 封禁冷却时长（秒，默认 600）。
	BanSeconds int
	// BanWindow 违规累计窗口（对齐 banWindowSeconds，默认 600s）：此窗口内累计违规达 BanThreshold 即封禁。
	BanWindow time.Duration
	// Limiter 限流后端；为 nil 时用包级默认 MemoryLimiter（进程内共享）。
	Limiter Limiter
}

// 包级默认内存限流器：未显式注入 Limiter 的规则共用同一实例，
// 从而封禁可跨接口生效（对齐旧 rlban 全局语义）。懒初始化。
var (
	defaultLimiter     Limiter
	defaultLimiterOnce sync.Once
)

// SetDefaultLimiter 设置包级默认限流后端（须在 RateLimit 处理首个请求前调用，通常在 router 启动时）。
// 多副本部署用它注入 RedisLimiter，使所有未显式指定 Limiter 的限流规则共用之。
func SetDefaultLimiter(l Limiter) {
	defaultLimiterOnce.Do(func() { defaultLimiter = l })
}

func sharedMemoryLimiter() Limiter {
	defaultLimiterOnce.Do(func() { defaultLimiter = NewMemoryLimiter() })
	return defaultLimiter
}

// RateLimit 构造限流中间件。超限或处于封禁中返回 ecode.RateLimit（429）。
//
// 用法（在路由上挂载）：
//
//	// 登录：按 IP，每 60s 5 次，违规 3 次封 600s
//	g.POST("/login", middleware.RateLimit(middleware.RateLimitOptions{
//	    Name: "login", Limit: 5, Period: time.Minute, Dimension: middleware.DimIP,
//	    BanThreshold: 3, BanSeconds: 600,
//	}), h.login)
//
//	// AI 生成：按 用户+IP，任一超限即拦
//	ai.POST("/generate", middleware.RateLimit(middleware.RateLimitOptions{
//	    Name: "ai-generate", Limit: 20, Period: time.Minute, Dimension: middleware.DimUserAndIP,
//	    BanThreshold: 5, BanSeconds: 1800,
//	}), h.generate)
//
// 注入自定义 Limiter（如 Redis）：给 RateLimitOptions.Limiter 赋值即可；否则共用进程内默认实例。
func RateLimit(opts RateLimitOptions) gin.HandlerFunc {
	// 缺省值对齐旧注解默认。
	if opts.Limit <= 0 {
		opts.Limit = 60
	}
	if opts.Period <= 0 {
		opts.Period = 60 * time.Second
	}
	if opts.BanSeconds <= 0 {
		opts.BanSeconds = 600
	}
	if opts.BanWindow <= 0 {
		opts.BanWindow = 600 * time.Second
	}
	limiter := opts.Limiter
	if limiter == nil {
		limiter = sharedMemoryLimiter()
	}
	banDuration := time.Duration(opts.BanSeconds) * time.Second

	return func(c *gin.Context) {
		name := opts.Name
		if name == "" {
			name = c.Request.Method + " " + c.FullPath()
		}
		actors := actorsFor(c, opts.Dimension)
		if len(actors) == 0 {
			c.Next() // 无法判定维度（匿名且无 IP）→ 放行，避免误伤（对齐旧 actors.isEmpty）
			return
		}

		// 1) 已封禁直接拒绝（任一 actor 命中即拒）。
		for _, a := range actors {
			if limiter.IsBanned(a) {
				abortRateLimited(c, "操作过于频繁，已被暂时限制，请稍后再试")
				return
			}
		}

		// 2) 逐 actor 计数；超限则累计违规、按需封禁，并拒绝当次。
		for _, a := range actors {
			if !limiter.Allow(rlCountPrefix+name+":"+a, opts.Limit, opts.Period) {
				onViolation(limiter, name, a, opts.BanThreshold, banDuration, opts.BanWindow)
				abortRateLimited(c, ecode.RateLimit.Message())
				return
			}
		}
		c.Next()
	}
}

// onViolation 超限一次：累计违规；达到阈值且未封禁则冷却封禁（仅封禁那一刻处理，避免刷屏）。
// 对齐 AbuseGuard.onViolation。
func onViolation(limiter Limiter, name, actor string, banThreshold int, banDuration, banWindow time.Duration) {
	if banThreshold <= 0 {
		return
	}
	v := limiter.Incr(rlViolationPrefix+name+":"+actor, banWindow)
	if v >= int64(banThreshold) && !limiter.IsBanned(actor) {
		reason := "接口[" + name + "] " + strconv.Itoa(int(banWindow.Seconds())) + "s 内违规 " +
			strconv.FormatInt(v, 10) + " 次，自动封禁 " + strconv.Itoa(int(banDuration.Seconds())) + "s"
		limiter.Ban(actor, banDuration, reason)
	}
}

// actorsFor 解析当前请求在指定维度下的 actor 列表（含维度前缀）。
// 对齐 AbuseGuard.actorsFor：USER 维度但匿名 → 退化为 IP，避免无维度被绕过。
func actorsFor(c *gin.Context, dim Dimension) []string {
	wantUser := dim == DimUser || dim == DimUserAndIP
	wantIP := dim == DimIP || dim == DimUserAndIP

	list := make([]string, 0, 2)
	uid, logged := CurrentUserID(c)
	if wantUser && logged && uid != 0 {
		list = append(list, "u"+strconv.FormatInt(uid, 10))
	}
	ip := ClientIP(c)
	if wantIP && ip != "" {
		list = append(list, "ip"+ip)
	}
	// USER 维度但匿名（无 userId）→ 退化为 IP。
	if len(list) == 0 && ip != "" {
		list = append(list, "ip"+ip)
	}
	return list
}

// abortRateLimited 统一以 ecode.RateLimit（429）拒绝（响应体对齐其余中间件）。
func abortRateLimited(c *gin.Context, message string) {
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
		"success": false, "code": ecode.RateLimit.Code(), "message": message,
	})
}
