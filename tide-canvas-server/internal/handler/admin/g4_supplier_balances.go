package admin

// g4_supplier_balances.go — 后台「供应商余额」实时查询。
//
// 浏览器只调用本服务的 /api/admin/supplier-balances；供应商凭证始终留在
// 服务端配置中。每个供应商实现一个 checker，查询并发执行，单个上游失败不会
// 让整个页面失败。进程内保留最近一次成功值，短暂故障时可展示带 stale 标记的
// 旧余额和最后成功时间（不落库，重启后自然清空）。
//
// Mikoto/CCGO/CCGO2/Dimensio 支持配置账号密码：监控器自行调用供应商登录接口
// 换取会话 JWT，缓存到过期前自动续期，令牌被上游提前吊销时按 401 重登一次。
// DLAPI/Uniart/wxart（New API 形态面板）同样支持账号密码：走 POST
// /api/user/login 换会话 Cookie（wxart 的 x deal 控制台只认 Cookie 会话，
// 账号密码是唯一可行集成方式），New-Api-User 直接取登录响应里的用户 id。
// 登录失败会按错误类型退避，避免密码错误时每次刷新都撞登录接口锁账号。

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/alerting"
	"tidecanvas/internal/pkg/response"
)

const supplierBalanceTimeout = 10 * time.Second

// SupplierBalanceDetailVO is a provider-specific secondary amount such as
// cumulative usage, frozen balance, or cumulative recharge.
type SupplierBalanceDetailVO struct {
	Label    string  `json:"label"`
	Value    float64 `json:"value"`
	Currency string  `json:"currency"`
}

// SupplierBalanceVO is one supplier row on the admin dashboard. Balance is nil
// until the first successful query. State is one of healthy, low, error,
// unconfigured, or disabled.
type SupplierBalanceVO struct {
	Key           string                    `json:"key"`
	Name          string                    `json:"name"`
	Source        string                    `json:"source"`
	State         string                    `json:"state"`
	Balance       *float64                  `json:"balance"`
	Currency      string                    `json:"currency"`
	LowBalance    *float64                  `json:"lowBalance"`
	Details       []SupplierBalanceDetailVO `json:"details"`
	CheckedAt     string                    `json:"checkedAt"`
	LastSuccessAt string                    `json:"lastSuccessAt"`
	LatencyMs     int64                     `json:"latencyMs"`
	Stale         bool                      `json:"stale"`
	Message       string                    `json:"message"`
}

// SupplierBalancesVO is the complete dashboard snapshot.
type SupplierBalancesVO struct {
	Suppliers      []SupplierBalanceVO `json:"suppliers"`
	RefreshedAt    string              `json:"refreshedAt"`
	RefreshSeconds int                 `json:"refreshSeconds"`
}

type supplierBalanceReading struct {
	Balance  float64
	Currency string
	Details  []SupplierBalanceDetailVO
}

type supplierBalanceChecker interface {
	key() string
	name() string
	source() string
	cacheIdentity() [sha256.Size]byte
	lowBalance() float64
	configurationIssue() (state, message string)
	read(context.Context, *http.Client) (supplierBalanceReading, error)
}

type supplierLastSuccess struct {
	Reading  supplierBalanceReading
	Identity [sha256.Size]byte
	At       time.Time
}

type supplierBalanceMonitor struct {
	db             *gorm.DB
	baseConfig     config.BalanceMonitorConfig
	client         *http.Client
	refreshSeconds int
	alerts         *alerting.Service
	tokens         *supplierTokenCache

	mu   sync.RWMutex
	last map[string]supplierLastSuccess
}

// supplierTokenCache holds the session JWTs the monitor obtained by logging in
// with configured supplier accounts. Entries are keyed by provider and carry
// the credential identity, so rotating the account in 配置管理 discards the
// cached session immediately. Failed logins are cached too (with a deadline)
// so a wrong password cannot hammer the supplier's login endpoint every
// refresh tick.
type supplierTokenCache struct {
	mu      sync.Mutex
	entries map[string]*supplierTokenEntry
}

type supplierTokenEntry struct {
	// mu serializes login attempts for one provider so concurrent snapshots
	// (dashboard request + background alert loop) reuse a single session.
	mu          sync.Mutex
	identity    [sha256.Size]byte
	token       string
	expiresAt   time.Time
	failedUntil time.Time
	failMessage string
}

func newSupplierTokenCache() *supplierTokenCache {
	return &supplierTokenCache{entries: make(map[string]*supplierTokenEntry)}
}

func (c *supplierTokenCache) entry(key string) *supplierTokenEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok {
		e = &supplierTokenEntry{}
		c.entries[key] = e
	}
	return e
}

// supplierLoginResult is what a provider-specific login call returns on
// success. CredentialRejected marks failures that will not heal on their own
// (wrong password, 2FA enabled) and therefore back off longer.
type supplierLoginResult struct {
	Token     string
	ExpiresAt time.Time
}

type supplierLoginError struct {
	message            string
	credentialRejected bool
}

func (e *supplierLoginError) Error() string { return e.message }

const (
	supplierLoginRetryBackoff      = time.Minute
	supplierLoginCredentialBackoff = 10 * time.Minute
)

// acquireSupplierLoginToken returns a cached session token or performs one
// login. rejectedToken names a cached token the profile endpoint just refused
// with 401/403 despite not being expired yet: it is discarded only when still
// cached, so a concurrent snapshot that already renewed the session is reused
// instead of triggering a second login.
func acquireSupplierLoginToken(ctx context.Context, entry *supplierTokenEntry, identity [sha256.Size]byte, rejectedToken string, login func(context.Context) (supplierLoginResult, error)) (string, error) {
	entry.mu.Lock()
	defer entry.mu.Unlock()

	now := time.Now()
	if entry.identity != identity {
		// Field-by-field reset: assigning a whole struct would clobber the
		// mutex this goroutine is holding.
		entry.identity = identity
		entry.token = ""
		entry.expiresAt = time.Time{}
		entry.failedUntil = time.Time{}
		entry.failMessage = ""
	}
	if rejectedToken != "" && entry.token == rejectedToken {
		entry.token = ""
	}
	if entry.token != "" && now.Before(entry.expiresAt) {
		return entry.token, nil
	}
	if entry.failMessage != "" && now.Before(entry.failedUntil) {
		return "", errors.New(entry.failMessage)
	}

	result, err := login(ctx)
	if err != nil {
		entry.token = ""
		entry.failMessage = err.Error()
		backoff := supplierLoginRetryBackoff
		var loginErr *supplierLoginError
		if errors.As(err, &loginErr) && loginErr.credentialRejected {
			backoff = supplierLoginCredentialBackoff
		}
		entry.failedUntil = time.Now().Add(backoff)
		return "", err
	}
	entry.token = result.Token
	entry.expiresAt = result.ExpiresAt
	entry.failMessage = ""
	entry.failedUntil = time.Time{}
	return result.Token, nil
}

