package model

import "github.com/shopspring/decimal"

// Existing integer-priced features keep using Points; the fractional remainder
// preserves historical settlements. Pending chat fees occupy available funds
// until their account-wide sum crosses a whole point and is posted to the ledger.
const PointScale int64 = 1_000_000

func (u *User) PointBalance() float64 {
	return decimal.NewFromInt(u.Points).Add(decimal.NewFromInt(u.PointFraction - u.PointHeldMicros - u.ChatPendingMicros).Div(decimal.NewFromInt(PointScale))).InexactFloat64()
}

func (u *User) PendingTokenPoints() float64 {
	return float64(u.ChatPendingMicros) / float64(PointScale)
}

func (u *User) PointTotal() float64 {
	return decimal.NewFromInt(u.Points).Add(decimal.NewFromInt(u.PointFraction).Div(decimal.NewFromInt(PointScale))).InexactFloat64()
}

func (r *PointRecord) ExactAmount() float64 {
	if r.AmountMicros != nil {
		return float64(*r.AmountMicros) / float64(PointScale)
	}
	return float64(r.Amount)
}

func (r *PointRecord) ExactBalance() float64 {
	if r.BalanceMicros != nil {
		return float64(*r.BalanceMicros) / float64(PointScale)
	}
	return float64(r.Balance)
}
