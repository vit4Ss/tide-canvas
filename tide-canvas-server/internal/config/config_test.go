package config

import (
	"strings"
	"testing"
	"time"
)

func TestLocalVideoDownloaderConfigOverrides(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_VIDEODOWNLOADER_ENABLED", "false")
	t.Setenv("TIDECANVAS_VIDEODOWNLOADER_MAXFILEBYTES", "12345678")
	t.Setenv("TIDECANVAS_VIDEODOWNLOADER_MAXCONCURRENT", "3")
	t.Setenv("TIDECANVAS_VIDEODOWNLOADER_DOWNLOADTIMEOUT", "9m")
	t.Setenv("TIDECANVAS_VIDEODOWNLOADER_COMMAND", "/opt/tools/yt-dlp")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.VideoDownloader.Enabled || cfg.VideoDownloader.MaxFileBytes != 12345678 || cfg.VideoDownloader.MaxConcurrent != 3 || cfg.VideoDownloader.DownloadTimeout != 9*time.Minute || cfg.VideoDownloader.Command != "/opt/tools/yt-dlp" {
		t.Fatalf("local downloader overrides lost: %+v", cfg.VideoDownloader)
	}
}

// Load() searches "../../configs" from this package directory, so these tests
// exercise the real config.yaml + config.<env>.yaml layering.

func TestLoadDefaultsToTestEnv(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "")
	t.Setenv("TIDECANVAS_RELAY_BASEURL", prodRelayBaseURL)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Env != EnvTest {
		t.Errorf("Env = %q, want %q", cfg.Env, EnvTest)
	}
	if cfg.IsProd() {
		t.Error("IsProd() = true for default env")
	}
	if cfg.Server.Mode != "debug" {
		t.Errorf("Server.Mode = %q, want debug (config.test.yaml overlay)", cfg.Server.Mode)
	}
	if cfg.Relay.BaseURL != testRelayBaseURL {
		t.Errorf("Relay.BaseURL = %q, want environment-pinned test relay %q", cfg.Relay.BaseURL, testRelayBaseURL)
	}
	if !cfg.Storage.AccelerateEnabled {
		t.Error("test overlay should preserve existing transfer acceleration by default")
	}
}

func TestLoadWorldLabsCredentialAndPollingPolicyFromEnv(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_WORLDLABS_APIKEY", "unit-test-world-key")
	t.Setenv("TIDECANVAS_WORLDLABS_POLLINTERVAL", "2s")
	t.Setenv("TIDECANVAS_WORLDLABS_TIMEOUT", "9m")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.WorldLabs.APIKey != "unit-test-world-key" || cfg.WorldLabs.BaseURL != "https://api.worldlabs.ai" {
		t.Fatalf("World Labs config = %+v", cfg.WorldLabs)
	}
	if cfg.WorldLabs.PollInterval != 2*time.Second || cfg.WorldLabs.Timeout != 9*time.Minute {
		t.Fatalf("World Labs polling config = %+v", cfg.WorldLabs)
	}
}

func TestLoadAllowsDisablingStorageAccelerationFromEnv(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_STORAGE_ACCELERATEENABLED", "false")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Storage.AccelerateEnabled {
		t.Fatal("storage acceleration env switch was ignored")
	}
	if cfg.Storage.AccelerateDomain == "" {
		t.Fatal("disabling acceleration must retain the configured domain for legacy URL recognition")
	}
}

func TestLoadIgnoresLegacyDLAPIEnvironmentCredentials(t *testing.T) {
	// DLAPI dynamic values migrated to sys_config (admin UI); legacy
	// environment variables must be discarded like every other supplier's.
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_DLAPI_ACCESSTOKEN", "unit-test-dlapi-token")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_DLAPI_USERID", "245")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_DLAPI_LOWBALANCE", "12.5")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.BalanceMonitor.DLAPI.Enabled || cfg.BalanceMonitor.DLAPI.AccessToken != "" ||
		cfg.BalanceMonitor.DLAPI.UserID != "" || cfg.BalanceMonitor.DLAPI.LowBalance != 0 {
		t.Fatalf("legacy DLAPI environment values survived normalization: %+v", cfg.BalanceMonitor.DLAPI)
	}
	if cfg.BalanceMonitor.DLAPI.BaseURL == "" || cfg.BalanceMonitor.DLAPI.QuotaPerUnit != 500000 {
		t.Errorf("DLAPI endpoint shape lost: %+v", cfg.BalanceMonitor.DLAPI)
	}
}

