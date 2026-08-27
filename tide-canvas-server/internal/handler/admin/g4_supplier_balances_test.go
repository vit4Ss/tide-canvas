package admin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
)

func TestNewAPIBalanceCheckerConvertsQuotaAndSendsCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/user/self" {
			t.Errorf("request = %s %s, want GET /api/user/self", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("New-Api-User"); got != "245" {
			t.Errorf("New-Api-User = %q, want 245", got)
		}
		if got := r.Header.Get("Authorization"); got != "sk-test-account-token" {
			t.Errorf("Authorization = %q, want exact configured token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"message":"","data":{"quota":6250000,"used_quota":1250000}}`))
	}))
	defer server.Close()

	checker := &newAPIBalanceChecker{providerKey: "dlapi", cfg: config.NewAPIBalanceConfig{
		Enabled: true, Name: "DLAPI", BaseURL: server.URL, UserID: "245",
		AccessToken: "sk-test-account-token", QuotaPerUnit: 500000, Currency: "USD",
	}}
	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 12.5 {
		t.Errorf("balance = %v, want 12.5", reading.Balance)
	}
	if len(reading.Details) != 1 || reading.Details[0].Label != "累计使用" || reading.Details[0].Value != 2.5 {
		t.Errorf("details = %+v, want cumulative usage 2.5", reading.Details)
	}
}

func TestMikotoBalanceCheckerReadsBearerProfile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/auth/me" {
			t.Errorf("request = %s %s, want GET /api/v1/auth/me", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("timezone"); got != "Asia/Shanghai" {
			t.Errorf("timezone = %q, want Asia/Shanghai", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-jwt" {
			t.Errorf("Authorization = %q, want Bearer test-jwt", got)
		}
		if got := r.Header.Get("Cookie"); got != "" {
			t.Errorf("Cookie = %q, want no browser cookies", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"balance":88.44625173,"frozen_balance":0,"total_recharged":145}}`))
	}))
	defer server.Close()

	checker := &balanceProfileChecker{providerKey: "mikoto", cfg: config.MikotoBalanceConfig{
		Enabled: true, Name: "Mikoto", BaseURL: server.URL, AccessToken: "test-jwt",
		Timezone: "Asia/Shanghai", Currency: "USD",
	}}
	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 88.44625173 {
		t.Errorf("balance = %v, want 88.44625173", reading.Balance)
	}
	if len(reading.Details) != 2 || reading.Details[0].Label != "冻结余额" || reading.Details[1].Value != 145 {
		t.Errorf("details = %+v, want frozen and recharge amounts", reading.Details)
	}
}

func TestCCGOBalanceCheckerAddsUIRequestHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/me" || r.URL.Query().Get("timezone") != "Asia/Shanghai" {
			t.Errorf("request URL = %s, want CCGO profile URL with timezone", r.URL.String())
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ccgo-jwt" {
			t.Errorf("Authorization = %q, want Bearer ccgo-jwt", got)
		}
		if got := r.Header.Get("X-User-UI-Request"); got != "1" {
			t.Errorf("X-User-UI-Request = %q, want 1", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"balance":43.67334096,"frozen_balance":0,"total_recharged":250}}`))
	}))
	defer server.Close()

	checker := &balanceProfileChecker{providerKey: "ccgo", cfg: config.BearerProfileBalanceConfig{
		Enabled: true, Name: "CCGO", BaseURL: server.URL, AccessToken: "ccgo-jwt",
		Timezone: "Asia/Shanghai", Currency: "USD", UIRequest: true,
	}}
	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 43.67334096 {
		t.Errorf("balance = %v, want 43.67334096", reading.Balance)
	}
	if len(reading.Details) != 2 || reading.Details[1].Label != "累计充值" || reading.Details[1].Value != 250 {
		t.Errorf("details = %+v, want frozen and recharge amounts", reading.Details)
	}
}

