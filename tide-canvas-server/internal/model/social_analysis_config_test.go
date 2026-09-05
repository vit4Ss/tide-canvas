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
