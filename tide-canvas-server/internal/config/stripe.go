package config

import (
	"fmt"
	"net/url"
	"strings"
)

// StripeConfig is server-only; neither API keys nor signing secrets enter admin VOs.
type StripeConfig struct {
	Enabled       bool   `mapstructure:"enabled"`
	SecretKey     string `mapstructure:"secretKey" json:"-"`
	WebhookSecret string `mapstructure:"webhookSecret" json:"-"`
	SiteURL       string `mapstructure:"siteUrl"`
}

func (s StripeConfig) Validate(env string) error {
	// Operators may fill a disabled integration in stages. An incomplete draft
	// must not stop the shared backend; enabled/fully configured setups validate.
	if !s.Enabled && (s.SecretKey == "" || s.WebhookSecret == "" || s.SiteURL == "") {
		return nil
	}
	mode := "test"
	if env == EnvProd {
		mode = "live"
	}
	key := strings.TrimSpace(s.SecretKey)
	if !(strings.HasPrefix(key, "sk_"+mode+"_") || strings.HasPrefix(key, "rk_"+mode+"_")) {
		return fmt.Errorf("config: Stripe requires a %s server API key for this environment", mode)
	}
	if !strings.HasPrefix(strings.TrimSpace(s.WebhookSecret), "whsec_") {
		return fmt.Errorf("config: Stripe requires a webhook signing secret")
	}
	u, err := url.Parse(s.SiteURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return fmt.Errorf("config: Stripe siteUrl must be an absolute site origin")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(mode == "test" && local && u.Scheme == "http") {
		return fmt.Errorf("config: Stripe siteUrl requires HTTPS (HTTP loopback is allowed in test only)")
	}
	return nil
}
