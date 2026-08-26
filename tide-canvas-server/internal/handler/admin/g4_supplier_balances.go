package admin

// g4_supplier_balances.go — 后台「供应商余额」实时查询。
//
// 浏览器只调用本服务的 /api/admin/supplier-balances；供应商令牌始终留在
// 服务端配置中。每个供应商实现一个 checker，查询并发执行，单个上游失败不会
// 让整个页面失败。进程内保留最近一次成功值，短暂故障时可展示带 stale 标记的
// 旧余额和最后成功时间（不落库，重启后自然清空）。

import (
	"context"
	"crypto/sha256"
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

	mu   sync.RWMutex
	last map[string]supplierLastSuccess
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
		for i := range rows {
			if rows[i].Key == "dlapi" {
				continue
			}
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
		&newAPIBalanceChecker{providerKey: "dlapi", cfg: cfg.DLAPI},
		&balanceProfileChecker{providerKey: "mikoto", cfg: cfg.Mikoto},
		&balanceProfileChecker{providerKey: "ccgo", cfg: cfg.CCGO},
		&balanceProfileChecker{providerKey: "ccgo2", cfg: cfg.CCGO2},
		&dimensioBalanceChecker{providerKey: "dimensio", cfg: cfg.Dimensio},
	}, err
}

// loadLiveSupplierBalanceConfig overlays the four JWT-backed suppliers from
// sys_config for every snapshot. A blank stored token intentionally clears any
// legacy environment value. DLAPI is left on the deployment configuration.
func loadLiveSupplierBalanceConfig(db *gorm.DB, cfg config.BalanceMonitorConfig) (config.BalanceMonitorConfig, error) {
	// These values have a single source of truth: sys_config. Clear any values
	// Viper may have accepted from legacy environment variables before reading
	// the database, so missing rows or a transient DB error can never revive an
	// old credential behind the administrator's back.
	cfg.Mikoto.Enabled, cfg.Mikoto.AccessToken, cfg.Mikoto.LowBalance = false, "", 0
	cfg.CCGO.Enabled, cfg.CCGO.AccessToken, cfg.CCGO.LowBalance = false, "", 0
	cfg.CCGO2.Enabled, cfg.CCGO2.AccessToken, cfg.CCGO2.LowBalance = false, "", 0
	cfg.Dimensio.Enabled, cfg.Dimensio.AccessToken, cfg.Dimensio.LowBalance = false, "", 0

	var rows []model.SysConfig
	if err := db.Where("config_key IN ?", model.SupplierBalanceConfigKeys).Find(&rows).Error; err != nil {
		return cfg, err
	}
	values := make(map[string]string, len(rows))
	for i := range rows {
		values[rows[i].ConfigKey] = rows[i].ConfigValue
	}

	overlayProfileBalanceConfig(values, model.ConfigKeyBalanceMikotoEnabled, model.ConfigKeyBalanceMikotoAccessToken, model.ConfigKeyBalanceMikotoLowBalance, &cfg.Mikoto)
	overlayProfileBalanceConfig(values, model.ConfigKeyBalanceCCGOEnabled, model.ConfigKeyBalanceCCGOAccessToken, model.ConfigKeyBalanceCCGOLowBalance, &cfg.CCGO)
	overlayProfileBalanceConfig(values, model.ConfigKeyBalanceCCGO2Enabled, model.ConfigKeyBalanceCCGO2AccessToken, model.ConfigKeyBalanceCCGO2LowBalance, &cfg.CCGO2)
	if value, ok := values[model.ConfigKeyBalanceDimensioEnabled]; ok {
		cfg.Dimensio.Enabled = parseSupplierBalanceEnabled(value)
	}
	if value, ok := values[model.ConfigKeyBalanceDimensioAccessToken]; ok {
		cfg.Dimensio.AccessToken = strings.TrimSpace(value)
	}
	if value, ok := parseSupplierBalanceThreshold(values, model.ConfigKeyBalanceDimensioLowBalance); ok {
		cfg.Dimensio.LowBalance = value
	}
	return cfg, nil
}

