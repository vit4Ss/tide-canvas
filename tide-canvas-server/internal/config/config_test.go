package config

import (
	"strings"
	"testing"
)

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
	setProdEmailEnv(t)

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
}

func TestLoadProdRequiresSMTP(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "prod")
	t.Setenv("TIDECANVAS_JWT_SECRET", "unit-test-secret")
	t.Setenv("TIDECANVAS_RELAY_APIKEY", "unit-test-prod-relay-key")
	t.Setenv("TIDECANVAS_EMAIL_ENABLED", "false")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "requires SMTP") {
		t.Fatalf("Load with prod + SMTP disabled: err = %v, want SMTP error", err)
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

func setProdEmailEnv(t *testing.T) {
	t.Helper()
	t.Setenv("TIDECANVAS_EMAIL_ENABLED", "true")
	t.Setenv("TIDECANVAS_EMAIL_HOST", "smtp.example.test")
	t.Setenv("TIDECANVAS_EMAIL_USERNAME", "mailer@example.test")
	t.Setenv("TIDECANVAS_EMAIL_PASSWORD", "unit-test-password")
	t.Setenv("TIDECANVAS_EMAIL_FROMADDRESS", "mailer@example.test")
}
