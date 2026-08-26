// Package config loads application configuration in three layers, later layers
// overriding earlier ones:
//
//  1. configs/config.yaml           — shared base (local/test defaults)
//  2. configs/config.<env>.yaml     — per-environment overlay, selected by
//     TIDECANVAS_ENV (test | prod, default "test"); missing overlay is fine
//  3. environment variables         — TIDECANVAS_ prefix, dots -> underscores,
//     e.g. TIDECANVAS_SERVER_PORT, TIDECANVAS_JWT_SECRET, TIDECANVAS_REDIS_ADDR
package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Environment names selectable via TIDECANVAS_ENV.
const (
	EnvTest          = "test"
	EnvProd          = "prod"
	testRelayBaseURL = "https://test-relay.tcmzhan.com"
	prodRelayBaseURL = "https://relay.tcmzhan.com"
)

// Config is the root configuration.
type Config struct {
	// Env is the running environment ("test" or "prod"), resolved from
	// TIDECANVAS_ENV at load time; it is not read from the yaml files.
	Env string `mapstructure:"-"`

	Server     ServerConfig     `mapstructure:"server"`
	MySQL      MySQLConfig      `mapstructure:"mysql"`
	Redis      RedisConfig      `mapstructure:"redis"`
	JWT        JWTConfig        `mapstructure:"jwt"`
	Storage    StorageConfig    `mapstructure:"storage"`
	CORS       CORSConfig       `mapstructure:"cors"`
	Email      EmailConfig      `mapstructure:"email"`
	LLM        LLMConfig        `mapstructure:"llm"`
	Relay      RelayConfig      `mapstructure:"relay"`
	WorldLabs  WorldLabsConfig  `mapstructure:"worldLabs"`
	Eliandapay EliandapayConfig `mapstructure:"eliandapay"`
	// BalanceMonitor contains the supplier endpoints and DLAPI deployment
	// credential. The four JWT-backed supplier credentials are stored in
	// sys_config and overlaid by the admin balance monitor at request time.
	BalanceMonitor BalanceMonitorConfig `mapstructure:"balanceMonitor"`
}

// BalanceMonitorConfig groups the upstream accounts shown on the admin
// supplier-balance dashboard. Each supplier keeps its own typed configuration
// because authentication and response formats differ between vendors.
type BalanceMonitorConfig struct {
	RefreshSeconds int                        `mapstructure:"refreshSeconds"`
	DLAPI          NewAPIBalanceConfig        `mapstructure:"dlapi"`
	Mikoto         BearerProfileBalanceConfig `mapstructure:"mikoto"`
	CCGO           BearerProfileBalanceConfig `mapstructure:"ccgo"`
	CCGO2          BearerProfileBalanceConfig `mapstructure:"ccgo2"`
	Dimensio       DimensioBalanceConfig      `mapstructure:"dimensio"`
}

// NewAPIBalanceConfig configures a New API compatible GET /api/user/self
// account. QuotaPerUnit converts the raw integer quota returned by New API into
// the displayed currency amount (DLAPI currently publishes 500000 units/USD).
type NewAPIBalanceConfig struct {
	Enabled      bool    `mapstructure:"enabled"`
	Name         string  `mapstructure:"name"`
	BaseURL      string  `mapstructure:"baseUrl"`
	UserID       string  `mapstructure:"userId"`
	AccessToken  string  `mapstructure:"accessToken"`
	QuotaPerUnit float64 `mapstructure:"quotaPerUnit"`
	Currency     string  `mapstructure:"currency"`
	LowBalance   float64 `mapstructure:"lowBalance"`
}

// BearerProfileBalanceConfig configures suppliers exposing the common
// GET /api/v1/auth/me profile envelope (currently Mikoto and CCGO). The access
// token is a JWT and is sent as a Bearer credential. UIRequest adds the
// x-user-ui-request header required by CCGO.
type BearerProfileBalanceConfig struct {
	Enabled     bool    `mapstructure:"enabled"`
	Name        string  `mapstructure:"name"`
	BaseURL     string  `mapstructure:"baseUrl"`
	AccessToken string  `mapstructure:"accessToken"`
	Timezone    string  `mapstructure:"timezone"`
	Currency    string  `mapstructure:"currency"`
	LowBalance  float64 `mapstructure:"lowBalance"`
	UIRequest   bool    `mapstructure:"uiRequest"`
}

