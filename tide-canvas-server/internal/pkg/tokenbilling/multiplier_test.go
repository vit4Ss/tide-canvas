package tokenbilling

import (
	"errors"
	"testing"
)

const listedPricing = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300","cachedInputPointsPerMillion":"20","maxInputTokens":1000,"maxOutputTokens":500}}`

func TestAMultiplierScalesEveryRateAndLeavesTheLimitsAlone(t *testing.T) {
	listed, err := Parse(listedPricing)
	if err != nil {
		t.Fatal(err)
	}
	m, err := ParseMultiplier("0.7")
	if err != nil {
		t.Fatal(err)
	}
	scaled, err := listed.Scaled(m)
	if err != nil {
		t.Fatal(err)
	}
	if scaled.Input != "70" || scaled.Output != "210" || scaled.CachedInput != "14" {
		t.Fatalf("rates were not scaled by 0.7: %+v", scaled)
	}
	if scaled.MaxInput != 1000 || scaled.MaxOutput != 500 {
		t.Fatalf("limits must not change with the price: %+v", scaled)
	}
	if listed.Input != "100" || listed.CachedInput != "20" {
		t.Fatalf("scaling must not touch the listed pricing: %+v", listed)
	}

	// The scaled pricing is what gets charged, and it must still be usable
	// as a pricing: reserve and cost go through the same arithmetic.
	reserved, err := scaled.Reserve(500)
	if err != nil {
		t.Fatal(err)
	}
	if reserved != 1*Scale {
		// 70/1M*1000 + 210/1M*500 = 0.07 + 0.105 = 0.175 → one whole point.
		t.Fatalf("reserve at the scaled rate = %d, want %d", reserved, Scale)
	}

	// Exactly 1 — the default — hands back the same pricing, not a copy.
	one, err := ParseMultiplier("")
	if err != nil {
		t.Fatal(err)
	}
	if same, _ := listed.Scaled(one); same != listed {
		t.Fatal("a multiplier of 1 should return the listed pricing itself")
	}
}

func TestScaledRatesKeepSixDecimalsAndStayParseable(t *testing.T) {
	listed, err := Parse(`{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"33.333333","outputPointsPerMillion":"0.000001"}}`)
	if err != nil {
		t.Fatal(err)
	}
	m, _ := ParseMultiplier("0.7")
	scaled, err := listed.Scaled(m)
	if err != nil {
		t.Fatal(err)
	}
	// 33.333333 × 0.7 = 23.3333331 has seven decimals; a rate may carry six.
	if scaled.Input != "23.333333" {
		t.Fatalf("input was not rounded to six decimals: %q", scaled.Input)
	}
	// 0.000001 × 0.7 rounds to 0.000001, never to a negative or an unparseable value.
	if _, err := rateMicros(scaled.Output); err != nil {
		t.Fatalf("scaled output %q is not a usable rate: %v", scaled.Output, err)
	}
}

func TestMultipliersThatCannotBeSoldAreRefused(t *testing.T) {
	for _, raw := range []string{"0", "-1", "abc", "101", "0.12345", "1e3", "0.0"} {
		if _, err := ParseMultiplier(raw); !errors.Is(err, ErrMultiplier) {
			t.Fatalf("ParseMultiplier(%q) accepted or failed with the wrong error: %v", raw, err)
		}
	}
	for _, raw := range []string{"", "1", "0.7", "1.25", "100", " 0.5 ", "0.0001"} {
		if _, err := ParseMultiplier(raw); err != nil {
			t.Fatalf("ParseMultiplier(%q) refused a usable multiplier: %v", raw, err)
		}
	}

	// A multiplier that pushes a rate past the ceiling fails at scaling time,
	// so the operator hears about it when saving, not the user when calling.
	nearCeiling, err := Parse(`{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"999999999","outputPointsPerMillion":"1"}}`)
	if err != nil {
		t.Fatal(err)
	}
	hundred, _ := ParseMultiplier("100")
	if _, err := nearCeiling.Scaled(hundred); !errors.Is(err, ErrPricing) {
		t.Fatalf("scaling past the rate ceiling was accepted: %v", err)
	}
}
