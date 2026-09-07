package tokenbilling

import (
	"encoding/json"
	"testing"

	"github.com/shopspring/decimal"
)

func TestWholePointCeilingKeepsZeroAndExactIntegersStable(t *testing.T) {
	for _, test := range []struct {
		micros int64
		want   int64
	}{{0, 0}, {1, Scale}, {Scale, Scale}, {Scale + 1, 2 * Scale}} {
		got, err := wholePointMicros(decimal.NewFromInt(test.micros))
		if err != nil || got != test.want {
			t.Fatalf("wholePointMicros(%d) = %d, %v; want %d", test.micros, got, err, test.want)
		}
	}
}

func TestTokenPriceUsesCacheAsInputSubsetAndReasoningAsOutputSubset(t *testing.T) {
	p, err := Parse(`{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300","cachedInputPointsPerMillion":"20","maxInputTokens":1000,"maxOutputTokens":1000}}`)
	if err != nil {
		t.Fatal(err)
	}
	var raw any
	json.Unmarshal([]byte(`{"prompt_tokens":100,"completion_tokens":200,"total_tokens":300,"prompt_tokens_details":{"cached_tokens":20},"completion_tokens_details":{"reasoning_tokens":50}}`), &raw)
	usage, err := ParseUsage(raw)
	if err != nil {
		t.Fatal(err)
	}
	cost, err := p.Cost(usage, 1000)
	if err != nil || cost != 1_000_000 {
		t.Fatalf("wrong token fee: %d %v", cost, err)
	}
	reserved, err := p.Reserve(1000)
	if err != nil || reserved != 1_000_000 {
		t.Fatalf("wrong hold: %d %v", reserved, err)
	}
	zero, err := p.Cost(&Usage{}, 1000)
	if err != nil || zero != 0 {
		t.Fatalf("zero usage cost: %d %v", zero, err)
	}
	if !ReservationCovers(400_000, 1_000_000) || ReservationCovers(400_000, 2_000_000) || ReservationCovers(1_000_000, 2_000_000) {
		t.Fatal("whole-point reservation compatibility boundary is wrong")
	}
}

func TestTokenPricingRejectsAbsentRatesAndUnreliableCounts(t *testing.T) {
	for _, config := range []string{`{}`, `{"tokenPricing":{"enabled":false}}`, `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"","outputPointsPerMillion":"1"}}`, `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"-1","outputPointsPerMillion":"1"}}`} {
		if _, err := Parse(config); err == nil {
			t.Fatal("invalid pricing accepted")
		}
	}
	for _, raw := range []string{`{}`, `{"total_tokens":123}`, `{"prompt_tokens":1.5,"completion_tokens":1}`, `{"prompt_tokens":1,"completion_tokens":1,"total_tokens":3}`, `{"prompt_tokens":1,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":2}}`} {
		var value any
		json.Unmarshal([]byte(raw), &value)
		if _, err := ParseUsage(value); err == nil {
			t.Fatal("unreliable usage accepted")
		}
	}
}