// supplierSessionExpiry derives when a fresh session token should be renewed:
// the supplier-declared lifetime when present, otherwise the JWT exp claim,
// otherwise a conservative 10 minutes. A safety margin keeps the monitor from
// using a token during its final seconds.
func supplierSessionExpiry(now time.Time, expiresInSeconds float64, token string) time.Time {
	var exp time.Time
	switch {
	case expiresInSeconds > 0:
		exp = now.Add(time.Duration(expiresInSeconds * float64(time.Second)))
	default:
		claim, ok := decodeJWTExpiry(token)
		if !ok {
			return now.Add(10 * time.Minute)
		}
		exp = claim
	}
	const margin = time.Minute
	if exp.After(now.Add(2 * margin)) {
		return exp.Add(-margin)
	}
	if exp.After(now) {
		return now.Add(exp.Sub(now) / 2)
	}
	return now
}

// decodeJWTExpiry extracts the exp claim without verifying the signature —
// the monitor only needs a renewal hint, authenticity is the supplier's job.
func decodeJWTExpiry(token string) (time.Time, bool) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return time.Time{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return time.Time{}, false
	}
	var claims struct {
		Exp float64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Exp <= 0 {
		return time.Time{}, false
	}
	return time.Unix(int64(claims.Exp), 0), true
}

