package file

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// RedisTicketStore Redis 版直传票据存储（多副本部署用）。
//
// 与 MemoryTicketStore 语义一致，但票据写入 Redis，从而在多实例间共享：
// 任一实例 presign 申请的票据，另一实例 register 时可读到并校验、作废。
//
// key 由调用方拼好（已带 presign: 前缀），这里原样透传给 Redis：
//   - Set    → SET key value EX ttl
//   - Get    → GET key（不存在/已过期返回 ("", false)）
//   - Delete → DEL key
//
// 故障安全：所有方法在 Redis 出错时降级为「无票据」语义而非 panic。
// Get 出错返回 ("", false)（让 register 走票据缺失分支，最坏是放行/拒绝由上层判定，不致崩溃）；
// Set/Delete 出错仅记日志。logger 可为 nil（不打日志）。
type RedisTicketStore struct {
	client *redis.Client
	logger *logrus.Logger
}

// 编译期断言：确保实现了 TicketStore 接口。
var _ TicketStore = (*RedisTicketStore)(nil)

// NewRedisTicketStore 构造 Redis 票据存储。
// client 由 router 注入（通常来自 redisx.New 的共享 *redis.Client）；
// logger 可选，传 nil 则降级时不打日志。
func NewRedisTicketStore(client *redis.Client) *RedisTicketStore {
	return &RedisTicketStore{client: client}
}

// WithLogger 注入日志器用于降级告警，返回自身便于链式调用；logger 为 nil 安全。
func (s *RedisTicketStore) WithLogger(logger *logrus.Logger) *RedisTicketStore {
	s.logger = logger
	return s
}

// Set 写入票据：SET key value EX ttl。出错仅记日志（票据缺失只影响一次直传闭环，不阻塞主流程）。
func (s *RedisTicketStore) Set(key, value string, ttl time.Duration) {
	if err := s.client.Set(context.Background(), key, value, ttl).Err(); err != nil {
		s.warn("set", key, err)
	}
}

// Get 读取票据：GET key。不存在或 Redis 出错均返回 ("", false)（故障安全降级）。
func (s *RedisTicketStore) Get(key string) (string, bool) {
	value, err := s.client.Get(context.Background(), key).Result()
	if err != nil {
		// redis.Nil 表示键不存在（含已过期），属正常路径，不告警。
		if err != redis.Nil {
			s.warn("get", key, err)
		}
		return "", false
	}
	return value, true
}

// Delete 删除票据：DEL key。出错仅记日志（防重复登记是尽力而为）。
func (s *RedisTicketStore) Delete(key string) {
	if err := s.client.Del(context.Background(), key).Err(); err != nil {
		s.warn("del", key, err)
	}
}

// warn 降级告警（logger 为 nil 时静默）。
func (s *RedisTicketStore) warn(op, key string, err error) {
	if s.logger == nil {
		return
	}
	s.logger.WithFields(logrus.Fields{
		"op":  op,
		"key": key,
		"err": err,
	}).Warn("[file] Redis 票据存储降级")
}
