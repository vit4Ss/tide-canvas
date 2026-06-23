// Package config loads application configuration from configs/config.yaml and
// environment variables (env overrides file). Env var names follow the viper
// convention with the TIDECANVAS_ prefix and underscores replacing dots, e.g.
// TIDECANVAS_SERVER_PORT, TIDECANVAS_JWT_SECRET, TIDECANVAS_REDIS_ADDR.
package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config is the root configuration.
type Config struct {
	Server  ServerConfig  `mapstructure:"server"`
	MySQL   MySQLConfig   `mapstructure:"mysql"`
	Redis   RedisConfig   `mapstructure:"redis"`
	JWT     JWTConfig     `mapstructure:"jwt"`
	Storage StorageConfig `mapstructure:"storage"`
	CORS    CORSConfig    `mapstructure:"cors"`
	Email   EmailConfig   `mapstructure:"email"`
	LLM     LLMConfig     `mapstructure:"llm"`
}

// LLMConfig holds the chat large-language-model settings. When APIKey is empty
// the chat service falls back to a canned placeholder reply (no upstream call),
// so the server stays runnable without credentials. Configure via
// TIDECANVAS_LLM_APIKEY / TIDECANVAS_LLM_MODEL / TIDECANVAS_LLM_BASEURL.
type LLMConfig struct {
	APIKey       string `mapstructure:"apiKey"`
	BaseURL      string `mapstructure:"baseUrl"`      // optional; overrides the Anthropic API base
	Model        string `mapstructure:"model"`        // e.g. claude-opus-4-8
	MaxTokens    int    `mapstructure:"maxTokens"`    // response cap
	SystemPrompt string `mapstructure:"systemPrompt"` // persona/instructions for the assistant
	HistoryLimit int    `mapstructure:"historyLimit"` // recent messages sent as context
}

// Enabled reports whether a real LLM is configured (an API key is present).
func (l LLMConfig) Enabled() bool { return strings.TrimSpace(l.APIKey) != "" }

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Port int    `mapstructure:"port"`
	Mode string `mapstructure:"mode"` // gin mode: debug | release | test
}

// MySQLConfig holds database connection settings. If DSN is set it takes
// precedence; otherwise one is assembled from the discrete fields.
type MySQLConfig struct {
	DSN          string `mapstructure:"dsn"`
	Host         string `mapstructure:"host"`
	Port         int    `mapstructure:"port"`
	User         string `mapstructure:"user"`
	Password     string `mapstructure:"password"`
	Database     string `mapstructure:"database"`
	Params       string `mapstructure:"params"`
	MaxOpenConns int    `mapstructure:"maxOpenConns"`
	MaxIdleConns int    `mapstructure:"maxIdleConns"`
	MaxLifetime  int    `mapstructure:"maxLifetime"` // seconds
}

// BuildDSN returns the configured DSN, or assembles one from the discrete
// fields when DSN is empty.
func (m MySQLConfig) BuildDSN() string {
	if strings.TrimSpace(m.DSN) != "" {
		return m.DSN
	}
	params := m.Params
	if params == "" {
		params = "charset=utf8mb4&parseTime=True&loc=Local"
	}
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?%s",
		m.User, m.Password, m.Host, m.Port, m.Database, params)
}