// decodeSupplierLoginFailure turns a non-2xx login response into a typed
// error, reading the shared {code,message} envelope when present.
func decodeSupplierLoginFailure(resp *http.Response) error {
	var envelope struct {
		Message string `json:"message"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&envelope)
	message := compactUpstreamMessage(envelope.Message)
	if message == "" {
		message = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return &supplierLoginError{message: "登录失败：账号或密码被拒绝（" + message + "）", credentialRejected: true}
	case resp.StatusCode == http.StatusTooManyRequests:
		// 登录接口被限流：必须走长退避等窗口重置——1 分钟一次的常规重试
		// 会把限流窗口不断续期，永远恢复不了。
		return &supplierLoginError{message: "登录失败：登录接口被限流，已暂停重试等待恢复（" + message + "）", credentialRejected: true}
	}
	return &supplierLoginError{message: "登录失败：" + message}
}

func newSupplierBalanceMonitor(db *gorm.DB, cfg config.BalanceMonitorConfig) *supplierBalanceMonitor {
	return newSupplierBalanceMonitorWithDBAndClient(db, cfg, &http.Client{Timeout: supplierBalanceTimeout + 2*time.Second})
}

func newSupplierBalanceMonitorWithClient(cfg config.BalanceMonitorConfig, client *http.Client) *supplierBalanceMonitor {
	return newSupplierBalanceMonitorWithDBAndClient(nil, cfg, client)
}

func newSupplierBalanceMonitorWithDBAndClient(db *gorm.DB, cfg config.BalanceMonitorConfig, client *http.Client) *supplierBalanceMonitor {
	refreshSeconds := cfg.RefreshSeconds
	if refreshSeconds < 10 {
		refreshSeconds = 30
	}
	return &supplierBalanceMonitor{
		db:             db,
		baseConfig:     cfg,
		client:         client,
		refreshSeconds: refreshSeconds,
		tokens:         newSupplierTokenCache(),
		last:           make(map[string]supplierLastSuccess),
	}
}

func (m *supplierBalanceMonitor) snapshot(ctx context.Context) SupplierBalancesVO {
	checkers, configErr := m.currentCheckers()
	rows := make([]SupplierBalanceVO, len(checkers))
	var wg sync.WaitGroup
	for i := range checkers {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			rows[index] = m.check(ctx, checkers[index])
		}(i)
	}
	wg.Wait()
	if configErr != nil {
		// Every supplier's credentials are database-owned, so none of the
		// readings can be trusted when the configuration failed to load.
		for i := range rows {
			rows[i].State = "error"
			rows[i].Balance = nil
			rows[i].LowBalance = nil
			rows[i].Details = []SupplierBalanceDetailVO{}
			rows[i].CheckedAt = ""
			rows[i].LastSuccessAt = ""
			rows[i].LatencyMs = 0
			rows[i].Stale = false
			rows[i].Message = "无法读取监控配置"
		}
	}

	return SupplierBalancesVO{
		Suppliers:      rows,
		RefreshedAt:    time.Now().UTC().Format(time.RFC3339),
		RefreshSeconds: m.refreshSeconds,
	}
}

func (m *supplierBalanceMonitor) currentCheckers() ([]supplierBalanceChecker, error) {
	cfg := m.baseConfig
	var err error
	if m.db != nil {
		cfg, err = loadLiveSupplierBalanceConfig(m.db, cfg)
	}
	return []supplierBalanceChecker{
		&newAPIBalanceChecker{providerKey: "dlapi", cfg: cfg.DLAPI, tokens: m.tokens},
		&balanceProfileChecker{providerKey: "mikoto", cfg: cfg.Mikoto, tokens: m.tokens},
		&balanceProfileChecker{providerKey: "ccgo", cfg: cfg.CCGO, tokens: m.tokens},
		&balanceProfileChecker{providerKey: "ccgo2", cfg: cfg.CCGO2, tokens: m.tokens},
		&dimensioBalanceChecker{providerKey: "dimensio", cfg: cfg.Dimensio, tokens: m.tokens},
		&newAPIBalanceChecker{providerKey: "uniart", cfg: cfg.Uniart, tokens: m.tokens},
		&newAPIBalanceChecker{providerKey: "wxart", cfg: cfg.Wxart, tokens: m.tokens},
		&balanceProfileChecker{providerKey: "secureskill", cfg: cfg.SecureSkill, tokens: m.tokens},
	}, err
}

// loadLiveSupplierBalanceConfig overlays the database-owned suppliers from
// sys_config for every snapshot. A blank stored credential intentionally
// clears any legacy environment value. Only endpoint shape (base URL, quota
// conversion, currency) stays on the deployment configuration.
func loadLiveSupplierBalanceConfig(db *gorm.DB, cfg config.BalanceMonitorConfig) (config.BalanceMonitorConfig, error) {
	// These values have a single source of truth: sys_config. Clear any values
	// Viper may have accepted from legacy environment variables before reading
	// the database, so missing rows or a transient DB error can never revive an
	// old credential behind the administrator's back.
	cfg.DLAPI.Enabled, cfg.DLAPI.AccessToken, cfg.DLAPI.LowBalance = false, "", 0
	cfg.DLAPI.UserID = ""
	cfg.DLAPI.Username, cfg.DLAPI.Password = "", ""
	cfg.Mikoto.Enabled, cfg.Mikoto.AccessToken, cfg.Mikoto.LowBalance = false, "", 0
	cfg.Mikoto.Email, cfg.Mikoto.Password = "", ""
	cfg.CCGO.Enabled, cfg.CCGO.AccessToken, cfg.CCGO.LowBalance = false, "", 0
	cfg.CCGO.Email, cfg.CCGO.Password = "", ""
	cfg.CCGO2.Enabled, cfg.CCGO2.AccessToken, cfg.CCGO2.LowBalance = false, "", 0
	cfg.CCGO2.Email, cfg.CCGO2.Password = "", ""
	cfg.Dimensio.Enabled, cfg.Dimensio.AccessToken, cfg.Dimensio.LowBalance = false, "", 0
	cfg.Dimensio.Username, cfg.Dimensio.Password = "", ""
	cfg.Uniart.Enabled, cfg.Uniart.AccessToken, cfg.Uniart.LowBalance = false, "", 0
	cfg.Uniart.UserID = ""
	cfg.Uniart.Username, cfg.Uniart.Password = "", ""
	cfg.Wxart.Enabled, cfg.Wxart.AccessToken, cfg.Wxart.LowBalance = false, "", 0
	cfg.Wxart.UserID = ""
	cfg.Wxart.Username, cfg.Wxart.Password = "", ""
	cfg.SecureSkill.Enabled, cfg.SecureSkill.AccessToken, cfg.SecureSkill.LowBalance = false, "", 0
	cfg.SecureSkill.Email, cfg.SecureSkill.Password = "", ""

	var rows []model.SysConfig
	if err := db.Where("config_key IN ?", model.SupplierBalanceConfigKeys).Find(&rows).Error; err != nil {
		return cfg, err
	}
	values := make(map[string]string, len(rows))
	for i := range rows {
		values[rows[i].ConfigKey] = rows[i].ConfigValue
	}

	if value, ok := values[model.ConfigKeyBalanceDLAPIEnabled]; ok {
		cfg.DLAPI.Enabled = parseSupplierBalanceEnabled(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDLAPIUserID]; ok {
		cfg.DLAPI.UserID = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDLAPIUsername]; ok {
		cfg.DLAPI.Username = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDLAPIPassword]; ok {
		cfg.DLAPI.Password = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDLAPIAccessToken]; ok {
		cfg.DLAPI.AccessToken = strings.TrimSpace(value)
	}
	if value, ok := parseSupplierBalanceThreshold(values, model.ConfigKeyBalanceDLAPILowBalance); ok {
		cfg.DLAPI.LowBalance = value
	}
	overlayProfileBalanceConfig(values, profileBalanceConfigKeys{
		enabled: model.ConfigKeyBalanceMikotoEnabled, email: model.ConfigKeyBalanceMikotoEmail, password: model.ConfigKeyBalanceMikotoPassword,
		token: model.ConfigKeyBalanceMikotoAccessToken, threshold: model.ConfigKeyBalanceMikotoLowBalance,
	}, &cfg.Mikoto)
	overlayProfileBalanceConfig(values, profileBalanceConfigKeys{
		enabled: model.ConfigKeyBalanceCCGOEnabled, email: model.ConfigKeyBalanceCCGOEmail, password: model.ConfigKeyBalanceCCGOPassword,
		token: model.ConfigKeyBalanceCCGOAccessToken, threshold: model.ConfigKeyBalanceCCGOLowBalance,
	}, &cfg.CCGO)
	overlayProfileBalanceConfig(values, profileBalanceConfigKeys{
		enabled: model.ConfigKeyBalanceCCGO2Enabled, email: model.ConfigKeyBalanceCCGO2Email, password: model.ConfigKeyBalanceCCGO2Password,
		token: model.ConfigKeyBalanceCCGO2AccessToken, threshold: model.ConfigKeyBalanceCCGO2LowBalance,
	}, &cfg.CCGO2)
	overlayProfileBalanceConfig(values, profileBalanceConfigKeys{
		enabled: model.ConfigKeyBalanceSecureSkillEnabled, email: model.ConfigKeyBalanceSecureSkillEmail, password: model.ConfigKeyBalanceSecureSkillPassword,
		token: model.ConfigKeyBalanceSecureSkillAccessToken, threshold: model.ConfigKeyBalanceSecureSkillLowBalance,
	}, &cfg.SecureSkill)
	if value, ok := values[model.ConfigKeyBalanceDimensioEnabled]; ok {
		cfg.Dimensio.Enabled = parseSupplierBalanceEnabled(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDimensioUsername]; ok {
		cfg.Dimensio.Username = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDimensioPassword]; ok {
		cfg.Dimensio.Password = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDimensioAccessToken]; ok {
		cfg.Dimensio.AccessToken = strings.TrimSpace(value)
	}
	if value, ok := parseSupplierBalanceThreshold(values, model.ConfigKeyBalanceDimensioLowBalance); ok {
		cfg.Dimensio.LowBalance = value
	}
	if value, ok := values[model.ConfigKeyBalanceUniartEnabled]; ok {
		cfg.Uniart.Enabled = parseSupplierBalanceEnabled(value)
	}
	if value, ok := values[model.ConfigKeyBalanceUniartUserID]; ok {
		cfg.Uniart.UserID = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceUniartUsername]; ok {
		cfg.Uniart.Username = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceUniartPassword]; ok {
		cfg.Uniart.Password = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceUniartAccessToken]; ok {
		cfg.Uniart.AccessToken = strings.TrimSpace(value)
	}
	if value, ok := parseSupplierBalanceThreshold(values, model.ConfigKeyBalanceUniartLowBalance); ok {
		cfg.Uniart.LowBalance = value
	}
	if value, ok := values[model.ConfigKeyBalanceWxartEnabled]; ok {
		cfg.Wxart.Enabled = parseSupplierBalanceEnabled(value)
	}
	if value, ok := values[model.ConfigKeyBalanceWxartUserID]; ok {
		cfg.Wxart.UserID = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceWxartUsername]; ok {
		cfg.Wxart.Username = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceWxartPassword]; ok {
		cfg.Wxart.Password = strings.TrimSpace(value)
	}
	if value, ok := values[model.ConfigKeyBalanceWxartAccessToken]; ok {
		cfg.Wxart.AccessToken = strings.TrimSpace(value)
	}
	if value, ok := parseSupplierBalanceThreshold(values, model.ConfigKeyBalanceWxartLowBalance); ok {
		cfg.Wxart.LowBalance = value
	}
	return cfg, nil
}

type profileBalanceConfigKeys struct {
	enabled, email, password, token, threshold string
}

func overlayProfileBalanceConfig(values map[string]string, keys profileBalanceConfigKeys, cfg *config.BearerProfileBalanceConfig) {
	if value, ok := values[keys.enabled]; ok {
		cfg.Enabled = parseSupplierBalanceEnabled(value)
	}
	if value, ok := values[keys.email]; ok {
		cfg.Email = strings.TrimSpace(value)
	}
	if value, ok := values[keys.password]; ok {
		cfg.Password = strings.TrimSpace(value)
	}
	if value, ok := values[keys.token]; ok {
		cfg.AccessToken = strings.TrimSpace(value)
	}
	if value, ok := parseSupplierBalanceThreshold(values, keys.threshold); ok {
		cfg.LowBalance = value
	}
}

func parseSupplierBalanceEnabled(value string) bool {
	value = strings.TrimSpace(value)
	return value == "1" || strings.EqualFold(value, "true")
}

func parseSupplierBalanceThreshold(values map[string]string, key string) (float64, bool) {
	raw, exists := values[key]
	if !exists {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return value, err == nil && value >= 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
}

func (m *supplierBalanceMonitor) check(parent context.Context, checker supplierBalanceChecker) SupplierBalanceVO {
	row := SupplierBalanceVO{
		Key:      checker.key(),
		Name:     checker.name(),
		Source:   checker.source(),
		Currency: "USD",
		Details:  []SupplierBalanceDetailVO{},
	}
	if threshold := checker.lowBalance(); threshold > 0 {
		row.LowBalance = float64Ptr(threshold)
	}
	if state, message := checker.configurationIssue(); state != "" {
		row.State = state
		row.Message = message
		return row
	}

	started := time.Now()
	ctx, cancel := context.WithTimeout(parent, supplierBalanceTimeout)
	defer cancel()
	reading, err := checker.read(ctx, m.client)
	checkedAt := time.Now().UTC()
	row.CheckedAt = checkedAt.Format(time.RFC3339)
	row.LatencyMs = time.Since(started).Milliseconds()
	if err != nil {
		row.State = "error"
		row.Message = err.Error()
		if last, ok := m.loadLast(checker.key()); ok && last.Identity == checker.cacheIdentity() {
			row.Balance = float64Ptr(last.Reading.Balance)
			row.Currency = last.Reading.Currency
			row.Details = cloneBalanceDetails(last.Reading.Details)
			row.LastSuccessAt = last.At.UTC().Format(time.RFC3339)
			row.Stale = true
		}
		m.publishBalanceAlert(checker, row)
		return row
	}

	row.Balance = float64Ptr(reading.Balance)
	row.Currency = reading.Currency
	row.Details = cloneBalanceDetails(reading.Details)
	row.LastSuccessAt = checkedAt.Format(time.RFC3339)
	row.State = "healthy"
	row.Message = "查询成功"
	if threshold := checker.lowBalance(); threshold > 0 && reading.Balance <= threshold {
		row.State = "low"
		row.Message = fmt.Sprintf("余额已低于 %.2f %s 的预警线", threshold, reading.Currency)
	}
	m.publishBalanceAlert(checker, row)
	m.storeLast(checker.key(), supplierLastSuccess{
		Reading: reading, Identity: checker.cacheIdentity(), At: checkedAt,
	})
	return row
}

func (m *supplierBalanceMonitor) loadLast(key string) (supplierLastSuccess, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.last[key]
	return v, ok
}

func (m *supplierBalanceMonitor) storeLast(key string, value supplierLastSuccess) {
	m.mu.Lock()
	m.last[key] = value
	m.mu.Unlock()
}

func float64Ptr(v float64) *float64 { return &v }

func cloneBalanceDetails(details []SupplierBalanceDetailVO) []SupplierBalanceDetailVO {
	if len(details) == 0 {
		return []SupplierBalanceDetailVO{}
	}
	return append([]SupplierBalanceDetailVO(nil), details...)
}

// supplierBalanceMonitorFor returns the one monitor instance shared by the
// dashboard endpoint and the background alert loop. Sharing matters since the
// auto-login feature: one instance means one session-token cache, so the two
// callers renew a single supplier session instead of racing each other.
var (
	sharedBalanceMonitorsMu sync.Mutex
	sharedBalanceMonitors   = map[*app.Deps]*supplierBalanceMonitor{}
)

func supplierBalanceMonitorFor(d *app.Deps) *supplierBalanceMonitor {
	sharedBalanceMonitorsMu.Lock()
	defer sharedBalanceMonitorsMu.Unlock()
	if monitor, ok := sharedBalanceMonitors[d]; ok {
		return monitor
	}
	monitor := newSupplierBalanceMonitor(d.DB, d.Cfg.BalanceMonitor)
	monitor.alerts = d.Alerts
	sharedBalanceMonitors[d] = monitor
	return monitor
}

// RegisterSupplierBalances mounts the read-only supplier dashboard endpoint.
//
//	GET /admin/supplier-balances -> SupplierBalancesVO
func RegisterSupplierBalances(g *gin.RouterGroup, d *app.Deps) {
	monitor := supplierBalanceMonitorFor(d)
	g.GET("/supplier-balances", func(c *gin.Context) {
		response.OK(c, monitor.snapshot(c.Request.Context()))
	})
}

// StartSupplierBalanceMonitor performs checks independently of the dashboard,
// so alerts continue even when no administrator has the page open.
func StartSupplierBalanceMonitor(ctx context.Context, d *app.Deps) {
	if d == nil || d.Alerts == nil {
		return
	}
	monitor := supplierBalanceMonitorFor(d)
	go func() {
		ticker := time.NewTicker(time.Duration(monitor.refreshSeconds) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = monitor.snapshot(ctx)
			}
		}
	}()
}

func (m *supplierBalanceMonitor) publishBalanceAlert(checker supplierBalanceChecker, row SupplierBalanceVO) {
	if m.alerts == nil {
		return
	}
	lowFP := "supplier.balance.low:" + checker.key()
	errorFP := "supplier.balance.query_failed:" + checker.key()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	switch row.State {
	case "low":
		_ = m.alerts.Resolve(ctx, errorFP, "供应商余额查询恢复", checker.name()+" 余额接口已恢复", nil)
		_ = m.alerts.Publish(ctx, alerting.EventInput{EventType: "supplier.balance.low", Category: "supplier", Severity: alerting.SeverityWarning, Fingerprint: lowFP,
			Title: "供应商余额不足", Content: row.Message, Source: "admin/balances", Details: map[string]any{"supplier": checker.name(), "balance": fmt.Sprint(*row.Balance), "currency": row.Currency, "threshold": fmt.Sprint(*row.LowBalance)}})
	case "error":
		_ = m.alerts.Publish(ctx, alerting.EventInput{EventType: "supplier.balance.query_failed", Category: "supplier", Severity: alerting.SeverityError, Fingerprint: errorFP,
			Title: "供应商余额查询失败", Content: row.Message, Source: "admin/balances", Details: map[string]any{"supplier": checker.name(), "source": checker.source(), "stale": row.Stale}})
	case "healthy":
		_ = m.alerts.Resolve(ctx, errorFP, "供应商余额查询恢复", checker.name()+" 余额接口已恢复", nil)
		_ = m.alerts.Resolve(ctx, lowFP, "供应商余额恢复", checker.name()+" 当前余额已高于预警线", map[string]any{"balance": fmt.Sprint(*row.Balance), "currency": row.Currency})
	}
}

// newAPIBalanceChecker reads the standard New API user profile envelope.
// Two credential modes:
//   - Username+Password: the monitor logs in via POST /api/user/login (the
//     console flow) and reads the profile with the returned session cookie —
//     required for panels whose console only honours cookie sessions (wxart's
//     "x deal") and convenient everywhere else. New-Api-User comes from the
//     login response id, falling back to the configured UserID.
//   - AccessToken: sent exactly as configured (no implicit "Bearer " prefix)
//     to match the request demonstrated by the operator (DLAPI).
type newAPIBalanceChecker struct {
	providerKey string
	cfg         config.NewAPIBalanceConfig
	tokens      *supplierTokenCache
}

func (c *newAPIBalanceChecker) key() string { return c.providerKey }

func (c *newAPIBalanceChecker) name() string {
	if name := strings.TrimSpace(c.cfg.Name); name != "" {
		return name
	}
	return strings.ToUpper(c.providerKey)
}

func (c *newAPIBalanceChecker) source() string {
	u, err := url.Parse(strings.TrimSpace(c.cfg.BaseURL))
	if err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	return strings.TrimSpace(c.cfg.BaseURL)
}

func (c *newAPIBalanceChecker) cacheIdentity() [sha256.Size]byte {
	return supplierBalanceIdentity(c.providerKey, c.cfg.BaseURL, c.cfg.UserID, c.cfg.AccessToken, c.cfg.Username, c.cfg.Password)
}

func (c *newAPIBalanceChecker) lowBalance() float64 { return c.cfg.LowBalance }

func (c *newAPIBalanceChecker) hasLoginCredentials() bool {
	return strings.TrimSpace(c.cfg.Username) != "" && strings.TrimSpace(c.cfg.Password) != ""
}

func (c *newAPIBalanceChecker) configurationIssue() (string, string) {
	if !c.cfg.Enabled {
		return "disabled", "监控已停用"
	}
	if strings.TrimSpace(c.cfg.BaseURL) == "" {
		return "unconfigured", "缺少请求地址"
	}
	// UserID is optional: New API panels require the New-Api-User header,
	// one-api panels ignore it, and the login flow reads the id from the login
	// response. When the panel needs it and it is missing, the upstream auth
	// error surfaces on the dashboard row.
	if issue := supplierCredentialIssue(c.cfg.Username, c.cfg.Password, c.cfg.AccessToken, "登录用户名"); issue != "" {
		return "unconfigured", issue
	}
	return "", ""
}

// New API panels answer a console login in one of two shapes: legacy builds
// (and wxart's x deal) set a session cookie, while current new-api issues a
// short-lived Bearer JWT in data.access_token (~15 min) plus a path-scoped
// refresh cookie that is useless for /api/user/self. The session credential
// records which scheme the panel used.
const (
	newAPICredentialCookie = "cookie"
	newAPICredentialBearer = "bearer"
)

// newAPISessionCredential packs the login-derived state into the token-cache
// string: "<numeric user id>\x00<scheme>\x00<value>". The id rides along so
// the profile request can send New-Api-User for the exact account that owns
// the session, even when the operator left UserID blank.
func newAPISessionCredential(userID, scheme, value string) string {
	return userID + "\x00" + scheme + "\x00" + value
}

func splitNewAPISessionCredential(credential string) (userID, scheme, value string) {
	userID, rest, ok := strings.Cut(credential, "\x00")
	if !ok {
		return "", newAPICredentialCookie, credential
	}
	scheme, value, ok = strings.Cut(rest, "\x00")
	if !ok {
		return userID, newAPICredentialCookie, rest
	}
	return userID, scheme, value
}

// login performs the New API console login and returns the session cookies.
// Both real New API panels (Uniart) and the wxart "x deal" console expose the
// same POST /api/user/login?turnstile= endpoint: wrong credentials come back
// as HTTP 200 {success:false}, success sets the session cookie and echoes the
// user object (id included) in data.
func (c *newAPIBalanceChecker) login(ctx context.Context, client *http.Client) (supplierLoginResult, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierLoginResult{}, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/user/login"
	base.RawQuery = "turnstile="
	base.Fragment = ""

	body, err := json.Marshal(map[string]string{
		"username": strings.TrimSpace(c.cfg.Username),
		"password": strings.TrimSpace(c.cfg.Password),
	})
	if err != nil {
		return supplierLoginResult{}, errors.New("无法创建登录请求")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), strings.NewReader(string(body)))
	if err != nil {
		return supplierLoginResult{}, errors.New("无法创建登录请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierLoginResult{}, errors.New("登录失败：查询超时")
		}
		return supplierLoginResult{}, errors.New("登录失败：无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return supplierLoginResult{}, decodeSupplierLoginFailure(resp)
	}

	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			ID              int64   `json:"id"`
			AccessToken     string  `json:"access_token"`
			AccessExpiresAt float64 `json:"access_expires_at"` // unix seconds
			User            struct {
				ID int64 `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return supplierLoginResult{}, errors.New("登录失败：供应商响应格式无效")
	}
	if !payload.Success {
		message := compactUpstreamMessage(payload.Message)
		if message == "" {
			message = "未返回原因"
		}
		// New API answers wrong credentials with HTTP 200 {success:false}, so
		// every envelope rejection backs off like a credential failure — a
		// mistyped password must not hammer the login endpoint every refresh.
		return supplierLoginResult{}, &supplierLoginError{message: "登录失败：" + message, credentialRejected: true}
	}
	// x deal returns the user object at data top level, current new-api nests
	// it under data.user — either way the id feeds New-Api-User.
	userID := strings.TrimSpace(c.cfg.UserID)
	if payload.Data.ID > 0 {
		userID = strconv.FormatInt(payload.Data.ID, 10)
	} else if payload.Data.User.ID > 0 {
		userID = strconv.FormatInt(payload.Data.User.ID, 10)
	}
	now := time.Now()

	// Current new-api: console auth is the short-lived JWT from the login
	// body; the only cookie is a refresh token scoped to /api/user/auth that
	// /api/user/self rejects. Prefer the JWT whenever present.
	if token := strings.TrimSpace(payload.Data.AccessToken); token != "" {
		expiresIn := payload.Data.AccessExpiresAt - float64(now.Unix())
		return supplierLoginResult{
			Token:     newAPISessionCredential(userID, newAPICredentialBearer, token),
			ExpiresAt: supplierSessionExpiry(now, expiresIn, token),
		}, nil
	}

	cookies := resp.Cookies()
	pairs := make([]string, 0, len(cookies))
	expiresAt := now.Add(6 * time.Hour)
	for _, ck := range cookies {
		if ck.Name == "" {
			continue
		}
		pairs = append(pairs, ck.Name+"="+ck.Value)
		var exp time.Time
		if ck.MaxAge > 0 {
			exp = now.Add(time.Duration(ck.MaxAge) * time.Second)
		} else if !ck.Expires.IsZero() {
			exp = ck.Expires
		}
		if !exp.IsZero() && exp.Before(expiresAt) {
			expiresAt = exp
		}
	}
	if len(pairs) == 0 {
		return supplierLoginResult{}, &supplierLoginError{message: "登录失败：面板未下发会话凭证"}
	}
	const margin = time.Minute
	if expiresAt.After(now.Add(2 * margin)) {
		expiresAt = expiresAt.Add(-margin)
	} else if expiresAt.After(now) {
		expiresAt = now.Add(expiresAt.Sub(now) / 2)
	} else {
		expiresAt = now
	}
	return supplierLoginResult{
		Token:     newAPISessionCredential(userID, newAPICredentialCookie, strings.Join(pairs, "; ")),
		ExpiresAt: expiresAt,
	}, nil
}