// MikotoBalanceConfig is kept as a source-compatible name for focused tests
// and any package constructing the original Mikoto configuration directly.
type MikotoBalanceConfig = BearerProfileBalanceConfig

// DimensioBalanceConfig configures GET /api/auth/me. The available credit
// balance is calculated as credit_budget - membership_usage_credits.
type DimensioBalanceConfig struct {
	Enabled     bool    `mapstructure:"enabled"`
	Name        string  `mapstructure:"name"`
	BaseURL     string  `mapstructure:"baseUrl"`
	AccessToken string  `mapstructure:"accessToken"`
	Unit        string  `mapstructure:"unit"`
	LowBalance  float64 `mapstructure:"lowBalance"`
}

// EliandapayConfig holds the 易联达Pay (eliandapay / api.ndow.cn) aggregator
// cashier credentials. When Enabled is false (or MerchantID/MD5Key are blank),
// order creation returns a clear "payment not configured" error instead of an
// unusable checkout URL. NotifyURL must be a PUBLIC https URL the gateway can
// reach; it points at POST/GET /api/billing/notify. Override secrets via
// TIDECANVAS_ELIANDAPAY_MD5KEY / TIDECANVAS_ELIANDAPAY_MERCHANTID in production.
type EliandapayConfig struct {
	Enabled    bool   `mapstructure:"enabled"`
	Gateway    string `mapstructure:"gateway"`    // API base incl. trailing slash, e.g. https://api.ndow.cn/
	MerchantID string `mapstructure:"merchantId"` // 商户ID — the epay `pid`
	MD5Key     string `mapstructure:"md5Key"`     // V1 MD5 密钥
	NotifyURL  string `mapstructure:"notifyUrl"`  // PUBLIC https URL the gateway GETs on payment
	ReturnURL  string `mapstructure:"returnUrl"`  // browser sync-redirect after pay (UX only)
}

// RelayConfig holds the upstream model relay (ScarecrowToken Relay) settings used
// by the admin "刷新" sync: it pulls GET {BaseURL}/v1/models with APIKey as a
// Bearer token and upserts the catalog into market_model. When APIKey is empty
// the sync endpoint returns a clear "relay not configured" error.
type RelayConfig struct {
	BaseURL string `mapstructure:"baseUrl"`
	APIKey  string `mapstructure:"apiKey"`
}

// WorldLabsConfig holds the server-side World Labs Marble API credential and
// polling policy. APIKey must never be exposed to the browser.
type WorldLabsConfig struct {
	BaseURL      string        `mapstructure:"baseUrl"`
	APIKey       string        `mapstructure:"apiKey"`
	PollInterval time.Duration `mapstructure:"pollInterval"`
	Timeout      time.Duration `mapstructure:"timeout"`
}

// LLMConfig holds the chat assistant's prompt/context settings（对话走 relay
// 中转站;直连 Anthropic 的遗留兜底已于 2026-08-01 整链删除,apiKey/baseUrl/
// model/maxTokens 随之移除——relay 未配置时回复退化为占位文案,服务可裸奔）。
type LLMConfig struct {
	SystemPrompt string `mapstructure:"systemPrompt"` // persona/instructions for the assistant
	HistoryLimit int    `mapstructure:"historyLimit"` // recent messages sent as context
	// ContextTokenLimit caps a conversation's cumulative estimated tokens; once
	// reached the chat endpoints reject new text turns and the frontend prompts
	// the user to start a new conversation.
	ContextTokenLimit int `mapstructure:"contextTokenLimit"`
}

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
		params = "charset=utf8mb4&parseTime=True&loc=Local&sql_mode=%27STRICT_TRANS_TABLES%2CNO_ENGINE_SUBSTITUTION%27"
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
	// Prefix is the object-key root inside the bucket, namespacing this project's
	// assets so a shared bucket does not collide across projects (e.g.
	// "canvas/uploads/"). Applied by the OSS strategy to every key.
	Prefix string `mapstructure:"prefix"`
	// CDNDomain, when set, is the base host used to build public asset URLs
	// (e.g. https://cdn.example.com) instead of the regional OSS endpoint.
	CDNDomain string `mapstructure:"cdnDomain"`
	// AccelerateDomain is the OSS Transfer-Acceleration host. When set, the OSS
	// client uses it only when AccelerateEnabled is true. When disabled, storage
	// writes/presigns use the regional endpoint and upstream reads stay on the
	// public CDN host. The configured domain is still recognized for legacy URLs.
	AccelerateDomain  string `mapstructure:"accelerateDomain"`
	AccelerateEnabled bool   `mapstructure:"accelerateEnabled"`
	// LegacyHosts 是历史存储域名（逗号分隔，可含 scheme 也可裸 host）——老数据
	// 里遗留的前任桶/加速域名。配了 CDN 时,响应层把这些 host 上的 URL 也统一
	// 改写为当前 publicBase（对象已按同 key 迁入当前桶的前提）。
	LegacyHosts string `mapstructure:"legacyHosts"`
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

