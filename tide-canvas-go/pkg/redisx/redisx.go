// Package redisx 构造共享的 Redis 客户端（go-redis v9）。
// 多副本部署时，限流/验证码/直传票据/IM 在线状态与跨实例推送都依赖它做跨进程共享。
package redisx

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
)

// New 按配置构造 *redis.Client 并 Ping 探活。addr 为空时返回 (nil, nil)，调用方据此回退内存实现。
func New(v *viper.Viper, logger *logrus.Logger) (*redis.Client, error) {
	addr := v.GetString("redis.addr")
	if addr == "" {
		return nil, nil
	}
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: v.GetString("redis.password"),
		DB:       v.GetInt("redis.db"),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}
	if logger != nil {
		logger.Infof("[redis] connected: %s (db=%d)", addr, v.GetInt("redis.db"))
	}
	return client, nil
}