// RedisConfig holds Redis connection settings.
type RedisConfig struct {
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

// JWTConfig holds JWT signing settings. TTLs are expressed as durations
// (e.g. "2h", "168h").
type JWTConfig struct {
	Secret     string        `mapstructure:"secret"`
	AccessTTL  time.Duration `mapstructure:"accessTTL"`
	RefreshTTL time.Duration `mapstructure:"refreshTTL"`
	Issuer     string        `mapstructure:"issuer"`
}

// StorageConfig holds file-storage settings. Type is "local" or "oss".
type StorageConfig struct {
	Type      string `mapstructure:"type"`
	LocalDir  string `mapstructure:"localDir"`  // filesystem root for local storage
	PublicURL string `mapstructure:"publicURL"` // base URL prefix to build public file URLs
	// OSS settings (used when Type == "oss"); kept here so domain code can read
	// them without an extra config type.
	Endpoint  string `mapstructure:"endpoint"`
	Bucket    string `mapstructure:"bucket"`
	AccessKey string `mapstructure:"accessKey"`
	SecretKey string `mapstructure:"secretKey"`
	Region    string `mapstructure:"region"`
}

// CORSConfig holds allowed origins for the browser frontend.
type CORSConfig struct {
	AllowOrigins []string `mapstructure:"allowOrigins"`
}

// EmailConfig holds SMTP settings and verification-code policy (TTL, cooldown,
// attempt limits and per-IP send throttling). When Enabled is false the auth
// service skips real SMTP and falls back to logging the code (dev mode).
type EmailConfig struct {
	Enabled     bool   `mapstructure:"enabled"`
	Host        string `mapstructure:"host"`
	Port        int    `mapstructure:"port"`
	Username    string `mapstructure:"username"`
	Password    string `mapstructure:"password"`
	FromAddress string `mapstructure:"fromAddress"`
	FromName    string `mapstructure:"fromName"`
	ReplyTo     string `mapstructure:"replyTo"` // blank -> falls back to fromAddress
	SSL         bool   `mapstructure:"ssl"`     // 465 -> true
	StartTLS    bool   `mapstructure:"startTLS"`

	CodeLength            int `mapstructure:"codeLength"`
	CodeTTLSeconds        int `mapstructure:"codeTTLSeconds"`
	ResendCooldownSeconds int `mapstructure:"resendCooldownSeconds"`
	MaxAttempts           int `mapstructure:"maxAttempts"`

	SendCodeIPLimit         int `mapstructure:"sendCodeIPLimit"`
	SendCodeIPWindowSeconds int `mapstructure:"sendCodeIPWindowSeconds"`
}

// Load reads configs/config.yaml (searched from a few common locations) and
// overlays environment variables. Missing config file is tolerated as long as
// defaults / env supply the required values.
func Load() (*Config, error) {
	v := viper.New()

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath("./configs")
	v.AddConfigPath("../configs")
	v.AddConfigPath("../../configs")
	v.AddConfigPath(".")

	setDefaults(v)

	v.SetEnvPrefix("TIDECANVAS")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		// A missing config file is acceptable; any other read error is fatal.
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("config: read config file: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("config: unmarshal: %w", err)
	}

	normalize(&cfg)
	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.mode", "debug")

	v.SetDefault("mysql.host", "127.0.0.1")
	v.SetDefault("mysql.port", 3306)
	v.SetDefault("mysql.user", "root")
	v.SetDefault("mysql.password", "root")
	v.SetDefault("mysql.database", "tidecanvas")
	v.SetDefault("mysql.params", "charset=utf8mb4&parseTime=True&loc=Local")
	v.SetDefault("mysql.maxOpenConns", 100)
	v.SetDefault("mysql.maxIdleConns", 10)
	v.SetDefault("mysql.maxLifetime", 3600)

	v.SetDefault("redis.addr", "127.0.0.1:6379")
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)

	v.SetDefault("jwt.secret", "change-me-in-production")
	v.SetDefault("jwt.accessTTL", "2h")
	v.SetDefault("jwt.refreshTTL", "168h")
	v.SetDefault("jwt.issuer", "tidecanvas")

	v.SetDefault("storage.type", "local")
	v.SetDefault("storage.localDir", "./data/uploads")
	v.SetDefault("storage.publicURL", "http://localhost:8080/static")

	v.SetDefault("cors.allowOrigins", []string{"http://localhost:3000"})

	v.SetDefault("email.enabled", true)
	v.SetDefault("email.host", "smtp.gmail.com")
	v.SetDefault("email.port", 587)
	v.SetDefault("email.username", "ad@tcmzhan.com")
	v.SetDefault("email.password", "jpwhhpqtekgsnlsf")
	v.SetDefault("email.fromAddress", "ad@tcmzhan.com")
	v.SetDefault("email.fromName", "ScarecrowToken")
	v.SetDefault("email.replyTo", "")
	v.SetDefault("email.ssl", false)
	v.SetDefault("email.startTLS", true)
	v.SetDefault("email.codeLength", 6)
	v.SetDefault("email.codeTTLSeconds", 600)
	v.SetDefault("email.resendCooldownSeconds", 60)
	v.SetDefault("email.maxAttempts", 5)
	v.SetDefault("email.sendCodeIPLimit", 10)
	v.SetDefault("email.sendCodeIPWindowSeconds", 600)

	v.SetDefault("llm.apiKey", "")
	v.SetDefault("llm.baseUrl", "")
	v.SetDefault("llm.model", "claude-opus-4-8")
	v.SetDefault("llm.maxTokens", 2048)
	v.SetDefault("llm.historyLimit", 20)
	v.SetDefault("llm.systemPrompt", defaultLLMSystemPrompt)
}

