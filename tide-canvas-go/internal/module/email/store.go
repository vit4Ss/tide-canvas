// Package email 邮箱验证码与邮件发送（迁移自旧 VerificationCodeService + EmailTemplateService）。
//
// 职责拆分：
//   - store.go    验证码存储 CodeStore（验证码/冷却/错误计数，带 TTL）；默认内存实现，Redis 待接入。
//   - template.go 邮件模板渲染（读 email_template 表，{{var}} 替换，停用回退内置文案）。
//   - sender.go   SMTP 发送（net/smtp），未启用/未配置时降级开发模式（验证码打日志）。
//   - service.go  组合上述能力，实现 auth.CodeVerifier。
package email

import (
	"sync"
	"time"
)

// CodeStore 验证码存储：承载验证码本体、同邮箱重发冷却标记、校验错误计数。
//
// 对齐旧 VerificationCodeService 的 Redis 用法：
//   - 验证码    key vcode:email:<email>，TTL=mail.code_ttl_seconds
//   - 冷却      key vcode:cooldown:email:<email>，SETNX 抢占，TTL=mail.resend_cooldown_seconds
//   - 错误计数  key vcode:fail:email:<email>，自增，与验证码同 TTL，达上限后作废
//
// 默认 MemoryCodeStore 为单实例内存实现；多实例部署须换 Redis 实现（见 RedisCodeStore）。
type CodeStore interface {
	// SetCode 写入验证码并设置存活时间，同时清除该邮箱既有错误计数（对齐旧 set + delete failKey）。
	SetCode(email, code string, ttl time.Duration)
	// GetCode 读取验证码；不存在或已过期返回 ("", false)。
	GetCode(email string) (string, bool)
	// DelCode 删除验证码与错误计数（校验成功或作废时调用）。
	DelCode(email string)

	// AcquireCooldown 抢占同邮箱重发冷却窗口（对齐 setIfAbsent）：
	// 成功（窗口空闲）返回 true 并占用 ttl；窗口仍在占用中返回 false。ttl<=0 视为不限频，恒返回 true。
	AcquireCooldown(email string, ttl time.Duration) bool
	// ReleaseCooldown 释放冷却窗口（发送失败时调用，允许用户立即重试）。
	ReleaseCooldown(email string)

	// IncrFail 记录一次校验失败并返回累计次数；ttl 仅在首次计数时设置（对齐 increment + expire on first）。
	IncrFail(email string, ttl time.Duration) int
}

// ---- 内存实现 ----

// codeEntry 验证码条目（带绝对过期时刻，懒过期）。
type codeEntry struct {
	code      string
	expiresAt time.Time
}

// failEntry 错误计数条目（带绝对过期时刻，懒过期）。
type failEntry struct {
	count     int
	expiresAt time.Time
}

// MemoryCodeStore 进程内验证码存储：sync.Mutex + map，懒过期（读取时判断 expiresAt）。
// 仅适用于单实例；多实例下验证码/冷却/计数不共享，须改用 RedisCodeStore。
type MemoryCodeStore struct {
	mu        sync.Mutex
	codes     map[string]codeEntry
	cooldowns map[string]time.Time // email -> 冷却到期时刻
	fails     map[string]failEntry
}

// NewMemoryCodeStore 构造内存验证码存储。
func NewMemoryCodeStore() *MemoryCodeStore {
	return &MemoryCodeStore{
		codes:     make(map[string]codeEntry),
		cooldowns: make(map[string]time.Time),
		fails:     make(map[string]failEntry),
	}
}

// SetCode 写入验证码并清空该邮箱错误计数。
func (s *MemoryCodeStore) SetCode(email, code string, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.codes[email] = codeEntry{code: code, expiresAt: time.Now().Add(ttl)}
	delete(s.fails, email)
}

// GetCode 读取未过期验证码；过期则顺手清除。
func (s *MemoryCodeStore) GetCode(email string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.codes[email]
	if !ok {
		return "", false
	}
	if time.Now().After(e.expiresAt) {
		delete(s.codes, email)
		delete(s.fails, email)
		return "", false
	}
	return e.code, true
}

// DelCode 删除验证码与错误计数。
func (s *MemoryCodeStore) DelCode(email string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.codes, email)
	delete(s.fails, email)
}

// AcquireCooldown 抢占冷却窗口：空闲（无记录或已到期）则占用并返回 true，否则 false。
func (s *MemoryCodeStore) AcquireCooldown(email string, ttl time.Duration) bool {
	if ttl <= 0 {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if until, ok := s.cooldowns[email]; ok && now.Before(until) {
		return false
	}
	s.cooldowns[email] = now.Add(ttl)
	return true
}

// ReleaseCooldown 释放冷却窗口。
func (s *MemoryCodeStore) ReleaseCooldown(email string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cooldowns, email)
}

// IncrFail 自增错误计数并返回累计值；首次计数时设置过期。过期后重新从 1 计起。
func (s *MemoryCodeStore) IncrFail(email string, ttl time.Duration) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	e, ok := s.fails[email]
	if !ok || now.After(e.expiresAt) {
		s.fails[email] = failEntry{count: 1, expiresAt: now.Add(ttl)}
		return 1
	}
	e.count++
	s.fails[email] = e
	return e.count
}

// 编译期断言：内存实现满足 CodeStore。
var _ CodeStore = (*MemoryCodeStore)(nil)

// TODO(redis): RedisCodeStore 用 *redis.Client 实现 CodeStore，键名沿用旧后端：
//   vcode:email:<email> / vcode:cooldown:email:<email> / vcode:fail:email:<email>。
//   - SetCode        -> SET key code EX ttl ；DEL failKey
//   - GetCode        -> GET key
//   - DelCode        -> DEL key, failKey
//   - AcquireCooldown-> SET cdKey 1 NX EX ttl（返回是否抢占成功）
//   - ReleaseCooldown-> DEL cdKey
//   - IncrFail       -> INCR failKey ；若返回 1 则 EXPIRE failKey ttl
// 多实例部署时在 router 注入 RedisCodeStore 替换 MemoryCodeStore。