func (c *newAPIBalanceChecker) sessionCredential(ctx context.Context, client *http.Client, rejected string) (string, error) {
	return acquireSupplierLoginToken(ctx, c.tokens.entry(c.providerKey), c.cacheIdentity(), rejected,
		func(ctx context.Context) (supplierLoginResult, error) { return c.login(ctx, client) })
}

func (c *newAPIBalanceChecker) read(ctx context.Context, client *http.Client) (supplierBalanceReading, error) {
	if c.hasLoginCredentials() && c.tokens != nil {
		credential, err := c.sessionCredential(ctx, client, "")
		if err != nil {
			return supplierBalanceReading{}, err
		}
		reading, rejected, err := c.fetchSelf(ctx, client, c.sessionAuth(credential))
		if err != nil && rejected {
			// New API reports a dead session as HTTP 200 {success:false} (and
			// some forks as 401), so any auth rejection discards the cached
			// session and retries exactly once with a fresh login.
			if credential, err = c.sessionCredential(ctx, client, credential); err != nil {
				return supplierBalanceReading{}, err
			}
			reading, _, err = c.fetchSelf(ctx, client, c.sessionAuth(credential))
		}
		return reading, err
	}
	reading, _, err := c.fetchSelf(ctx, client, c.tokenAuth())
	return reading, err
}