func TestDimensioBalanceCheckerCalculatesRemainingCredits(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/user/dashboard" {
			t.Errorf("request = %s %s, want GET /api/user/dashboard", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer dimensio-jwt" {
			t.Errorf("Authorization = %q, want Bearer dimensio-jwt", got)
		}
		if got := r.Header.Get("Referer"); got != "" {
			t.Errorf("Referer = %q, want no browser metadata", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"creditBudget":560100,"creditUsed":519891,"trend":[{"date":"2026-08-20","images":0,"videos":21}],"recentRecords":[],"announcement":""}`))
	}))
	defer server.Close()

	checker := &dimensioBalanceChecker{providerKey: "dimensio", cfg: config.DimensioBalanceConfig{
		Enabled: true, Name: "Dimensio", BaseURL: server.URL, AccessToken: "dimensio-jwt", Unit: "积分",
	}}
	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 40209 {
		t.Errorf("balance = %v, want 40209 (creditBudget-creditUsed)", reading.Balance)
	}
	if len(reading.Details) != 2 || reading.Details[0].Value != 560100 || reading.Details[1].Value != 519891 {
		t.Errorf("details = %+v, want budget and used credits", reading.Details)
	}
}

func TestBalanceProfileCheckerLogsInAndCachesSession(t *testing.T) {
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/login":
			loginCount.Add(1)
			if r.Method != http.MethodPost {
				t.Errorf("login method = %s, want POST", r.Method)
			}
			if got := r.Header.Get("X-User-UI-Request"); got != "1" {
				t.Errorf("login X-User-UI-Request = %q, want 1", got)
			}
			var body struct{ Email, Password string }
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
				body.Email != "ops@example.com" || body.Password != "s3cret" {
				t.Errorf("login body = %+v (err %v), want configured account", body, err)
			}
			w.Header().Set("Content-Type", "application/json")
			// Real platform shape: body enveloped as {code,data}, the web
			// client unwraps it in an axios interceptor.
			_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"access_token":"session-jwt","refresh_token":"r","expires_in":3600,"user":{}}}`))
		case "/api/v1/auth/me":
			if got := r.Header.Get("Authorization"); got != "Bearer session-jwt" {
				t.Errorf("Authorization = %q, want session token, never the stale manual token", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"balance":66.5}}`))
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	checker := &balanceProfileChecker{providerKey: "ccgo", tokens: newSupplierTokenCache(), cfg: config.BearerProfileBalanceConfig{
		Enabled: true, Name: "CCGO", BaseURL: server.URL, Email: "ops@example.com", Password: "s3cret",
		AccessToken: "stale-manual-token", Timezone: "Asia/Shanghai", Currency: "USD", UIRequest: true,
	}}
	for i := 0; i < 2; i++ {
		reading, err := checker.read(context.Background(), server.Client())
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		if reading.Balance != 66.5 {
			t.Errorf("read %d balance = %v, want 66.5", i, reading.Balance)
		}
	}
	if got := loginCount.Load(); got != 1 {
		t.Errorf("login count = %d, want a single cached login for both reads", got)
	}
}

func TestBalanceProfileCheckerRetriesOnceAfterSessionRevoked(t *testing.T) {
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/login":
			n := loginCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			// Bare top-level shape: covers the fallback parse path for
			// deployments that answer without the {code,data} envelope.
			_, _ = w.Write([]byte(`{"access_token":"session-` + strconv.FormatInt(n, 10) + `","expires_in":3600}`))
		case "/api/v1/auth/me":
			if r.Header.Get("Authorization") == "Bearer session-1" {
				http.Error(w, `{"code":401,"message":"token revoked"}`, http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"balance":12}}`))
		}
	}))
	defer server.Close()

	checker := &balanceProfileChecker{providerKey: "mikoto", tokens: newSupplierTokenCache(), cfg: config.BearerProfileBalanceConfig{
		Enabled: true, BaseURL: server.URL, Email: "ops@example.com", Password: "s3cret",
		Timezone: "Asia/Shanghai", Currency: "USD",
	}}
	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 12 {
		t.Errorf("balance = %v, want 12 after one forced re-login", reading.Balance)
	}
	if got := loginCount.Load(); got != 2 {
		t.Errorf("login count = %d, want exactly 2 (initial + forced refresh)", got)
	}
}