// defaultLLMSystemPrompt gives the assistant a TideCanvas (流光) persona: a
// creative copilot for brand, design and AIGC ideation. Overridable via
// TIDECANVAS_LLM_SYSTEMPROMPT or configs/config.yaml.
const defaultLLMSystemPrompt = "你是 TideCanvas（流光）创作平台的 AI 创作助手。" +
	"你擅长品牌设计、视觉创意、文案撰写与 AIGC 灵感发散。" +
	"请用简洁、专业且有启发性的中文回答用户，必要时给出可执行的创意方向或步骤。"

func normalize(cfg *Config) {
	if cfg.JWT.AccessTTL <= 0 {
		cfg.JWT.AccessTTL = 2 * time.Hour
	}
	if cfg.JWT.RefreshTTL <= 0 {
		cfg.JWT.RefreshTTL = 7 * 24 * time.Hour
	}
	if cfg.JWT.Issuer == "" {
		cfg.JWT.Issuer = "tidecanvas"
	}
	if len(cfg.CORS.AllowOrigins) == 0 {
		cfg.CORS.AllowOrigins = []string{"http://localhost:3000"}
	}
	if cfg.Storage.Type == "" {
		cfg.Storage.Type = "local"
	}

	// Email policy guards: fall back to sane defaults when values are missing or
	// non-positive so throttling/codes never end up degenerate.
	if cfg.Email.CodeLength <= 0 {
		cfg.Email.CodeLength = 6
	}
	if cfg.Email.CodeTTLSeconds <= 0 {
		cfg.Email.CodeTTLSeconds = 600
	}
	if cfg.Email.ResendCooldownSeconds <= 0 {
		cfg.Email.ResendCooldownSeconds = 60
	}
	if cfg.Email.MaxAttempts <= 0 {
		cfg.Email.MaxAttempts = 5
	}
	if cfg.Email.SendCodeIPLimit <= 0 {
		cfg.Email.SendCodeIPLimit = 10
	}
	if cfg.Email.SendCodeIPWindowSeconds <= 0 {
		cfg.Email.SendCodeIPWindowSeconds = 600
	}
	if strings.TrimSpace(cfg.Email.ReplyTo) == "" {
		cfg.Email.ReplyTo = cfg.Email.FromAddress
	}

	if strings.TrimSpace(cfg.LLM.Model) == "" {
		cfg.LLM.Model = "claude-opus-4-8"
	}
	if cfg.LLM.MaxTokens <= 0 {
		cfg.LLM.MaxTokens = 2048
	}
	if cfg.LLM.HistoryLimit <= 0 {
		cfg.LLM.HistoryLimit = 20
	}
	if strings.TrimSpace(cfg.LLM.SystemPrompt) == "" {
		cfg.LLM.SystemPrompt = defaultLLMSystemPrompt
	}
}