// tokenAuth authenticates with the configured access token, sent verbatim.
func (c *newAPIBalanceChecker) tokenAuth() func(*http.Request) {
	return func(req *http.Request) {
		req.Header.Set("Authorization", strings.TrimSpace(c.cfg.AccessToken))
		if userID := strings.TrimSpace(c.cfg.UserID); userID != "" {
			req.Header.Set("New-Api-User", userID)
		}
	}
}

// sessionAuth authenticates with a login session — Bearer JWT or cookie,
// whichever the panel issued — plus New-Api-User.
func (c *newAPIBalanceChecker) sessionAuth(credential string) func(*http.Request) {
	return func(req *http.Request) {
		userID, scheme, value := splitNewAPISessionCredential(credential)
		if scheme == newAPICredentialBearer {
			req.Header.Set("Authorization", "Bearer "+value)
		} else {
			req.Header.Set("Cookie", value)
		}
		if userID != "" {
			req.Header.Set("New-Api-User", userID)
		}
	}
}

// fetchSelf performs the authenticated profile request. rejected reports an
// auth-shaped refusal (HTTP 401/403 or the New API 200-{success:false}
// envelope), which the session path uses to relogin once.
func (c *newAPIBalanceChecker) fetchSelf(ctx context.Context, client *http.Client, authorize func(*http.Request)) (supplierBalanceReading, bool, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierBalanceReading{}, false, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/user/self"
	base.RawQuery = ""
	base.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return supplierBalanceReading{}, false, errors.New("无法创建供应商请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")
	authorize(req)

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierBalanceReading{}, false, errors.New("查询超时")
		}
		return supplierBalanceReading{}, false, errors.New("无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		rejected := resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden
		return supplierBalanceReading{}, rejected, fmt.Errorf("供应商返回 HTTP %d", resp.StatusCode)
	}

	var envelope struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Quota     *float64 `json:"quota"`
			UsedQuota *float64 `json:"used_quota"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if err := decoder.Decode(&envelope); err != nil {
		return supplierBalanceReading{}, false, errors.New("供应商响应格式无效")
	}
	if !envelope.Success {
		message := compactUpstreamMessage(envelope.Message)
		if message == "" {
			message = "未返回原因"
		}
		return supplierBalanceReading{}, true, errors.New("供应商拒绝请求：" + message)
	}
	if envelope.Data.Quota == nil {
		return supplierBalanceReading{}, false, errors.New("供应商响应缺少余额字段")
	}
	if c.cfg.QuotaPerUnit <= 0 {
		return supplierBalanceReading{}, false, errors.New("余额换算配置无效")
	}

	reading := supplierBalanceReading{
		Balance:  *envelope.Data.Quota / c.cfg.QuotaPerUnit,
		Currency: strings.ToUpper(strings.TrimSpace(c.cfg.Currency)),
	}
	if reading.Currency == "" {
		reading.Currency = "USD"
	}
	if envelope.Data.UsedQuota != nil {
		used := *envelope.Data.UsedQuota / c.cfg.QuotaPerUnit
		reading.Details = append(reading.Details, SupplierBalanceDetailVO{
			Label: "累计使用", Value: used, Currency: reading.Currency,
		})
	}
	return reading, false, nil
}

// balanceProfileChecker reads the authenticated profile envelope shared by
// Mikoto and CCGO. Browser cookies and fetch metadata are intentionally omitted;
// the Bearer credential is the authentication material. CCGO additionally
// requires x-user-ui-request: 1, controlled by cfg.UIRequest. With Email and
// Password configured the checker logs in via POST /api/v1/auth/login and
// renews the session token itself; a manually pasted AccessToken is only used
// when no account is configured.
type balanceProfileChecker struct {
	providerKey string
	cfg         config.BearerProfileBalanceConfig
	tokens      *supplierTokenCache
}

func (c *balanceProfileChecker) key() string { return c.providerKey }

func (c *balanceProfileChecker) name() string {
	if name := strings.TrimSpace(c.cfg.Name); name != "" {
		return name
	}
	return strings.ToUpper(c.providerKey)
}

func (c *balanceProfileChecker) source() string {
	u, err := url.Parse(strings.TrimSpace(c.cfg.BaseURL))
	if err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	return strings.TrimSpace(c.cfg.BaseURL)
}

func (c *balanceProfileChecker) cacheIdentity() [sha256.Size]byte {
	return supplierBalanceIdentity(c.providerKey, c.cfg.BaseURL, c.cfg.AccessToken, c.cfg.Email, c.cfg.Password)
}

func (c *balanceProfileChecker) lowBalance() float64 { return c.cfg.LowBalance }

func (c *balanceProfileChecker) hasLoginCredentials() bool {
	return strings.TrimSpace(c.cfg.Email) != "" && strings.TrimSpace(c.cfg.Password) != ""
}

func (c *balanceProfileChecker) configurationIssue() (string, string) {
	if !c.cfg.Enabled {
		return "disabled", "监控已停用"
	}
	if strings.TrimSpace(c.cfg.BaseURL) == "" {
		return "unconfigured", "缺少请求地址"
	}
	if issue := supplierCredentialIssue(c.cfg.Email, c.cfg.Password, c.cfg.AccessToken, "登录邮箱"); issue != "" {
		return "unconfigured", issue
	}
	return "", ""
}

// supplierCredentialIssue validates the credential pair shared by the
// login-capable checkers: either a complete account or a manual token must be
// present. accountLabel names the identifier field in operator-facing text.
func supplierCredentialIssue(account, password, token, accountLabel string) string {
	account, password, token = strings.TrimSpace(account), strings.TrimSpace(password), strings.TrimSpace(token)
	switch {
	case account != "" && password != "":
		return ""
	case account != "":
		return "已填写" + accountLabel + "但缺少登录密码"
	case password != "":
		return "已填写登录密码但缺少" + accountLabel
	case token != "":
		return ""
	default:
		return "缺少账号密码或访问令牌"
	}
}

// login exchanges the configured account for a session JWT.
func (c *balanceProfileChecker) login(ctx context.Context, client *http.Client) (supplierLoginResult, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierLoginResult{}, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/v1/auth/login"
	base.RawQuery = ""
	base.Fragment = ""

	body, err := json.Marshal(map[string]string{
		"email":    strings.TrimSpace(c.cfg.Email),
		"password": strings.TrimSpace(c.cfg.Password),
	})
	if err != nil {
		return supplierLoginResult{}, errors.New("无法创建登录请求")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), strings.NewReader(string(body)))
	if err != nil {
		return supplierLoginResult{}, errors.New("无法创建登录请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.UIRequest {
		req.Header.Set("X-User-UI-Request", "1")
	}
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierLoginResult{}, errors.New("登录失败：查询超时")
		}
		return supplierLoginResult{}, errors.New("登录失败：无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return supplierLoginResult{}, decodeSupplierLoginFailure(resp)
	}

	// The platform wraps successful bodies as {code:0,data:{access_token,...}}
	// (its web client unwraps this in an axios interceptor); accept a bare
	// top-level access_token too in case a deployment answers unwrapped.
	var payload struct {
		Code        *int    `json:"code"`
		Message     string  `json:"message"`
		AccessToken string  `json:"access_token"`
		ExpiresIn   float64 `json:"expires_in"`
		Data        struct {
			AccessToken string  `json:"access_token"`
			ExpiresIn   float64 `json:"expires_in"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return supplierLoginResult{}, errors.New("登录失败：供应商响应格式无效")
	}
	if payload.Code != nil && *payload.Code != 0 {
		message := compactUpstreamMessage(payload.Message)
		if message == "" {
			message = "未返回原因"
		}
		return supplierLoginResult{}, &supplierLoginError{message: "登录失败：" + message}
	}
	token := strings.TrimSpace(payload.Data.AccessToken)
	expiresIn := payload.Data.ExpiresIn
	if token == "" {
		token = strings.TrimSpace(payload.AccessToken)
		expiresIn = payload.ExpiresIn
	}
	if token == "" {
		return supplierLoginResult{}, &supplierLoginError{
			message:            "登录失败：响应缺少令牌（账号可能启用了两步验证，请改用手动访问令牌）",
			credentialRejected: true,
		}
	}
	return supplierLoginResult{Token: token, ExpiresAt: supplierSessionExpiry(time.Now(), expiresIn, token)}, nil
}

