package lobehub

import (
	"strings"
	"testing"

	"github.com/shopspring/decimal"
	"tidecanvas/internal/model"
)

// The name LobeHub shows in its model picker is built at sync time, so it must
// follow the model's own billing mode: a token-priced model advertises its
// per-million rates, an unpriced one keeps "N 积分/次".
func TestSyncedModelNameFollowsThatModelsBillingMode(t *testing.T) {
	f := setup(t, "", "")
	enableTestTokenPricing(t, f)
	legacy := model.MarketModel{Name: "Legacy Model", ModelKey: "legacy-model", Type: "text", Status: 1, SortOrder: 5, Price: decimal.NewFromInt(8)}
	if err := f.s.d.DB.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	rows, err := f.s.models(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	for _, m := range rows {
		names[m.ModelKey] = syncedModelName(m)
	}
	if got := names["test-model"]; !strings.Contains(got, "100/300 积分/1M Token") {
		t.Fatalf("a token-priced model still advertises a per-call price: %q", got)
	}
	if got := names["legacy-model"]; got != "Legacy Model · 8 积分/次" {
		t.Fatalf("an unpriced model lost its per-call price: %q", got)
	}
}