// Load reads configs/config.yaml (searched from a few common locations),
// merges the configs/config.<env>.yaml overlay selected by TIDECANVAS_ENV
// (default "test"), then overlays environment variables. Missing files are
// tolerated as long as defaults / env supply the required values; an invalid
// TIDECANVAS_ENV value is a fatal error to prevent silently running a prod
// deployment on test settings (or vice versa).
func Load() (*Config, error) {
	env, err := resolveEnv()
	if err != nil {
		return nil, err
	}

	v := viper.New()

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath("./configs")
	v.AddConfigPath("../configs")
	v.AddConfigPath("../../configs")
	v.AddConfigPath(".")

	setDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		// A missing config file is acceptable; any other read error is fatal.
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("config: read config file: %w", err)
		}
	}

	// Merge the per-environment overlay (config.test.yaml / config.prod.yaml)
	// on top of the base file. A missing overlay is fine — the base plus env
	// vars may already be complete.
	v.SetConfigName("config." + env)
	if err := v.MergeInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("config: read config.%s.yaml: %w", env, err)
		}
	}

	// Bind env vars after file merging so they always win.
	v.SetEnvPrefix("TIDECANVAS")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("config: unmarshal: %w", err)
	}

	cfg.Env = env
	normalize(&cfg)
	if err := validate(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// validate enforces settings that must never ship to production with test
// defaults. It only runs hard checks in prod so local/test boots stay
// zero-config.
func validate(cfg *Config) error {
	if !cfg.IsProd() {
		return nil
	}
	secret := strings.TrimSpace(cfg.JWT.Secret)
	if secret == "" || secret == "change-me-in-production" {
		return fmt.Errorf("config: prod requires a real JWT secret — set TIDECANVAS_JWT_SECRET or jwt.secret in configs/config.prod.yaml")
	}
	if strings.TrimSpace(cfg.Relay.APIKey) == "" {
		return fmt.Errorf("config: prod requires a relay API key — set TIDECANVAS_RELAY_APIKEY")
	}
	if strings.TrimSpace(cfg.Server.Mode) != "release" {
		cfg.Server.Mode = "release"
	}
	return nil
}

// resolveEnv reads TIDECANVAS_ENV and validates it. Empty means test so that
// local development keeps working with zero setup; anything other than
// test/prod is rejected loudly.
func resolveEnv() (string, error) {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("TIDECANVAS_ENV")))
	switch env {
	case "":
		return EnvTest, nil
	case EnvTest, EnvProd:
		return env, nil
	default:
		return "", fmt.Errorf("config: invalid TIDECANVAS_ENV %q (expected %q or %q)", env, EnvTest, EnvProd)
	}
}

// IsProd reports whether the server is running with the production overlay.
func (c *Config) IsProd() bool { return c.Env == EnvProd }