func (c *balanceProfileChecker) sessionToken(ctx context.Context, client *http.Client, rejectedToken string) (string, error) {
	return acquireSupplierLoginToken(ctx, c.tokens.entry(c.providerKey), c.cacheIdentity(), rejectedToken,
		func(ctx context.Context) (supplierLoginResult, error) { return c.login(ctx, client) })
}

func (c *balanceProfileChecker) read(ctx context.Context, client *http.Client) (supplierBalanceReading, error) {
	token := c.cfg.AccessToken
	viaLogin := c.hasLoginCredentials() && c.tokens != nil
	if viaLogin {
		var err error
		if token, err = c.sessionToken(ctx, client, ""); err != nil {
			return supplierBalanceReading{}, err
		}
	}
	reading, status, err := c.fetchProfile(ctx, client, token)
	if err != nil && viaLogin && (status == http.StatusUnauthorized || status == http.StatusForbidden) {
		// The cached session was revoked upstream before its expiry hint;
		// discard it and retry exactly once with a fresh login.
		if token, err = c.sessionToken(ctx, client, token); err != nil {
			return supplierBalanceReading{}, err
		}
		reading, _, err = c.fetchProfile(ctx, client, token)
	}
	return reading, err
}

// fetchProfile performs the authenticated profile request. The returned status
// is the HTTP status code when a response was received, 0 otherwise.
func (c *balanceProfileChecker) fetchProfile(ctx context.Context, client *http.Client, token string) (supplierBalanceReading, int, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierBalanceReading{}, 0, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/v1/auth/me"
	query := base.Query()
	query.Set("timezone", strings.TrimSpace(c.cfg.Timezone))
	base.RawQuery = query.Encode()
	base.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return supplierBalanceReading{}, 0, errors.New("无法创建供应商请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", bearerAuthorization(token))
	if c.cfg.UIRequest {
		req.Header.Set("X-User-UI-Request", "1")
	}
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierBalanceReading{}, 0, errors.New("查询超时")
		}
		return supplierBalanceReading{}, 0, errors.New("无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return supplierBalanceReading{}, resp.StatusCode, fmt.Errorf("供应商返回 HTTP %d", resp.StatusCode)
	}

	var envelope struct {
		Code    *int   `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Balance        *float64 `json:"balance"`
			FrozenBalance  *float64 `json:"frozen_balance"`
			TotalRecharged *float64 `json:"total_recharged"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if err := decoder.Decode(&envelope); err != nil {
		return supplierBalanceReading{}, resp.StatusCode, errors.New("供应商响应格式无效")
	}
	if envelope.Code != nil && *envelope.Code != 0 {
		message := compactUpstreamMessage(envelope.Message)
		if message == "" {
			message = "未返回原因"
		}
		return supplierBalanceReading{}, resp.StatusCode, errors.New("供应商拒绝请求：" + message)
	}
	if envelope.Data.Balance == nil {
		return supplierBalanceReading{}, resp.StatusCode, errors.New("供应商响应缺少余额字段")
	}

	currency := strings.ToUpper(strings.TrimSpace(c.cfg.Currency))
	if currency == "" {
		currency = "USD"
	}
	reading := supplierBalanceReading{Balance: *envelope.Data.Balance, Currency: currency}
	if envelope.Data.FrozenBalance != nil {
		reading.Details = append(reading.Details, SupplierBalanceDetailVO{
			Label: "冻结余额", Value: *envelope.Data.FrozenBalance, Currency: currency,
		})
	}
	if envelope.Data.TotalRecharged != nil {
		reading.Details = append(reading.Details, SupplierBalanceDetailVO{
			Label: "累计充值", Value: *envelope.Data.TotalRecharged, Currency: currency,
		})
	}
	return reading, resp.StatusCode, nil
}

