package model

import "testing"

func TestSocialPriceRequiresPositiveBoundedInteger(t *testing.T) {
	for _, raw := range []string{"", "0", "-1", "1.5", "1e2", " 1", "+1", "100001", "9999999999999999999999"} {
		if _, ok := ParseSocialPointCost(raw); ok {
			t.Fatalf("accepted invalid price %q", raw)
		}
	}
	for _, raw := range []string{"1", "12", "100000"} {
		if _, ok := ParseSocialPointCost(raw); !ok {
			t.Fatalf("rejected price %q", raw)
		}
	}
}

func TestSocialDownloadDailyLimitConfiguration(t *testing.T) {
	for _, raw := range []string{"", "0", "-1", "1.5", "1e2", " 1", "+1", "100001"} {
		if _, ok := ParseSocialDownloadDailyLimit(raw); ok {
			t.Fatalf("accepted %q", raw)
		}
	}
	found := false
	for _, cfg := range SocialAnalysisBaselineConfigs() {
		if cfg.ConfigKey == ConfigKeySocialDownloadDailyLimit {
			found = cfg.ConfigValue == "1"
		}
	}
	if !found {
		t.Fatal("missing default one-download-per-day configuration")
	}
}
