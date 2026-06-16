// Package config 统一配置加载：.env 文件 → 环境变量 → config.yaml(可选) → 默认值。
//
// 环境变量按 viper 嵌套 key 的「大写下划线」形式映射（. → _），例如：
//
//	server.port            → SERVER_PORT
//	db.password            → DB_PASSWORD
//	mail.host              → MAIL_HOST
//	storage.oss.bucket     → STORAGE_OSS_BUCKET
//	cors.allowed_origins   → CORS_ALLOWED_ORIGINS（逗号分隔）
//	oauth.github.client_id → OAUTH_GITHUB_CLIENT_ID
//	log.level              → LOG_LEVEL
//
// 优先级：系统环境变量 > .env > config.yaml > 内置默认值。
package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

// Load 读取配置并返回 viper 实例（供 main 与各模块共享）。
func Load() *viper.Viper {
	// .env → 进程环境变量（文件不存在则忽略；不覆盖已存在的系统环境变量）。
	_ = godotenv.Load()

	v := viper.New()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	setDefaults(v)

	// 可选 config.yaml（基础值；环境变量优先级更高，会覆盖它）。
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath("configs")
	v.AddConfigPath(".")
	_ = v.ReadInConfig()

	// db.dsn：未显式提供 DB_DSN / db.dsn 时，用分字段拼接（DB_HOST/PORT/USER/PASSWORD/NAME）。
	if strings.TrimSpace(v.GetString("db.dsn")) == "" {
		v.Set("db.dsn", buildDSN(v))
	}

	// 逗号分隔的环境变量 → 字符串数组（viper AutomaticEnv 不会自动拆数组）。
	bindCSV(v, "storage.allowed_types", "STORAGE_ALLOWED_TYPES")
	bindCSV(v, "cors.allowed_origins", "CORS_ALLOWED_ORIGINS")

	return v
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("debug", false)

	v.SetDefault("server.port", "8080")
	v.SetDefault("snowflake.node_id", 1)

	v.SetDefault("db.host", "127.0.0.1")
	v.SetDefault("db.port", "3306")
	v.SetDefault("db.user", "root")
	v.SetDefault("db.name", "tide_canvas")
	v.SetDefault("db.max_idle_conns", 10)
	v.SetDefault("db.max_open_conns", 100)

	v.SetDefault("jwt.access_ttl", 7200)
	v.SetDefault("jwt.refresh_ttl", 604800)

	v.SetDefault("redis.addr", "127.0.0.1:6379")
	v.SetDefault("redis.db", 0)

	v.SetDefault("mail.enabled", false)
	v.SetDefault("mail.from_name", "TideCanvas")
	v.SetDefault("mail.code_ttl_seconds", 600)

	v.SetDefault("storage.kind", "local")
	v.SetDefault("storage.local_dir", "./uploads")
	v.SetDefault("storage.max_size", 52428800)

	v.SetDefault("cors.allowed_origins", []string{"http://localhost:3000"})
	v.SetDefault("cors.allow_credentials", true)

	// 日志
	v.SetDefault("log.level", "info")    // debug|info|warn|error
	v.SetDefault("log.format", "text")   // text|json
	v.SetDefault("log.output", "stdout") // stdout|file|both
	v.SetDefault("log.file", "./logs/app.log")
	v.SetDefault("log.max_size", 100) // MB
	v.SetDefault("log.max_backups", 7)
	v.SetDefault("log.max_age", 30) // 天
	v.SetDefault("log.compress", true)
}

// buildDSN 用分字段拼接 GORM MySQL DSN。
// 密码含 @ 或 : 时请改用完整的 DB_DSN，避免 DSN 解析歧义。
func buildDSN(v *viper.Viper) string {
	return fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Asia%%2FShanghai",
		v.GetString("db.user"),
		v.GetString("db.password"),
		v.GetString("db.host"),
		v.GetString("db.port"),
		v.GetString("db.name"),
	)
}

// bindCSV 把逗号分隔的环境变量切成字符串数组写入 viper（最高优先级）。
func bindCSV(v *viper.Viper, key, env string) {
	raw := strings.TrimSpace(os.Getenv(env))
	if raw == "" {
		return
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	v.Set(key, out)
}
