package model

const (
	BillingMarketCN = "cn"
	BillingMarketEN = "en"
	CurrencyCNY     = "CNY"
	CurrencyUSD     = "USD"
	// The MySQL dialect emits BIGINT for these Go int fields. The real bound is
	// the fixed-point balance used by points.BalanceMicros, not a 32-bit column.
	MaxBillingGrantPoints = ((1<<63 - 1) - PointScale) / PointScale
)

func ValidBillingGrant(monthlyPoints int, annual bool) bool {
	limit := int64(MaxBillingGrantPoints)
	if annual {
		limit /= 12
	}
	return monthlyPoints >= 0 && int64(monthlyPoints) <= limit
}

// Empty market/currency values belong to legacy Chinese billing records.
func BillingMarket(values ...string) string {
	if len(values) > 0 && values[0] == BillingMarketEN {
		return BillingMarketEN
	}
	return BillingMarketCN
}

func MarketCurrency(market string) string {
	if market == BillingMarketEN {
		return CurrencyUSD
	}
	return CurrencyCNY
}

func OrderCurrency(order *Order) string {
	if order.Currency != "" {
		return order.Currency
	}
	return MarketCurrency(BillingMarket(order.Market))
}

func PlanCurrency(plan *Plan) string {
	if plan.Currency != "" {
		return plan.Currency
	}
	return MarketCurrency(BillingMarket(plan.Market))
}
