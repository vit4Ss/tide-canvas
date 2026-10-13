package config

import "testing"

func TestStripeEnvironmentConfiguration(t *testing.T) {
	base := StripeConfig{Enabled: true, SecretKey: "sk_test_fixture", WebhookSecret: "whsec_fixture", SiteURL: "https://test-framelyn.tcmzhan.com"}
	if err := base.Validate("test"); err != nil {
		t.Fatal(err)
	}
	if err := base.Validate("prod"); err == nil {
		t.Fatal("Production accepted test key")
	}
	live := base
	live.SecretKey = "rk_live_fixture"
	live.SiteURL = "https://framelyn.tcmzhan.com"
	if err := live.Validate("prod"); err != nil {
		t.Fatal(err)
	}
	if err := live.Validate("test"); err == nil {
		t.Fatal("Test accepted live key")
	}
	for _, site := range []string{"https://user:password@example.com", "http://framelyn.tcmzhan.com", "https://example.com/path", "https://example.com/?return=evil"} {
		bad := base
		bad.SiteURL = site
		if bad.Validate("test") == nil {
			t.Fatalf("Unsafe return origin accepted: %s", site)
		}
	}
	local := base
	local.SiteURL = "http://localhost:3100"
	if local.Validate("test") != nil {
		t.Fatal("Local test origin rejected")
	}
	empty := StripeConfig{}
	if empty.Validate("prod") != nil {
		t.Fatal("Stripe should default to disabled")
	}
}

func TestStripeEnvironmentOverrides(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_STRIPE_ENABLED", "true")
	t.Setenv("TIDECANVAS_STRIPE_SECRETKEY", "rk_test_fixture")
	t.Setenv("TIDECANVAS_STRIPE_WEBHOOKSECRET", "whsec_fixture")
	t.Setenv("TIDECANVAS_STRIPE_SITEURL", "https://test-framelyn.tcmzhan.com")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Stripe.Enabled || cfg.Stripe.SecretKey != "rk_test_fixture" || cfg.Stripe.WebhookSecret != "whsec_fixture" || cfg.Stripe.SiteURL != "https://test-framelyn.tcmzhan.com" {
		t.Fatal("Stripe runtime overrides were not loaded")
	}
}

func TestStripeCredentialsAreNormalizedBeforeUse(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_STRIPE_ENABLED", "true")
	t.Setenv("TIDECANVAS_STRIPE_SECRETKEY", "  sk_test_fixture\n")
	t.Setenv("TIDECANVAS_STRIPE_WEBHOOKSECRET", " whsec_fixture ")
	t.Setenv("TIDECANVAS_STRIPE_SITEURL", "https://test-framelyn.tcmzhan.com")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Stripe.SecretKey != "sk_test_fixture" || cfg.Stripe.WebhookSecret != "whsec_fixture" {
		t.Fatal("Validation accepted trimmed keys but runtime still uses whitespace")
	}
}

func TestStripeDisabledDraftDoesNotBlockSharedBackend(t *testing.T) {
	draft := StripeConfig{SecretKey: "sk_test_fixture"}
	if err := draft.Validate("test"); err != nil {
		t.Fatalf("An incomplete disabled integration blocked the shared backend: %v", err)
	}
	draft.Enabled = true
	if err := draft.Validate("test"); err == nil {
		t.Fatal("An enabled integration accepted missing webhook/site settings")
	}
}
