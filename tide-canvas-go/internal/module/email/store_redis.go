package email

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// ---- Redis 实现 ----
//
// RedisCodeStore 用 *redis.Client 跨进程共享验证码/冷却/错误计数，供多副本部署替换 MemoryCodeStore。
// 键名沿用旧后端 VerificationCodeService：
//   - 验证码    vcode:email:<email>
//   - 冷却      vcode:cooldown:email:<email>
//   - 错误计数  vcode:fail:email:<email>
//
// 故障安全：Redis 不可用时按「不阻塞主流程」降级——
//   - GetCode 出错 → ("", false)（视为无有效验证码，校验自然失败）；
//   - AcquireCooldown 出错 → true（放行发送，不因 Redis 抖动卡住用户）；
//   - IncrFail 出错 → 0（不误判达到失败上限）。
// 写类操作（SetCode/DelCode/ReleaseCooldown）出错仅记日志、不返回错误（接口无返回值）。

// 键名前缀（对齐旧后端，与 store.go 文档/TODO 一致）。
const (
	redisCodePrefix     = "vcode:email:"          // 验证码：vcode:email:<email>
	redisCooldownPrefix = "vcode:cooldown:email:" // 冷却：  vcode:cooldown:email:<email>
	redisFailPrefix     = "vcode:fail:email:"      // 错误计数：vcode:fail:email:<email>
)

// RedisCodeStore 基于 Redis 的验证码存储。logger 可为 nil（此时静默降级）。
type RedisCodeStore struct {
	client *redis.Client
	logger *logrus.Logger
}

// NewRedisCodeStore 构造 Redis 验证码存储。logger 可为 nil（仅用于降级时记 warn）。
func NewRedisCodeStore(client *redis.Client) *RedisCodeStore {
	return &RedisCodeStore{client: client}
}

// WithLogger 注入日志器（可选），用于 Redis 故障降级时记 warn；返回自身便于链式调用。
func (s *RedisCodeStore) WithLogger(logger *logrus.Logger) *RedisCodeStore {
	s.logger = logger
	return s
}

// warnf 记录降级 warn（logger 为 nil 时静默）。
func (s *RedisCodeStore) warnf(format string, args ...any) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

// 各键的拼接。
func (s *RedisCodeStore) codeKey(email string) string     { return redisCodePrefix + email }
func (s *RedisCodeStore) cooldownKey(email string) string { return redisCooldownPrefix + email }
func (s *RedisCodeStore) failKey(email string) string     { return redisFailPrefix + email }

// SetCode 写入验证码（SET codeKey code EX ttl）并清除该邮箱既有错误计数（DEL failKey）。
func (s *RedisCodeStore) SetCode(email, code string, ttl time.Duration) {
	ctx := context.Background()
	if err := s.client.Set(ctx, s.codeKey(email), code, ttl).Err(); err != nil {
		s.warnf("[vcode] redis SET code failed for %s: %v", email, err)
		return
	}
	if err := s.client.Del(ctx, s.failKey(email)).Err(); err != nil {
		s.warnf("[vcode] redis DEL fail failed for %s: %v", email, err)
	}
}

// GetCode 读取验证码（GET codeKey）；不存在或出错返回 ("", false)。
func (s *RedisCodeStore) GetCode(email string) (string, bool) {
	ctx := context.Background()
	code, err := s.client.Get(ctx, s.codeKey(email)).Result()
	if err == redis.Nil {
		return "", false
	}
	if err != nil {
		// 故障安全：读取失败按「无有效验证码」处理，校验自然失败，不阻塞流程。
		s.warnf("[vcode] redis GET code failed for %s: %v", email, err)
		return "", false
	}
	return code, true
}

// DelCode 删除验证码与错误计数（DEL codeKey, failKey）。
func (s *RedisCodeStore) DelCode(email string) {
	ctx := context.Background()
	if err := s.client.Del(ctx, s.codeKey(email), s.failKey(email)).Err(); err != nil {
		s.warnf("[vcode] redis DEL code/fail failed for %s: %v", email, err)
	}
}

// AcquireCooldown 抢占重发冷却窗口（SET cdKey "1" NX EX ttl）：抢占成功返回 true，窗口占用中返回 false。
// ttl<=0 视为不限频，恒返回 true；Redis 出错时返回 true（故障安全，不阻塞发送）。
func (s *RedisCodeStore) AcquireCooldown(email string, ttl time.Duration) bool {
	if ttl <= 0 {
		return true
	}
	ctx := context.Background()
	ok, err := s.client.SetNX(ctx, s.cooldownKey(email), "1", ttl).Result()
	if err != nil {
		// 故障安全：冷却判定失败时放行发送，避免 Redis 抖动卡住用户重发。
		s.warnf("[vcode] redis SETNX cooldown failed for %s: %v", email, err)
		return true
	}
	return ok
}

// ReleaseCooldown 释放冷却窗口（DEL cdKey），发送失败时调用以允许立即重试。
func (s *RedisCodeStore) ReleaseCooldown(email string) {
	ctx := context.Background()
	if err := s.client.Del(ctx, s.cooldownKey(email)).Err(); err != nil {
		s.warnf("[vcode] redis DEL cooldown failed for %s: %v", email, err)
	}
}

// IncrFail 记录一次校验失败并返回累计次数（INCR failKey；首次即 ==1 时 EXPIRE failKey ttl）。
// Redis 出错时返回 0（故障安全，不误判达到失败上限）。
func (s *RedisCodeStore) IncrFail(email string, ttl time.Duration) int {
	ctx := context.Background()
	key := s.failKey(email)
	count, err := s.client.Incr(ctx, key).Result()
	if err != nil {
		s.warnf("[vcode] redis INCR fail failed for %s: %v", email, err)
		return 0
	}
	if count == 1 {
		if err := s.client.Expire(ctx, key, ttl).Err(); err != nil {
			s.warnf("[vcode] redis EXPIRE fail failed for %s: %v", email, err)
		}
	}
	return int(count)
}

// 编译期断言：Redis 实现满足 CodeStore。
var _ CodeStore = (*RedisCodeStore)(nil)