func TestLoadIgnoresLegacyDynamicSupplierEnvironmentValues(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_MIKOTO_ENABLED", "true")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_MIKOTO_ACCESSTOKEN", "legacy-mikoto-token")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_MIKOTO_LOWBALANCE", "99")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_CCGO_ACCESSTOKEN", "legacy-ccgo-token")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_CCGO2_ACCESSTOKEN", "legacy-ccgo2-token")
	t.Setenv("TIDECANVAS_BALANCEMONITOR_DIMENSIO_ACCESSTOKEN", "legacy-dimensio-token")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.BalanceMonitor.Mikoto.Enabled || cfg.BalanceMonitor.Mikoto.AccessToken != "" || cfg.BalanceMonitor.Mikoto.LowBalance != 0 ||
		cfg.BalanceMonitor.CCGO.AccessToken != "" || cfg.BalanceMonitor.CCGO2.AccessToken != "" ||
		cfg.BalanceMonitor.Dimensio.AccessToken != "" {
		t.Fatalf("legacy dynamic supplier environment values survived normalization: %+v", cfg.BalanceMonitor)
	}
}

func TestLoadProdRequiresJWTSecret(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "prod")
	t.Setenv("TIDECANVAS_JWT_SECRET", "")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "JWT secret") {
		t.Fatalf("Load with prod + empty JWT secret: err = %v, want JWT secret error", err)
	}
}

func TestLoadProdAppliesOverlay(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "prod")
	t.Setenv("TIDECANVAS_JWT_SECRET", "unit-test-secret")
	t.Setenv("TIDECANVAS_RELAY_APIKEY", "unit-test-prod-relay-key")
	t.Setenv("TIDECANVAS_RELAY_BASEURL", testRelayBaseURL)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.IsProd() {
		t.Error("IsProd() = false for TIDECANVAS_ENV=prod")
	}
	if cfg.Server.Mode != "release" {
		t.Errorf("Server.Mode = %q, want release (config.prod.yaml overlay)", cfg.Server.Mode)
	}
	if cfg.JWT.Secret != "unit-test-secret" {
		t.Errorf("JWT.Secret = %q, want env override to win over files", cfg.JWT.Secret)
	}
	if !strings.HasPrefix(cfg.Eliandapay.NotifyURL, "https://") {
		t.Errorf("Eliandapay.NotifyURL = %q, want https prod URL from overlay", cfg.Eliandapay.NotifyURL)
	}
	if cfg.Relay.BaseURL != prodRelayBaseURL {
		t.Errorf("Relay.BaseURL = %q, want environment-pinned production relay %q", cfg.Relay.BaseURL, prodRelayBaseURL)
	}
	if cfg.Relay.APIKey != "unit-test-prod-relay-key" {
		t.Errorf("Relay.APIKey did not use the production environment override")
	}
	if !cfg.Storage.AccelerateEnabled || cfg.Storage.AccelerateDomain != "flowlinght.oss-accelerate.aliyuncs.com" {
		t.Errorf("production storage acceleration = %v, %q", cfg.Storage.AccelerateEnabled, cfg.Storage.AccelerateDomain)
	}
}

func TestLoadProdRejectsInheritedTestRelayKey(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "prod")
	t.Setenv("TIDECANVAS_JWT_SECRET", "unit-test-secret")
	t.Setenv("TIDECANVAS_RELAY_APIKEY", "")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "relay API key") {
		t.Fatalf("Load with prod + empty relay key: err = %v, want relay API key error", err)
	}
}

func TestLoadRejectsUnknownEnv(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "staging")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "TIDECANVAS_ENV") {
		t.Fatalf("Load with TIDECANVAS_ENV=staging: err = %v, want invalid-env error", err)
	}
}