// dimensioBalanceChecker reads Dimensio's user dashboard (GET
// /api/user/dashboard). Its response has no envelope: the remaining balance is
// creditBudget minus creditUsed. With Username and Password configured the
// checker logs in via POST /api/auth/login and renews the session token
// itself.
type dimensioBalanceChecker struct {
	providerKey string
	cfg         config.DimensioBalanceConfig
	tokens      *supplierTokenCache
}

func (c *dimensioBalanceChecker) key() string { return c.providerKey }

func (c *dimensioBalanceChecker) name() string {
	if name := strings.TrimSpace(c.cfg.Name); name != "" {
		return name
	}
	return "Dimensio"
}

func (c *dimensioBalanceChecker) source() string {
	u, err := url.Parse(strings.TrimSpace(c.cfg.BaseURL))
	if err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	return strings.TrimSpace(c.cfg.BaseURL)
}

func (c *dimensioBalanceChecker) cacheIdentity() [sha256.Size]byte {
	return supplierBalanceIdentity(c.providerKey, c.cfg.BaseURL, c.cfg.AccessToken, c.cfg.Username, c.cfg.Password)
}

func (c *dimensioBalanceChecker) lowBalance() float64 { return c.cfg.LowBalance }

func (c *dimensioBalanceChecker) hasLoginCredentials() bool {
	return strings.TrimSpace(c.cfg.Username) != "" && strings.TrimSpace(c.cfg.Password) != ""
}

