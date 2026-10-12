package billing

import "tidecanvas/internal/model"

func marketConfigKey(key string, markets ...string) string {
	if model.BillingMarket(markets...) == model.BillingMarketEN {
		return key + ".en"
	}
	return key
}
