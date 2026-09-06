package tokenbilling

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/shopspring/decimal"
)

// ErrNotConfigured means the model simply has no token pricing: it keeps its
// per-call price. ErrPricing means an operator switched token billing on but
// the numbers are unusable — that model must be refused, never quietly billed
// at the old per-call rate.
var ErrNotConfigured = errors.New("model bills per call")
var ErrPricing = errors.New("token pricing is configured but unusable")
var ErrUsage = errors.New("authoritative token usage is missing or invalid")
var ErrLimit = errors.New("token usage exceeds the reserved model limits")

const Scale int64 = 1_000_000

type Pricing struct {
	Enabled     bool   `json:"enabled"`
	Input       string `json:"inputPointsPerMillion"`
	Output      string `json:"outputPointsPerMillion"`
	CachedInput string `json:"cachedInputPointsPerMillion,omitempty"`
	MaxInput    int64  `json:"maxInputTokens"`
	MaxOutput   int64  `json:"maxOutputTokens"`
}

func Parse(config string) (*Pricing, error) {
	var value struct {
		Pricing *Pricing `json:"tokenPricing"`
	}
	if json.Unmarshal([]byte(config), &value) != nil || value.Pricing == nil || !value.Pricing.Enabled {
		return nil, ErrNotConfigured
	}
	p := value.Pricing
	if p.MaxInput == 0 {
		p.MaxInput = 131072
	}
	if p.MaxOutput == 0 {
		p.MaxOutput = 8192
	}
	if p.MaxInput < 1 || p.MaxInput > 10_000_000 || p.MaxOutput < 1 || p.MaxOutput > 1_000_000 {
		return nil, ErrPricing
	}
	for _, rate := range []string{p.Input, p.Output} {
		if _, err := rateMicros(rate); err != nil {
			return nil, err
		}
	}
	if p.CachedInput == "" {
		p.CachedInput = p.Input
	}
	if _, err := rateMicros(p.CachedInput); err != nil {
		return nil, err
	}
	return p, nil
}

func rateMicros(raw string) (decimal.Decimal, error) {
	rate, err := decimal.NewFromString(raw)
	if err != nil || rate.IsNegative() || rate.GreaterThan(decimal.NewFromInt(1_000_000_000)) || !rate.Equal(rate.Truncate(6)) {
		return decimal.Zero, ErrPricing
	}
	return rate.Mul(decimal.NewFromInt(Scale)), nil
}

func (p *Pricing) Reserve(maxOutput int64) (int64, error) {
	input, _ := rateMicros(p.Input)
	cached, _ := rateMicros(p.CachedInput)
	output, _ := rateMicros(p.Output)
	if cached.GreaterThan(input) {
		input = cached
	}
	value := input.Mul(decimal.NewFromInt(p.MaxInput)).Add(output.Mul(decimal.NewFromInt(maxOutput))).Div(decimal.NewFromInt(Scale)).Ceil()
	if value.GreaterThan(decimal.NewFromInt(math.MaxInt64)) {
		return 0, ErrPricing
	}
	return value.IntPart(), nil
}

type Usage struct {
	Input     int64 `json:"inputTokens"`
	Output    int64 `json:"outputTokens"`
	Cached    int64 `json:"cachedInputTokens"`
	Reasoning int64 `json:"reasoningTokens"`
}

func ParseUsage(value any) (*Usage, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, ErrUsage
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return nil, ErrUsage
	}
	count := func(raw json.RawMessage, required bool) (int64, error) {
		if len(raw) == 0 {
			if required {
				return 0, ErrUsage
			}
			return 0, nil
		}
		var n int64
		if string(raw) == "null" || json.Unmarshal(raw, &n) != nil || n < 0 {
			return 0, ErrUsage
		}
		return n, nil
	}
	in, err := count(fields["prompt_tokens"], true)
	if err != nil {
		return nil, err
	}
	out, err := count(fields["completion_tokens"], true)
	if err != nil || in > math.MaxInt64-out {
		return nil, ErrUsage
	}
	if raw := fields["total_tokens"]; len(raw) > 0 {
		total, e := count(raw, true)
		if e != nil || total != in+out {
			return nil, ErrUsage
		}
	}
	usage := &Usage{Input: in, Output: out}
	for _, item := range []struct {
		parent, key string
		target      *int64
		limit       int64
	}{{"prompt_tokens_details", "cached_tokens", &usage.Cached, in}, {"completion_tokens_details", "reasoning_tokens", &usage.Reasoning, out}} {
		var detail map[string]json.RawMessage
		if len(fields[item.parent]) > 0 && json.Unmarshal(fields[item.parent], &detail) != nil {
			return nil, ErrUsage
		}
		value, e := count(detail[item.key], false)
		if e != nil || value > item.limit {
			return nil, ErrUsage
		}
		*item.target = value
	}
	return usage, nil
}

func (p *Pricing) Cost(usage *Usage, maxOutput int64) (int64, error) {
	if usage.Input > p.MaxInput || usage.Output > maxOutput {
		return 0, ErrLimit
	}
	in, _ := rateMicros(p.Input)
	out, _ := rateMicros(p.Output)
	cached, _ := rateMicros(p.CachedInput)
	value := in.Mul(decimal.NewFromInt(usage.Input - usage.Cached)).Add(cached.Mul(decimal.NewFromInt(usage.Cached))).Add(out.Mul(decimal.NewFromInt(usage.Output))).Div(decimal.NewFromInt(Scale)).Ceil()
	if value.GreaterThan(decimal.NewFromInt(math.MaxInt64)) {
		return 0, ErrPricing
	}
	return value.IntPart(), nil
}

func (p *Pricing) Label(name string) string {
	return fmt.Sprintf("%s · %s/%s 积分/1M Token", name, p.Input, p.Output)
}
