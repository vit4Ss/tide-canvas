package config

import (
	"strings"
	"testing"
)

func TestPancakeRuntimeEnvironment(t *testing.T) {
	t.Setenv("TIDECANVAS_ENV", "test")
	t.Setenv("TIDECANVAS_PANCAKE_ENABLED", "true")
	t.Setenv("TIDECANVAS_PANCAKE_INTERNALTOKEN", strings.Repeat("x", 32))
	t.Setenv("TIDECANVAS_PANCAKE_STOREID", "STO_test")
	t.Setenv("TIDECANVAS_PANCAKE_PRODUCTID", "PROD_test")
	t.Setenv("TIDECANVAS_PANCAKE_SITEURL", "http://localhost:3100")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Pancake.Enabled || cfg.Pancake.StoreID != "STO_test" {
		t.Fatal("environment overrides not loaded")
	}
	if cfg.Pancake.Validate("prod") == nil {
		t.Fatal("production accepted localhost")
	}
	cfg.Pancake.AdapterURL = "https://external.test"
	if cfg.Pancake.Validate("test") == nil {
		t.Fatal("external credential forwarding allowed")
	}
}
