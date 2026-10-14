package config

import (
	"fmt"
	"net/url"
	"strings"
)

// The RSA private key lives only in the SDK adapter, never in API responses.
type PancakeConfig struct {
	PromptScreening bool   `mapstructure:"promptScreening"` // Framelyn /api/en generation routes only.
	Enabled         bool   `mapstructure:"enabled"`
	AdapterURL      string `mapstructure:"adapterUrl"`
	InternalToken   string `mapstructure:"internalToken" json:"-"`
	StoreID         string `mapstructure:"storeId"`
	ProductID       string `mapstructure:"productId"`
	SiteURL         string `mapstructure:"siteUrl"`
}

func (p PancakeConfig) Configured() bool {
	return p.AdapterURL != "" && len(p.InternalToken) >= 32 && strings.HasPrefix(p.StoreID, "STO_") && strings.HasPrefix(p.ProductID, "PROD_") && p.SiteURL != ""
}
func (p PancakeConfig) Validate(env string) error {
	if !p.Enabled && !p.PromptScreening && !p.Configured() {
		return nil
	}
	if !p.Configured() {
		return fmt.Errorf("config: Pancake requires adapter, internal token, store, product and site URL")
	}
	u, err := url.Parse(p.AdapterURL)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return fmt.Errorf("config: Pancake adapter must use HTTP loopback")
	}
	site, err := url.Parse(p.SiteURL)
	if err != nil || site.Host == "" || site.User != nil || site.RawQuery != "" || site.Fragment != "" || (site.Path != "" && site.Path != "/") {
		return fmt.Errorf("config: Pancake siteUrl must be an absolute site origin")
	}
	local := site.Hostname() == "localhost" || site.Hostname() == "127.0.0.1" || site.Hostname() == "::1"
	if site.Scheme != "https" && !(env == EnvTest && local && site.Scheme == "http") {
		return fmt.Errorf("config: Pancake siteUrl requires HTTPS (HTTP loopback is allowed in test only)")
	}
	return nil
}