func TestBalanceProfileCheckerBacksOffAfterCredentialRejection(t *testing.T) {
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/login" {
			t.Errorf("unexpected request path %s, profile must not be queried without a session", r.URL.Path)
		}
		loginCount.Add(1)
		http.Error(w, `{"code":401,"message":"invalid email or password","reason":"INVALID_CREDENTIALS"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	checker := &balanceProfileChecker{providerKey: "mikoto", tokens: newSupplierTokenCache(), cfg: config.BearerProfileBalanceConfig{
		Enabled: true, BaseURL: server.URL, Email: "ops@example.com", Password: "wrong",
		Timezone: "Asia/Shanghai", Currency: "USD",
	}}
	for i := 0; i < 3; i++ {
		_, err := checker.read(context.Background(), server.Client())
		if err == nil || !strings.Contains(err.Error(), "登录失败") {
			t.Fatalf("read %d error = %v, want login failure", i, err)
		}
	}
	if got := loginCount.Load(); got != 1 {
		t.Errorf("login count = %d, want 1 — rejected credentials must back off, not hammer the login endpoint", got)
	}
}

func TestDimensioBalanceCheckerLogsInWithUsername(t *testing.T) {
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/login":
			loginCount.Add(1)
			var body struct{ Username, Password string }
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
				body.Username != "dim-user" || body.Password != "dim-pass" {
				t.Errorf("login body = %+v (err %v), want configured account", body, err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"token":"dim-session"}`))
		case "/api/user/dashboard":
			if got := r.Header.Get("Authorization"); got != "Bearer dim-session" {
				t.Errorf("Authorization = %q, want session token", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"creditBudget":1000,"creditUsed":250}`))
		}
	}))
	defer server.Close()

	checker := &dimensioBalanceChecker{providerKey: "dimensio", tokens: newSupplierTokenCache(), cfg: config.DimensioBalanceConfig{
		Enabled: true, BaseURL: server.URL, Username: "dim-user", Password: "dim-pass", Unit: "积分",
	}}
	for i := 0; i < 2; i++ {
		reading, err := checker.read(context.Background(), server.Client())
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		if reading.Balance != 750 {
			t.Errorf("read %d balance = %v, want 750", i, reading.Balance)
		}
	}
	if got := loginCount.Load(); got != 1 {
		t.Errorf("login count = %d, want a single cached login", got)
	}
}

func TestSupplierCredentialIssueRequiresAccountOrToken(t *testing.T) {
	cases := []struct {
		account, password, token, want string
	}{
		{"", "", "", "缺少账号密码或访问令牌"},
		{"a@b.c", "", "", "已填写登录邮箱但缺少登录密码"},
		{"", "pw", "", "已填写登录密码但缺少登录邮箱"},
		{"", "", "jwt", ""},
		{"a@b.c", "pw", "", ""},
		{"a@b.c", "pw", "jwt", ""},
	}
	for _, tc := range cases {
		if got := supplierCredentialIssue(tc.account, tc.password, tc.token, "登录邮箱"); got != tc.want {
			t.Errorf("supplierCredentialIssue(%q,%q,%q) = %q, want %q", tc.account, tc.password, tc.token, got, tc.want)
		}
	}
}

func TestSupplierSessionExpiryPrefersDeclaredLifetimeThenJWTClaim(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	if got := supplierSessionExpiry(now, 3600, "opaque"); got != now.Add(time.Hour-time.Minute) {
		t.Errorf("declared lifetime expiry = %v, want one hour minus safety margin", got)
	}
	exp := now.Add(30 * time.Minute)
	payload, _ := json.Marshal(map[string]int64{"exp": exp.Unix()})
	jwt := "h." + base64.RawURLEncoding.EncodeToString(payload) + ".s"
	if got := supplierSessionExpiry(now, 0, jwt); got != exp.Add(-time.Minute) {
		t.Errorf("jwt claim expiry = %v, want claim minus safety margin", got)
	}
	if got := supplierSessionExpiry(now, 0, "not-a-jwt"); got != now.Add(10*time.Minute) {
		t.Errorf("fallback expiry = %v, want conservative 10 minutes", got)
	}
}

func TestBearerAuthorizationAcceptsRawOrPrefixedToken(t *testing.T) {
	if got := bearerAuthorization("abc"); got != "Bearer abc" {
		t.Errorf("raw token authorization = %q", got)
	}
	if got := bearerAuthorization("bearer abc"); got != "bearer abc" {
		t.Errorf("prefixed token authorization = %q", got)
	}
}

func TestSupplierBalanceMonitorKeepsCCGOAccountsSeparate(t *testing.T) {
	monitor := newSupplierBalanceMonitorWithClient(config.BalanceMonitorConfig{}, http.DefaultClient)
	checkers, err := monitor.currentCheckers()
	if err != nil {
		t.Fatalf("current checkers: %v", err)
	}
	keys := make(map[string]bool, len(checkers))
	for _, checker := range checkers {
		keys[checker.key()] = true
	}
	if !keys["ccgo"] || !keys["ccgo2"] || len(keys) != len(checkers) {
		t.Fatalf("checker keys = %v, want unique ccgo and ccgo2 rows", keys)
	}
}

func TestSupplierBalanceMonitorKeepsLastSuccessOnFailure(t *testing.T) {
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if fail.Load() {
			http.Error(w, "temporary", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"quota":1500000}}`))
	}))
	defer server.Close()

	cfg := config.BalanceMonitorConfig{RefreshSeconds: 30, DLAPI: config.NewAPIBalanceConfig{
		Enabled: true, Name: "DLAPI", BaseURL: server.URL, UserID: "245",
		AccessToken: "token", QuotaPerUnit: 500000, Currency: "USD", LowBalance: 2,
	}}
	monitor := newSupplierBalanceMonitorWithClient(cfg, server.Client())

	first := monitor.snapshot(context.Background()).Suppliers[0]
	if first.State != "healthy" || first.Balance == nil || *first.Balance != 3 {
		t.Fatalf("first snapshot = %+v, want healthy balance 3", first)
	}

	fail.Store(true)
	second := monitor.snapshot(context.Background()).Suppliers[0]
	if second.State != "error" || !second.Stale {
		t.Fatalf("second snapshot state = %q stale=%v, want error + stale", second.State, second.Stale)
	}
	if second.Balance == nil || *second.Balance != 3 || second.LastSuccessAt == "" {
		t.Fatalf("second snapshot did not retain last success: %+v", second)
	}
}