func (c *dimensioBalanceChecker) configurationIssue() (string, string) {
	if !c.cfg.Enabled {
		return "disabled", "监控已停用"
	}
	if strings.TrimSpace(c.cfg.BaseURL) == "" {
		return "unconfigured", "缺少请求地址"
	}
	if issue := supplierCredentialIssue(c.cfg.Username, c.cfg.Password, c.cfg.AccessToken, "登录用户名"); issue != "" {
		return "unconfigured", issue
	}
	return "", ""
}

// login exchanges the configured account for a session token. Dimensio returns
// the token at the top level of the response body with no envelope.
func (c *dimensioBalanceChecker) login(ctx context.Context, client *http.Client) (supplierLoginResult, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierLoginResult{}, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/auth/login"
	base.RawQuery = ""
	base.Fragment = ""

	body, err := json.Marshal(map[string]string{
		"username": strings.TrimSpace(c.cfg.Username),
		"password": strings.TrimSpace(c.cfg.Password),
	})
	if err != nil {
		return supplierLoginResult{}, errors.New("无法创建登录请求")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), strings.NewReader(string(body)))
	if err != nil {
		return supplierLoginResult{}, errors.New("无法创建登录请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierLoginResult{}, errors.New("登录失败：查询超时")
		}
		return supplierLoginResult{}, errors.New("登录失败：无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return supplierLoginResult{}, decodeSupplierLoginFailure(resp)
	}

	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return supplierLoginResult{}, errors.New("登录失败：供应商响应格式无效")
	}
	token := strings.TrimSpace(payload.Token)
	if token == "" {
		return supplierLoginResult{}, &supplierLoginError{message: "登录失败：响应缺少令牌", credentialRejected: true}
	}
	return supplierLoginResult{Token: token, ExpiresAt: supplierSessionExpiry(time.Now(), 0, token)}, nil
}

func (c *dimensioBalanceChecker) sessionToken(ctx context.Context, client *http.Client, rejectedToken string) (string, error) {
	return acquireSupplierLoginToken(ctx, c.tokens.entry(c.providerKey), c.cacheIdentity(), rejectedToken,
		func(ctx context.Context) (supplierLoginResult, error) { return c.login(ctx, client) })
}

func (c *dimensioBalanceChecker) read(ctx context.Context, client *http.Client) (supplierBalanceReading, error) {
	token := c.cfg.AccessToken
	viaLogin := c.hasLoginCredentials() && c.tokens != nil
	if viaLogin {
		var err error
		if token, err = c.sessionToken(ctx, client, ""); err != nil {
			return supplierBalanceReading{}, err
		}
	}
	reading, status, err := c.fetchProfile(ctx, client, token)
	if err != nil && viaLogin && (status == http.StatusUnauthorized || status == http.StatusForbidden) {
		if token, err = c.sessionToken(ctx, client, token); err != nil {
			return supplierBalanceReading{}, err
		}
		reading, _, err = c.fetchProfile(ctx, client, token)
	}
	return reading, err
}

// fetchProfile performs the authenticated dashboard request. The returned
// status is the HTTP status code when a response was received, 0 otherwise.
// The dashboard body also carries trend and generation-record arrays with very
// long prompts, hence the generous read limit.
func (c *dimensioBalanceChecker) fetchProfile(ctx context.Context, client *http.Client, token string) (supplierBalanceReading, int, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierBalanceReading{}, 0, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/user/dashboard"
	base.RawQuery = ""
	base.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return supplierBalanceReading{}, 0, errors.New("无法创建供应商请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", bearerAuthorization(token))
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierBalanceReading{}, 0, errors.New("查询超时")
		}
		return supplierBalanceReading{}, 0, errors.New("无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return supplierBalanceReading{}, resp.StatusCode, fmt.Errorf("供应商返回 HTTP %d", resp.StatusCode)
	}

	var dashboard struct {
		CreditBudget *float64 `json:"creditBudget"`
		CreditUsed   *float64 `json:"creditUsed"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 8<<20))
	if err := decoder.Decode(&dashboard); err != nil {
		return supplierBalanceReading{}, resp.StatusCode, errors.New("供应商响应格式无效")
	}
	if dashboard.CreditBudget == nil || dashboard.CreditUsed == nil {
		return supplierBalanceReading{}, resp.StatusCode, errors.New("供应商响应缺少额度字段")
	}

	unit := strings.TrimSpace(c.cfg.Unit)
	if unit == "" {
		unit = "积分"
	}
	return supplierBalanceReading{
		Balance:  *dashboard.CreditBudget - *dashboard.CreditUsed,
		Currency: unit,
		Details: []SupplierBalanceDetailVO{
			{Label: "总额度", Value: *dashboard.CreditBudget, Currency: unit},
			{Label: "已使用", Value: *dashboard.CreditUsed, Currency: unit},
		},
	}, resp.StatusCode, nil
}

func bearerAuthorization(token string) string {
	token = strings.TrimSpace(token)
	if len(token) >= 7 && strings.EqualFold(token[:7], "Bearer ") {
		return token
	}
	return "Bearer " + token
}

func supplierBalanceIdentity(parts ...string) [sha256.Size]byte {
	return sha256.Sum256([]byte(strings.Join(parts, "\x00")))
}

func compactUpstreamMessage(message string) string {
	message = strings.Join(strings.Fields(message), " ")
	runes := []rune(message)
	if len(runes) > 120 {
		return string(runes[:120]) + "…"
	}
	return message
}
