package tokenbilling

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

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
var ErrMultiplier = errors.New("price multiplier must be a positive number up to 100 with at most four decimals")

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

// wholePointMicros converts a non-negative calculated micro-point amount into
// the product's user-facing billing unit. Every non-zero calculated fee costs
// a whole number of points; a zero calculated fee remains free.
func wholePointMicros(value decimal.Decimal) (int64, error) {
	if value.IsZero() {
		return 0, nil
	}
	points := value.Div(decimal.NewFromInt(Scale)).Ceil()
	if points.IsNegative() || points.GreaterThan(decimal.NewFromInt(math.MaxInt64/Scale)) {
		return 0, ErrPricing
	}
	return points.IntPart() * Scale, nil
}

func (p *Pricing) Reserve(maxOutput int64) (int64, error) {
	input, _ := rateMicros(p.Input)
	cached, _ := rateMicros(p.CachedInput)
	output, _ := rateMicros(p.Output)
	if cached.GreaterThan(input) {
		input = cached
	}
	value := input.Mul(decimal.NewFromInt(p.MaxInput)).Add(output.Mul(decimal.NewFromInt(maxOutput))).Div(decimal.NewFromInt(Scale))
	return wholePointMicros(value)
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
	value := in.Mul(decimal.NewFromInt(usage.Input - usage.Cached)).Add(cached.Mul(decimal.NewFromInt(usage.Cached))).Add(out.Mul(decimal.NewFromInt(usage.Output))).Div(decimal.NewFromInt(Scale))
	return wholePointMicros(value)
}

// ReservationCovers accepts current whole-point reservations and the smaller
// fractional reservations written before whole-point billing was introduced.
// A legacy reservation may grow only to its own whole-point ceiling.
func ReservationCovers(reserved, cost int64) bool {
	if reserved < 0 || cost < 0 {
		return false
	}
	if cost <= reserved {
		return true
	}
	if reserved == 0 || reserved%Scale == 0 {
		return false
	}
	whole := reserved / Scale
	if whole >= math.MaxInt64/Scale {
		return false
	}
	ceiling := (whole + 1) * Scale
	return cost <= ceiling
}

// ParseMultiplier reads a provider-level price multiplier. Empty means 1: the
// listed rates are the selling rates. Otherwise it is a positive decimal up to
// 100 with at most four decimals, so "0.7" sells every model of that provider
// at seven tenths of its listed rates. It is kept as a decimal string, never a
// float, so 0.7 stays 0.7.
func ParseMultiplier(raw string) (decimal.Decimal, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return decimal.NewFromInt(1), nil
	}
	m, err := decimal.NewFromString(raw)
	if err != nil || !m.IsPositive() || m.GreaterThan(decimal.NewFromInt(100)) || !m.Equal(m.Truncate(4)) {
		return decimal.Zero, ErrMultiplier
	}
	return m, nil
}

// Scaled returns the pricing with every rate multiplied by m and rounded to
// the six decimals a rate may carry; the token limits are unchanged. A
// multiplier of exactly 1 returns p itself. The result is re-validated, so a
// rate the multiplier pushes past the ceiling fails here rather than at the
// first call.
func (p *Pricing) Scaled(m decimal.Decimal) (*Pricing, error) {
	if m.Equal(decimal.NewFromInt(1)) {
		return p, nil
	}
	if !m.IsPositive() {
		return nil, ErrMultiplier
	}
	out := *p
	for _, rate := range []*string{&out.Input, &out.Output, &out.CachedInput} {
		if *rate == "" {
			continue
		}
		value, err := decimal.NewFromString(*rate)
		if err != nil {
			return nil, ErrPricing
		}
		*rate = value.Mul(m).Round(6).String()
		if _, err := rateMicros(*rate); err != nil {
			return nil, err
		}
	}
	return &out, nil
}

func (p *Pricing) Label(name string) string {
	return fmt.Sprintf("%s · %s/%s 积分/1M Token", name, p.Input, p.Output)
}