func TestSupplierBalanceMonitorReportsMissingTokenWithoutRequest(t *testing.T) {
	cfg := config.BalanceMonitorConfig{RefreshSeconds: 30, DLAPI: config.NewAPIBalanceConfig{
		Enabled: true, Name: "DLAPI", BaseURL: "https://api.dlapi.xyz", UserID: "245",
		QuotaPerUnit: 500000, Currency: "USD",
	}}
	monitor := newSupplierBalanceMonitorWithClient(cfg, http.DefaultClient)
	row := monitor.snapshot(context.Background()).Suppliers[0]
	if row.State != "unconfigured" {
		t.Fatalf("state = %q, want unconfigured", row.State)
	}
	if row.Message != "缺少账号密码或访问令牌" {
		t.Errorf("message = %q, want missing-credential message", row.Message)
	}
}

func TestSupplierBalanceMonitorReloadsDatabaseTokenForEverySnapshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		balance := 50.0
		switch r.Header.Get("Authorization") {
		case "Bearer first-token":
		case "Bearer second-token":
			balance = 22
		default:
			http.Error(w, "unexpected token", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"balance":` +
			strconv.FormatFloat(balance, 'f', -1, 64) + `}}`))
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	rows := []model.SysConfig{
		{ConfigKey: model.ConfigKeyBalanceMikotoEnabled, ConfigValue: "1"},
		{ConfigKey: model.ConfigKeyBalanceMikotoAccessToken, ConfigValue: "first-token"},
		{ConfigKey: model.ConfigKeyBalanceMikotoLowBalance, ConfigValue: "25"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed supplier config: %v", err)
	}

	cfg := config.BalanceMonitorConfig{RefreshSeconds: 30, Mikoto: config.BearerProfileBalanceConfig{
		Enabled: false, Name: "Mikoto", BaseURL: server.URL, AccessToken: "legacy-env-token",
		Timezone: "Asia/Shanghai", Currency: "USD",
	}}
	monitor := newSupplierBalanceMonitorWithDBAndClient(db, cfg, server.Client())

	first := monitor.snapshot(context.Background()).Suppliers[1]
	if first.State != "healthy" || first.Balance == nil || *first.Balance != 50 {
		t.Fatalf("first snapshot = %+v, want live DB token with balance 50", first)
	}
	if err := db.Model(&model.SysConfig{}).
		Where("config_key = ?", model.ConfigKeyBalanceMikotoAccessToken).
		Update("config_value", "second-token").Error; err != nil {
		t.Fatalf("rotate token: %v", err)
	}

	second := monitor.snapshot(context.Background()).Suppliers[1]
	if second.State != "low" || second.Balance == nil || *second.Balance != 22 {
		t.Fatalf("second snapshot = %+v, want rotated token with low balance 22", second)
	}
	if err := db.Model(&model.SysConfig{}).
		Where("config_key = ?", model.ConfigKeyBalanceMikotoAccessToken).
		Update("config_value", "invalid-new-account-token").Error; err != nil {
		t.Fatalf("replace token with invalid account: %v", err)
	}
	third := monitor.snapshot(context.Background()).Suppliers[1]
	if third.State != "error" || third.Stale || third.Balance != nil {
		t.Fatalf("third snapshot = %+v, must not reuse another credential's cached balance", third)
	}
}

func TestSupplierBalanceMonitorNeverFallsBackToLegacyEnvironmentCredentials(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}

	legacy := config.BalanceMonitorConfig{
		DLAPI:       config.NewAPIBalanceConfig{Enabled: true, AccessToken: "legacy-dlapi", UserID: "245", LowBalance: 10},
		Mikoto:      config.BearerProfileBalanceConfig{Enabled: true, AccessToken: "legacy-mikoto", Email: "legacy@a", Password: "legacy", LowBalance: 10},
		CCGO:        config.BearerProfileBalanceConfig{Enabled: true, AccessToken: "legacy-ccgo", Email: "legacy@a", Password: "legacy", LowBalance: 10},
		CCGO2:       config.BearerProfileBalanceConfig{Enabled: true, AccessToken: "legacy-ccgo2", Email: "legacy@a", Password: "legacy", LowBalance: 10},
		Dimensio:    config.DimensioBalanceConfig{Enabled: true, AccessToken: "legacy-dimensio", Username: "legacy", Password: "legacy", LowBalance: 10},
		Uniart:      config.NewAPIBalanceConfig{Enabled: true, AccessToken: "legacy-uniart", UserID: "1", LowBalance: 10},
		Wxart:       config.NewAPIBalanceConfig{Enabled: true, AccessToken: "legacy-wxart", UserID: "1", LowBalance: 10},
		SecureSkill: config.BearerProfileBalanceConfig{Enabled: true, AccessToken: "legacy-secureskill", Email: "legacy@a", Password: "legacy", LowBalance: 10},
	}
	live, err := loadLiveSupplierBalanceConfig(db, legacy)
	if err != nil {
		t.Fatalf("load live config: %v", err)
	}
	if live.DLAPI.Enabled || live.DLAPI.AccessToken != "" || live.DLAPI.LowBalance != 0 ||
		live.DLAPI.UserID != "" ||
		live.Mikoto.Enabled || live.Mikoto.AccessToken != "" || live.Mikoto.LowBalance != 0 ||
		live.Mikoto.Email != "" || live.Mikoto.Password != "" ||
		live.CCGO.Enabled || live.CCGO.AccessToken != "" || live.CCGO.LowBalance != 0 ||
		live.CCGO.Email != "" || live.CCGO.Password != "" ||
		live.CCGO2.Enabled || live.CCGO2.AccessToken != "" || live.CCGO2.LowBalance != 0 ||
		live.CCGO2.Email != "" || live.CCGO2.Password != "" ||
		live.Dimensio.Enabled || live.Dimensio.AccessToken != "" || live.Dimensio.LowBalance != 0 ||
		live.Dimensio.Username != "" || live.Dimensio.Password != "" ||
		live.Uniart.Enabled || live.Uniart.AccessToken != "" || live.Uniart.LowBalance != 0 ||
		live.Uniart.UserID != "" ||
		live.Wxart.Enabled || live.Wxart.AccessToken != "" || live.Wxart.LowBalance != 0 ||
		live.Wxart.UserID != "" ||
		live.SecureSkill.Enabled || live.SecureSkill.AccessToken != "" || live.SecureSkill.LowBalance != 0 ||
		live.SecureSkill.Email != "" || live.SecureSkill.Password != "" {
		t.Fatalf("legacy dynamic values survived database overlay: %+v", live)
	}
}

func TestWxartBalanceCheckerConvertsQuotaWithoutUserIDHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/user/self" {
			t.Errorf("request path = %s, want /api/user/self", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "wxart-system-token" {
			t.Errorf("Authorization = %q, want exact configured token", got)
		}
		if _, present := r.Header["New-Api-User"]; present {
			t.Error("New-Api-User header must be omitted when no user id is configured")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"quota":27795,"used_quota":2205}}`))
	}))
	defer server.Close()

	checker := &newAPIBalanceChecker{providerKey: "wxart", cfg: config.NewAPIBalanceConfig{
		Enabled: true, Name: "wxart", BaseURL: server.URL,
		AccessToken: "wxart-system-token", QuotaPerUnit: 100, Currency: "R",
	}}
	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 277.95 {
		t.Errorf("balance = %v, want 277.95 (quota/100)", reading.Balance)
	}
	if reading.Currency != "R" {
		t.Errorf("currency = %q, want R", reading.Currency)
	}
	if len(reading.Details) != 1 || reading.Details[0].Value != 22.05 {
		t.Errorf("details = %+v, want cumulative usage 22.05", reading.Details)
	}
}