func setDefaults(v *viper.Viper) {
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.mode", "debug")

	v.SetDefault("mysql.host", "127.0.0.1")
	v.SetDefault("mysql.port", 3306)
	v.SetDefault("mysql.user", "root")
	v.SetDefault("mysql.password", "root")
	v.SetDefault("mysql.database", "tidecanvas")
	v.SetDefault("mysql.params", "charset=utf8mb4&parseTime=True&loc=Local&sql_mode=%27STRICT_TRANS_TABLES%2CNO_ENGINE_SUBSTITUTION%27")
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
	v.SetDefault("storage.accelerateEnabled", true)

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
	v.SetDefault("llm.contextTokenLimit", 32000)
	v.SetDefault("llm.systemPrompt", defaultLLMSystemPrompt)

	// Missing/empty TIDECANVAS_ENV resolves to test, so the safe default must
	// never send local development traffic to the production relay.
	v.SetDefault("relay.baseUrl", testRelayBaseURL)
	v.SetDefault("relay.apiKey", "")
	v.SetDefault("worldLabs.baseUrl", "https://api.worldlabs.ai")
	v.SetDefault("worldLabs.apiKey", "")
	v.SetDefault("worldLabs.pollInterval", "5s")
	v.SetDefault("worldLabs.timeout", "20m")

	// Supplier balance monitor. The access token deliberately has no file
	// default: inject it as TIDECANVAS_BALANCEMONITOR_DLAPI_ACCESSTOKEN.
	v.SetDefault("balanceMonitor.refreshSeconds", 30)
	v.SetDefault("balanceMonitor.dlapi.enabled", true)
	v.SetDefault("balanceMonitor.dlapi.name", "DLAPI")
	v.SetDefault("balanceMonitor.dlapi.baseUrl", "https://api.dlapi.xyz")
	v.SetDefault("balanceMonitor.dlapi.userId", "245")
	v.SetDefault("balanceMonitor.dlapi.accessToken", "")
	v.SetDefault("balanceMonitor.dlapi.quotaPerUnit", 500000)
	v.SetDefault("balanceMonitor.dlapi.currency", "USD")
	v.SetDefault("balanceMonitor.dlapi.lowBalance", 20)
	v.SetDefault("balanceMonitor.mikoto.name", "Mikoto")
	v.SetDefault("balanceMonitor.mikoto.baseUrl", "https://api.mikoto.vip")
	v.SetDefault("balanceMonitor.mikoto.timezone", "Asia/Shanghai")
	v.SetDefault("balanceMonitor.mikoto.currency", "USD")
	v.SetDefault("balanceMonitor.mikoto.uiRequest", false)
	v.SetDefault("balanceMonitor.ccgo.name", "CCGO")
	v.SetDefault("balanceMonitor.ccgo.baseUrl", "https://www.ccgoai.com")
	v.SetDefault("balanceMonitor.ccgo.timezone", "Asia/Shanghai")
	v.SetDefault("balanceMonitor.ccgo.currency", "USD")
	v.SetDefault("balanceMonitor.ccgo.uiRequest", true)
	v.SetDefault("balanceMonitor.ccgo2.name", "CCGO2")
	v.SetDefault("balanceMonitor.ccgo2.baseUrl", "https://www.ccgoai.com")
	v.SetDefault("balanceMonitor.ccgo2.timezone", "Asia/Shanghai")
	v.SetDefault("balanceMonitor.ccgo2.currency", "USD")
	v.SetDefault("balanceMonitor.ccgo2.uiRequest", true)
	v.SetDefault("balanceMonitor.dimensio.name", "Dimensio")
	v.SetDefault("balanceMonitor.dimensio.baseUrl", "https://jimeng.dimensio.cn")
	v.SetDefault("balanceMonitor.dimensio.unit", "积分")

	v.SetDefault("eliandapay.enabled", true)
	v.SetDefault("eliandapay.gateway", "https://api.ndow.cn/")
	v.SetDefault("eliandapay.merchantId", "1052")
	v.SetDefault("eliandapay.md5Key", "AYgauO61qisuGuqOz34cG6parLPdAoYU")
	v.SetDefault("eliandapay.notifyUrl", "http://localhost:8080/api/billing/notify")
	v.SetDefault("eliandapay.returnUrl", "http://localhost:3000/billing?pay_status=success")
}

// defaultLLMSystemPrompt gives the assistant a TideCanvas (流光) persona: a
// creative copilot for brand, design and AIGC ideation. Overridable via
// TIDECANVAS_LLM_SYSTEMPROMPT or configs/config.yaml.
const defaultLLMSystemPrompt = "你是 TideCanvas（流光）创作平台的 AI 创作助手。" +
	"你擅长品牌设计、视觉创意、文案撰写与 AIGC 灵感发散。" +
	"请用简洁、专业且有启发性的中文回答用户，必要时给出可执行的创意方向或步骤。"