func overlayProfileBalanceConfig(values map[string]string, enabledKey, tokenKey, thresholdKey string, cfg *config.BearerProfileBalanceConfig) {
	if value, ok := values[enabledKey]; ok {
		cfg.Enabled = parseSupplierBalanceEnabled(value)
	}
	if value, ok := values[tokenKey]; ok {
		cfg.AccessToken = strings.TrimSpace(value)
	}
	if value, ok := parseSupplierBalanceThreshold(values, thresholdKey); ok {
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

// RegisterSupplierBalances mounts the read-only supplier dashboard endpoint.
//
//	GET /admin/supplier-balances -> SupplierBalancesVO
func RegisterSupplierBalances(g *gin.RouterGroup, d *app.Deps) {
	monitor := newSupplierBalanceMonitor(d.DB, d.Cfg.BalanceMonitor)
	monitor.alerts = d.Alerts
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
	monitor := newSupplierBalanceMonitor(d.DB, d.Cfg.BalanceMonitor)
	monitor.alerts = d.Alerts
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
// DLAPI's Authorization header is sent exactly as configured (no implicit
// "Bearer " prefix) to match the request demonstrated by the operator.
type newAPIBalanceChecker struct {
	providerKey string
	cfg         config.NewAPIBalanceConfig
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
	return supplierBalanceIdentity(c.providerKey, c.cfg.BaseURL, c.cfg.UserID, c.cfg.AccessToken)
}

func (c *newAPIBalanceChecker) lowBalance() float64 { return c.cfg.LowBalance }

func (c *newAPIBalanceChecker) configurationIssue() (string, string) {
	if !c.cfg.Enabled {
		return "disabled", "监控已停用"
	}
	missing := make([]string, 0, 3)
	if strings.TrimSpace(c.cfg.BaseURL) == "" {
		missing = append(missing, "请求地址")
	}
	if strings.TrimSpace(c.cfg.UserID) == "" {
		missing = append(missing, "用户 ID")
	}
	if strings.TrimSpace(c.cfg.AccessToken) == "" {
		missing = append(missing, "访问令牌")
	}
	if len(missing) > 0 {
		return "unconfigured", "缺少" + strings.Join(missing, "、")
	}
	return "", ""
}

func (c *newAPIBalanceChecker) read(ctx context.Context, client *http.Client) (supplierBalanceReading, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierBalanceReading{}, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/user/self"
	base.RawQuery = ""
	base.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return supplierBalanceReading{}, errors.New("无法创建供应商请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", strings.TrimSpace(c.cfg.AccessToken))
	req.Header.Set("New-Api-User", strings.TrimSpace(c.cfg.UserID))
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierBalanceReading{}, errors.New("查询超时")
		}
		return supplierBalanceReading{}, errors.New("无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return supplierBalanceReading{}, fmt.Errorf("供应商返回 HTTP %d", resp.StatusCode)
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
		return supplierBalanceReading{}, errors.New("供应商响应格式无效")
	}
	if !envelope.Success {
		message := compactUpstreamMessage(envelope.Message)
		if message == "" {
			message = "未返回原因"
		}
		return supplierBalanceReading{}, errors.New("供应商拒绝请求：" + message)
	}
	if envelope.Data.Quota == nil {
		return supplierBalanceReading{}, errors.New("供应商响应缺少余额字段")
	}
	if c.cfg.QuotaPerUnit <= 0 {
		return supplierBalanceReading{}, errors.New("余额换算配置无效")
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
	return reading, nil
}

// balanceProfileChecker reads the authenticated profile envelope shared by
// Mikoto and CCGO. Browser cookies and fetch metadata are intentionally omitted;
// the Bearer credential is the authentication material. CCGO additionally
// requires x-user-ui-request: 1, controlled by cfg.UIRequest.
type balanceProfileChecker struct {
	providerKey string
	cfg         config.BearerProfileBalanceConfig
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
	return supplierBalanceIdentity(c.providerKey, c.cfg.BaseURL, c.cfg.AccessToken)
}

func (c *balanceProfileChecker) lowBalance() float64 { return c.cfg.LowBalance }

func (c *balanceProfileChecker) configurationIssue() (string, string) {
	if !c.cfg.Enabled {
		return "disabled", "监控已停用"
	}
	missing := make([]string, 0, 2)
	if strings.TrimSpace(c.cfg.BaseURL) == "" {
		missing = append(missing, "请求地址")
	}
	if strings.TrimSpace(c.cfg.AccessToken) == "" {
		missing = append(missing, "访问令牌")
	}
	if len(missing) > 0 {
		return "unconfigured", "缺少" + strings.Join(missing, "、")
	}
	return "", ""
}

func (c *balanceProfileChecker) read(ctx context.Context, client *http.Client) (supplierBalanceReading, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierBalanceReading{}, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/v1/auth/me"
	query := base.Query()
	query.Set("timezone", strings.TrimSpace(c.cfg.Timezone))
	base.RawQuery = query.Encode()
	base.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return supplierBalanceReading{}, errors.New("无法创建供应商请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", bearerAuthorization(c.cfg.AccessToken))
	if c.cfg.UIRequest {
		req.Header.Set("X-User-UI-Request", "1")
	}
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierBalanceReading{}, errors.New("查询超时")
		}
		return supplierBalanceReading{}, errors.New("无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return supplierBalanceReading{}, fmt.Errorf("供应商返回 HTTP %d", resp.StatusCode)
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
		return supplierBalanceReading{}, errors.New("供应商响应格式无效")
	}
	if envelope.Code != nil && *envelope.Code != 0 {
		message := compactUpstreamMessage(envelope.Message)
		if message == "" {
			message = "未返回原因"
		}
		return supplierBalanceReading{}, errors.New("供应商拒绝请求：" + message)
	}
	if envelope.Data.Balance == nil {
		return supplierBalanceReading{}, errors.New("供应商响应缺少余额字段")
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
	return reading, nil
}

// dimensioBalanceChecker reads Dimensio's user membership quota. Its response
// has no envelope: the remaining balance is derived from the total membership
// credit budget minus credits already consumed in the current membership span.
type dimensioBalanceChecker struct {
	providerKey string
	cfg         config.DimensioBalanceConfig
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
	return supplierBalanceIdentity(c.providerKey, c.cfg.BaseURL, c.cfg.AccessToken)
}

func (c *dimensioBalanceChecker) lowBalance() float64 { return c.cfg.LowBalance }

func (c *dimensioBalanceChecker) configurationIssue() (string, string) {
	if !c.cfg.Enabled {
		return "disabled", "监控已停用"
	}
	missing := make([]string, 0, 2)
	if strings.TrimSpace(c.cfg.BaseURL) == "" {
		missing = append(missing, "请求地址")
	}
	if strings.TrimSpace(c.cfg.AccessToken) == "" {
		missing = append(missing, "访问令牌")
	}
	if len(missing) > 0 {
		return "unconfigured", "缺少" + strings.Join(missing, "、")
	}
	return "", ""
}

func (c *dimensioBalanceChecker) read(ctx context.Context, client *http.Client) (supplierBalanceReading, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(c.cfg.BaseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return supplierBalanceReading{}, errors.New("供应商请求地址无效")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/auth/me"
	base.RawQuery = ""
	base.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return supplierBalanceReading{}, errors.New("无法创建供应商请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", bearerAuthorization(c.cfg.AccessToken))
	req.Header.Set("User-Agent", "TideCanvas-BalanceMonitor/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return supplierBalanceReading{}, errors.New("查询超时")
		}
		return supplierBalanceReading{}, errors.New("无法连接供应商")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return supplierBalanceReading{}, fmt.Errorf("供应商返回 HTTP %d", resp.StatusCode)
	}

	var profile struct {
		CreditBudget           *float64 `json:"credit_budget"`
		MembershipUsageCredits *float64 `json:"membership_usage_credits"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if err := decoder.Decode(&profile); err != nil {
		return supplierBalanceReading{}, errors.New("供应商响应格式无效")
	}
	if profile.CreditBudget == nil || profile.MembershipUsageCredits == nil {
		return supplierBalanceReading{}, errors.New("供应商响应缺少额度字段")
	}

	unit := strings.TrimSpace(c.cfg.Unit)
	if unit == "" {
		unit = "积分"
	}
	return supplierBalanceReading{
		Balance:  *profile.CreditBudget - *profile.MembershipUsageCredits,
		Currency: unit,
		Details: []SupplierBalanceDetailVO{
			{Label: "总额度", Value: *profile.CreditBudget, Currency: unit},
			{Label: "已使用", Value: *profile.MembershipUsageCredits, Currency: unit},
		},
	}, nil
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