func TestSupplierBalanceMonitorReadsDLAPIFromDatabase(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "sk-dlapi-db-token" {
			t.Errorf("Authorization = %q, want exact configured token", got)
		}
		if got := r.Header.Get("New-Api-User"); got != "245" {
			t.Errorf("New-Api-User = %q, want 245", got)
		}
		w.Header().Set("Content-Type", "application/json")
		// 25_000_000 / 500_000 = 50 USD，须高于下面 seeded 的 20 USD 预警线，
		// 否则快照状态是 low 而非 healthy。
		_, _ = w.Write([]byte(`{"success":true,"data":{"quota":25000000}}`))
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	rows := []model.SysConfig{
		{ConfigKey: model.ConfigKeyBalanceDLAPIEnabled, ConfigValue: "1"},
		{ConfigKey: model.ConfigKeyBalanceDLAPIUserID, ConfigValue: "245"},
		{ConfigKey: model.ConfigKeyBalanceDLAPIAccessToken, ConfigValue: "sk-dlapi-db-token"},
		{ConfigKey: model.ConfigKeyBalanceDLAPILowBalance, ConfigValue: "20"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed supplier config: %v", err)
	}

	cfg := config.BalanceMonitorConfig{RefreshSeconds: 30, DLAPI: config.NewAPIBalanceConfig{
		Name: "DLAPI", BaseURL: server.URL, QuotaPerUnit: 500000, Currency: "USD",
	}}
	monitor := newSupplierBalanceMonitorWithDBAndClient(db, cfg, server.Client())

	row := monitor.snapshot(context.Background()).Suppliers[0]
	if row.Key != "dlapi" || row.State != "healthy" || row.Balance == nil || *row.Balance != 50 {
		t.Fatalf("snapshot = %+v, want healthy DLAPI balance 50 via sys_config credentials", row)
	}
}

func TestSupplierBalanceMonitorReadsUniartFromDatabase(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/user/self" {
			t.Errorf("request path = %s, want /api/user/self", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "uniart-system-token" {
			t.Errorf("Authorization = %q, want exact configured token", got)
		}
		if got := r.Header.Get("New-Api-User"); got != "42" {
			t.Errorf("New-Api-User = %q, want 42", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"quota":237000000,"used_quota":55000000}}`))
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	rows := []model.SysConfig{
		{ConfigKey: model.ConfigKeyBalanceUniartEnabled, ConfigValue: "1"},
		{ConfigKey: model.ConfigKeyBalanceUniartUserID, ConfigValue: "42"},
		{ConfigKey: model.ConfigKeyBalanceUniartAccessToken, ConfigValue: "uniart-system-token"},
		{ConfigKey: model.ConfigKeyBalanceUniartLowBalance, ConfigValue: "100"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed supplier config: %v", err)
	}

	cfg := config.BalanceMonitorConfig{RefreshSeconds: 30, Uniart: config.NewAPIBalanceConfig{
		Name: "Uniart", BaseURL: server.URL, QuotaPerUnit: 500000, Currency: "USD",
	}}
	monitor := newSupplierBalanceMonitorWithDBAndClient(db, cfg, server.Client())

	row := monitor.snapshot(context.Background()).Suppliers[5]
	if row.Key != "uniart" {
		t.Fatalf("supplier key = %q, want uniart as the last row", row.Key)
	}
	if row.State != "healthy" || row.Balance == nil || *row.Balance != 474 {
		t.Fatalf("snapshot = %+v, want healthy balance 474 (quota/quotaPerUnit)", row)
	}
	if row.LowBalance == nil || *row.LowBalance != 100 {
		t.Errorf("lowBalance = %v, want 100 from sys_config", row.LowBalance)
	}
}

func TestSupplierBalanceMonitorLogsInWithDatabaseAccount(t *testing.T) {
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/login":
			loginCount.Add(1)
			var body struct{ Email, Password string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Email != "db@example.com" || body.Password != "db-pass" {
				http.Error(w, `{"code":401,"message":"invalid email or password"}`, http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"access_token":"db-session","expires_in":3600}}`))
		case "/api/v1/auth/me":
			if r.Header.Get("Authorization") != "Bearer db-session" {
				http.Error(w, "unexpected token", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":0,"message":"success","data":{"balance":77}}`))
		}
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	rows := []model.SysConfig{
		{ConfigKey: model.ConfigKeyBalanceMikotoEnabled, ConfigValue: "1"},
		{ConfigKey: model.ConfigKeyBalanceMikotoEmail, ConfigValue: "db@example.com"},
		{ConfigKey: model.ConfigKeyBalanceMikotoPassword, ConfigValue: "db-pass"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed supplier config: %v", err)
	}

	cfg := config.BalanceMonitorConfig{RefreshSeconds: 30, Mikoto: config.BearerProfileBalanceConfig{
		Name: "Mikoto", BaseURL: server.URL, Timezone: "Asia/Shanghai", Currency: "USD",
	}}
	monitor := newSupplierBalanceMonitorWithDBAndClient(db, cfg, server.Client())

	for i := 0; i < 2; i++ {
		row := monitor.snapshot(context.Background()).Suppliers[1]
		if row.State != "healthy" || row.Balance == nil || *row.Balance != 77 {
			t.Fatalf("snapshot %d = %+v, want healthy balance 77 via auto-login", i, row)
		}
	}
	if got := loginCount.Load(); got != 1 {
		t.Errorf("login count = %d, want session reused across snapshots", got)
	}
}

func TestSupplierBalanceMonitorReportsDatabaseConfigFailureAccurately(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close sql db: %v", err)
	}

	monitor := newSupplierBalanceMonitorWithDBAndClient(db, config.BalanceMonitorConfig{}, http.DefaultClient)
	rows := monitor.snapshot(context.Background()).Suppliers
	if len(rows) != 8 {
		t.Fatalf("supplier rows = %d, want 8", len(rows))
	}
	for _, row := range rows {
		if row.State != "error" || row.Message != "无法读取监控配置" || row.Balance != nil || row.Stale {
			t.Errorf("database failure row = %+v", row)
		}
	}
}

func TestSupplierBalanceMonitorLogsInUniartWithDatabaseAccount(t *testing.T) {
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/user/login":
			loginCount.Add(1)
			var body struct{ Username, Password string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.Header().Set("Content-Type", "application/json")
			if body.Username != "ops-uniart" || body.Password != "uniart-pass" {
				_, _ = w.Write([]byte(`{"success":false,"message":"Username or password is incorrect"}`))
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "uniart-sess", MaxAge: 3600})
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":42,"username":"ops-uniart"}}`))
		case "/api/user/self":
			w.Header().Set("Content-Type", "application/json")
			cookie, err := r.Cookie("session")
			if err != nil || cookie.Value != "uniart-sess" {
				_, _ = w.Write([]byte(`{"success":false,"message":"无权进行此操作，未登录且未提供 access token"}`))
				return
			}
			if got := r.Header.Get("New-Api-User"); got != "42" {
				t.Errorf("New-Api-User = %q, want 42 from the login response id", got)
			}
			if got := r.Header.Get("Authorization"); got != "" {
				t.Errorf("Authorization = %q, want empty on the session path", got)
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"quota":210000000,"used_quota":55000000}}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	// userId 故意留空：会话路径应直接使用登录响应里的 id。
	rows := []model.SysConfig{
		{ConfigKey: model.ConfigKeyBalanceUniartEnabled, ConfigValue: "1"},
		{ConfigKey: model.ConfigKeyBalanceUniartUsername, ConfigValue: "ops-uniart"},
		{ConfigKey: model.ConfigKeyBalanceUniartPassword, ConfigValue: "uniart-pass"},
		{ConfigKey: model.ConfigKeyBalanceUniartLowBalance, ConfigValue: "100"},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed supplier config: %v", err)
	}

	cfg := config.BalanceMonitorConfig{RefreshSeconds: 30, Uniart: config.NewAPIBalanceConfig{
		Name: "Uniart", BaseURL: server.URL, QuotaPerUnit: 500000, Currency: "USD",
	}}
	monitor := newSupplierBalanceMonitorWithDBAndClient(db, cfg, server.Client())

	row := monitor.snapshot(context.Background()).Suppliers[5]
	if row.Key != "uniart" || row.State != "healthy" || row.Balance == nil || *row.Balance != 420 {
		t.Fatalf("snapshot = %+v, want healthy Uniart balance 420 via database account login", row)
	}
	if loginCount.Load() != 1 {
		t.Errorf("login count = %d, want exactly one login", loginCount.Load())
	}

	// 第二次快照必须复用缓存的会话，而不是重新登录。
	row = monitor.snapshot(context.Background()).Suppliers[5]
	if row.State != "healthy" {
		t.Fatalf("second snapshot state = %q, want healthy from cached session", row.State)
	}
	if loginCount.Load() != 1 {
		t.Errorf("login count after cached snapshot = %d, want still 1", loginCount.Load())
	}
}