func normalize(cfg *Config) {
	// Relay routing is environment-owned, not a free-form deployment override.
	// This prevents a misspelled/leftover variable from sending test traffic to
	// production (or production traffic to the test relay).
	if cfg.IsProd() {
		cfg.Relay.BaseURL = prodRelayBaseURL
	} else {
		cfg.Relay.BaseURL = testRelayBaseURL
	}
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
	cfg.WorldLabs.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.WorldLabs.BaseURL), "/")
	if cfg.WorldLabs.BaseURL == "" {
		cfg.WorldLabs.BaseURL = "https://api.worldlabs.ai"
	}
	if cfg.WorldLabs.PollInterval <= 0 {
		cfg.WorldLabs.PollInterval = 5 * time.Second
	}
	if cfg.WorldLabs.Timeout <= 0 {
		cfg.WorldLabs.Timeout = 20 * time.Minute
	}
	if cfg.BalanceMonitor.RefreshSeconds < 10 {
		cfg.BalanceMonitor.RefreshSeconds = 30
	}
	// Mikoto/CCGO/CCGO2/Dimensio dynamic values are database-owned. Explicitly
	// discard anything decoded from legacy YAML/environment variables so these
	// fields have exactly one runtime source: sys_config in the admin UI.
	cfg.BalanceMonitor.Mikoto.Enabled, cfg.BalanceMonitor.Mikoto.AccessToken, cfg.BalanceMonitor.Mikoto.LowBalance = false, "", 0
	cfg.BalanceMonitor.CCGO.Enabled, cfg.BalanceMonitor.CCGO.AccessToken, cfg.BalanceMonitor.CCGO.LowBalance = false, "", 0
	cfg.BalanceMonitor.CCGO2.Enabled, cfg.BalanceMonitor.CCGO2.AccessToken, cfg.BalanceMonitor.CCGO2.LowBalance = false, "", 0
	cfg.BalanceMonitor.Dimensio.Enabled, cfg.BalanceMonitor.Dimensio.AccessToken, cfg.BalanceMonitor.Dimensio.LowBalance = false, "", 0
	if strings.TrimSpace(cfg.BalanceMonitor.DLAPI.Name) == "" {
		cfg.BalanceMonitor.DLAPI.Name = "DLAPI"
	}
	if cfg.BalanceMonitor.DLAPI.QuotaPerUnit <= 0 {
		cfg.BalanceMonitor.DLAPI.QuotaPerUnit = 500000
	}
	if strings.TrimSpace(cfg.BalanceMonitor.DLAPI.Currency) == "" {
		cfg.BalanceMonitor.DLAPI.Currency = "USD"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.Mikoto.Name) == "" {
		cfg.BalanceMonitor.Mikoto.Name = "Mikoto"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.Mikoto.Timezone) == "" {
		cfg.BalanceMonitor.Mikoto.Timezone = "Asia/Shanghai"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.Mikoto.Currency) == "" {
		cfg.BalanceMonitor.Mikoto.Currency = "USD"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.CCGO.Name) == "" {
		cfg.BalanceMonitor.CCGO.Name = "CCGO"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.CCGO.Timezone) == "" {
		cfg.BalanceMonitor.CCGO.Timezone = "Asia/Shanghai"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.CCGO.Currency) == "" {
		cfg.BalanceMonitor.CCGO.Currency = "USD"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.CCGO2.Name) == "" {
		cfg.BalanceMonitor.CCGO2.Name = "CCGO2"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.CCGO2.Timezone) == "" {
		cfg.BalanceMonitor.CCGO2.Timezone = "Asia/Shanghai"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.CCGO2.Currency) == "" {
		cfg.BalanceMonitor.CCGO2.Currency = "USD"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.Dimensio.Name) == "" {
		cfg.BalanceMonitor.Dimensio.Name = "Dimensio"
	}
	if strings.TrimSpace(cfg.BalanceMonitor.Dimensio.Unit) == "" {
		cfg.BalanceMonitor.Dimensio.Unit = "积分"
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

	if cfg.LLM.HistoryLimit <= 0 {
		cfg.LLM.HistoryLimit = 20
	}
	if cfg.LLM.ContextTokenLimit <= 0 {
		cfg.LLM.ContextTokenLimit = 32000
	}
	if strings.TrimSpace(cfg.LLM.SystemPrompt) == "" {
		cfg.LLM.SystemPrompt = defaultLLMSystemPrompt
	}
}
