package admin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"tidecanvas/internal/config"
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
		if r.Method != http.MethodGet || r.URL.Path != "/api/auth/me" {
			t.Errorf("request = %s %s, want GET /api/auth/me", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer dimensio-jwt" {
			t.Errorf("Authorization = %q, want Bearer dimensio-jwt", got)
		}
		if got := r.Header.Get("Referer"); got != "" {
			t.Errorf("Referer = %q, want no browser metadata", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":113,"status":"active","credit_budget":410100,"membership_usage_credits":265018}`))
	}))
	defer server.Close()

	checker := &dimensioBalanceChecker{providerKey: "dimensio", cfg: config.DimensioBalanceConfig{
		Enabled: true, Name: "Dimensio", BaseURL: server.URL, AccessToken: "dimensio-jwt", Unit: "积分",
	}}
	reading, err := checker.read(context.Background(), server.Client())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if reading.Balance != 145082 {
		t.Errorf("balance = %v, want 145082", reading.Balance)
	}
	if len(reading.Details) != 2 || reading.Details[0].Value != 410100 || reading.Details[1].Value != 265018 {
		t.Errorf("details = %+v, want budget and used credits", reading.Details)
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
	keys := make(map[string]bool, len(monitor.checkers))
	for _, checker := range monitor.checkers {
		keys[checker.key()] = true
	}
	if !keys["ccgo"] || !keys["ccgo2"] || len(keys) != len(monitor.checkers) {
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
	if row.Message != "缺少访问令牌" {
		t.Errorf("message = %q, want missing-token message", row.Message)
	}
}