func TestNewAPIBalanceCheckerReloginsOnceAfterSessionRevoked(t *testing.T) {
	// New API 把失效会话报成 HTTP 200 {success:false}（部分分支报 401），
	// 两种拒绝都应丢弃缓存会话并恰好重登一次。
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/user/login":
			n := loginCount.Add(1)
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "sess-" + strconv.FormatInt(n, 10), MaxAge: 3600})
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":7}}`))
		case "/api/user/self":
			cookie, err := r.Cookie("session")
			if err != nil || cookie.Value != "sess-2" {
				_, _ = w.Write([]byte(`{"success":false,"message":"Unauthorized, invalid access token"}`))
				return
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"quota":500000}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	checker := &newAPIBalanceChecker{providerKey: "uniart", cfg: config.NewAPIBalanceConfig{
		Enabled: true, BaseURL: server.URL, Username: "ops", Password: "pw", QuotaPerUnit: 500000,
	}, tokens: newSupplierTokenCache()}

	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read after revoked session: %v", err)
	}
	if reading.Balance != 1 {
		t.Errorf("balance = %v, want 1", reading.Balance)
	}
	if loginCount.Load() != 2 {
		t.Errorf("login count = %d, want 2 (initial + one relogin)", loginCount.Load())
	}
}

func TestNewAPIBalanceCheckerUsesLoginAccessTokenWhenPanelIssuesJWT(t *testing.T) {
	// 现行 new-api 的登录不下发会话 Cookie：凭证是 data.access_token 里的
	// 短时 JWT（附带的 new_api_refresh Cookie 仅限 /api/user/auth 路径，
	// /api/user/self 不认）。监控必须改用 Bearer JWT，用户 id 在 data.user 下。
	var loginCount atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/user/login":
			loginCount.Add(1)
			http.SetCookie(w, &http.Cookie{Name: "new_api_refresh", Value: "refresh-only", Path: "/api/user/auth", MaxAge: 2591999})
			_, _ = w.Write([]byte(`{"success":true,"data":{"access_token":"panel-jwt","access_expires_at":` +
				strconv.FormatInt(time.Now().Add(15*time.Minute).Unix(), 10) +
				`,"token_type":"Bearer","user":{"id":44,"username":"ops"}}}`))
		case "/api/user/self":
			if got := r.Header.Get("Authorization"); got != "Bearer panel-jwt" {
				t.Errorf("Authorization = %q, want Bearer panel-jwt from the login body", got)
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"success":false,"message":"unauthorized"}`))
				return
			}
			if got := r.Header.Get("New-Api-User"); got != "44" {
				t.Errorf("New-Api-User = %q, want 44 from data.user.id", got)
			}
			_, _ = w.Write([]byte(`{"success":true,"data":{"quota":213000000}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	checker := &newAPIBalanceChecker{providerKey: "uniart", cfg: config.NewAPIBalanceConfig{
		Enabled: true, BaseURL: server.URL, Username: "ops", Password: "pw", QuotaPerUnit: 500000,
	}, tokens: newSupplierTokenCache()}

	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 426 {
		t.Errorf("balance = %v, want 426", reading.Balance)
	}
	if loginCount.Load() != 1 {
		t.Errorf("login count = %d, want 1", loginCount.Load())
	}

	// 缓存的 JWT 未过期时第二次读取不得重新登录。
	if _, err := checker.read(context.Background(), server.Client()); err != nil {
		t.Fatalf("second read: %v", err)
	}
	if loginCount.Load() != 1 {
		t.Errorf("login count after cached read = %d, want still 1", loginCount.Load())
	}
}

func TestDecodeSupplierLoginFailureBacksOffLongOnRateLimit(t *testing.T) {
	resp := &http.Response{StatusCode: http.StatusTooManyRequests, Body: http.NoBody}
	err := decodeSupplierLoginFailure(resp)
	loginErr, ok := err.(*supplierLoginError)
	if !ok {
		t.Fatalf("error type = %T, want *supplierLoginError", err)
	}
	if !loginErr.rateLimited {
		t.Error("429 must take the 20-minute backoff, or every 1-minute retry renews the rate-limit window")
	}
	if !strings.Contains(loginErr.message, "限流") {
		t.Errorf("message = %q, want rate-limit wording", loginErr.message)
	}
}
