package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/tokenbilling"
)

const defaultPricingBody = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300"}}`

// An operator who pulled a catalogue of seventeen models should not have to
// type the same two numbers seventeen times. Saving a default price fills the
// rows that have none, leaves the rows they already priced alone, and applies
// to whatever discovery adds later.
func TestDefaultPricingFillsUnpricedModelsAndFeedsDiscovery(t *testing.T) {
	f := newChatFixture(t)
	const own = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"5","outputPointsPerMillion":"9"}}`
	priced := model.ChatModel{ProviderID: f.provider.ID, ModelKey: "priced", Name: "priced", Pricing: own}
	blank := model.ChatModel{ProviderID: f.provider.ID, ModelKey: "blank", Name: "blank"}
	spaces := model.ChatModel{ProviderID: f.provider.ID, ModelKey: "spaces", Name: "spaces", Pricing: "  "}
	for _, row := range []*model.ChatModel{&priced, &blank, &spaces} {
		if err := f.h.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}

	w := f.call("PUT", "/chat-providers/"+f.provider.ID.String(),
		`{"defaultPricing":`+defaultPricingBody+`,"priceMultiplier":"0.7"}`)
	if w.Code != 200 {
		t.Fatalf("saving defaults failed: %d %s", w.Code, w.Body.String())
	}
	var saved struct {
		Data struct {
			Filled int64 `json:"filled"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Data.Filled != 2 {
		t.Fatalf("filled = %d, want 2 (the blank and the whitespace-only row)", saved.Data.Filled)
	}
	for _, id := range []string{blank.ID.String(), spaces.ID.String()} {
		var row model.ChatModel
		f.h.db.First(&row, "id = ?", id)
		if row.Pricing != defaultPricingBody || row.Enabled {
			t.Fatalf("unpriced model was not filled, or was put on sale: %+v", row)
		}
	}
	var pricedAfter model.ChatModel
	f.h.db.First(&pricedAfter, "id = ?", priced.ID)
	if pricedAfter.Pricing != own {
		t.Fatalf("a model the operator priced was overwritten by the default: %q", pricedAfter.Pricing)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"data":[{"id":"fresh"}]}`)
	}))
	defer upstream.Close()
	f.endpoint(upstream.URL, "sk-fetch")
	if w := f.call("POST", "/chat-providers/"+f.provider.ID.String()+"/fetch-models", "{}"); w.Code != 200 {
		t.Fatalf("discovery failed: %d %s", w.Code, w.Body.String())
	}
	var fresh model.ChatModel
	if err := f.h.db.First(&fresh, "model_key = ?", "fresh").Error; err != nil {
		t.Fatal(err)
	}
	if fresh.Pricing != defaultPricingBody || fresh.Enabled {
		t.Fatalf("a discovered model did not inherit the default, or arrived on sale: %+v", fresh)
	}

	// The list shows the operator both numbers: what they listed and what the
	// gateway sells at, so 0.7 is visible per row rather than remembered.
	w = f.call("GET", "/chat-providers", "")
	var list struct {
		Data []struct {
			ID              string                `json:"id"`
			PriceMultiplier string                `json:"priceMultiplier"`
			DefaultPricing  *tokenbilling.Pricing `json:"defaultPricing"`
			Models          []struct {
				ModelKey         string                `json:"modelKey"`
				Pricing          *tokenbilling.Pricing `json:"pricing"`
				EffectivePricing *tokenbilling.Pricing `json:"effectivePricing"`
			} `json:"models"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("%v: %s", err, w.Body.String())
	}
	if len(list.Data) != 1 || list.Data[0].PriceMultiplier != "0.7" || list.Data[0].DefaultPricing == nil || list.Data[0].DefaultPricing.Input != "100" {
		t.Fatalf("provider defaults not reported: %s", w.Body.String())
	}
	for _, m := range list.Data[0].Models {
		if m.Pricing == nil || m.EffectivePricing == nil {
			t.Fatalf("%s has no pricing in the list: %s", m.ModelKey, w.Body.String())
		}
		switch m.ModelKey {
		case "priced":
			if m.Pricing.Input != "5" || m.EffectivePricing.Input != "3.5" || m.EffectivePricing.Output != "6.3" {
				t.Fatalf("effective price of the operator-priced row is wrong: listed %+v effective %+v", m.Pricing, m.EffectivePricing)
			}
		default:
			if m.Pricing.Input != "100" || m.EffectivePricing.Input != "70" || m.EffectivePricing.Output != "210" {
				t.Fatalf("effective price of %s is wrong: listed %+v effective %+v", m.ModelKey, m.Pricing, m.EffectivePricing)
			}
		}
	}
}

func TestUnusableDefaultsAreRefusedAndDefaultsCanBeCleared(t *testing.T) {
	f := newChatFixture(t)
	for _, body := range []string{
		`{"priceMultiplier":"0"}`,
		`{"priceMultiplier":"abc"}`,
		`{"priceMultiplier":"101"}`,
		`{"defaultPricing":{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"x","outputPointsPerMillion":"1"}}}`,
		`{"defaultPricing":{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"1"}}}`,
	} {
		if w := f.call("PUT", "/chat-providers/"+f.provider.ID.String(), body); w.Code != 400 {
			t.Fatalf("%s was accepted: %d %s", body, w.Code, w.Body.String())
		}
	}
	var row model.ChatProvider
	f.h.db.First(&row, "id = ?", f.provider.ID)
	if row.PriceMultiplier != "" || row.DefaultPricing != "" {
		t.Fatalf("a refused save still changed the row: %+v", row)
	}

	if w := f.call("PUT", "/chat-providers/"+f.provider.ID.String(), `{"defaultPricing":`+defaultPricingBody+`,"priceMultiplier":"1.5"}`); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	// null clears the default; "" puts the multiplier back to 1. Neither
	// touches models already filled — a default is a starting point, not a link.
	if w := f.call("PUT", "/chat-providers/"+f.provider.ID.String(), `{"defaultPricing":null,"priceMultiplier":""}`); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	f.h.db.First(&row, "id = ?", f.provider.ID)
	if row.PriceMultiplier != "" || row.DefaultPricing != "" {
		t.Fatalf("clearing did not clear: %+v", row)
	}

	// Creating a provider accepts the same two fields.
	w := f.call("POST", "/chat-providers", `{"name":"官方","defaultPricing":`+defaultPricingBody+`,"priceMultiplier":"0.9"}`)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var created model.ChatProvider
	f.h.db.First(&created, "name = ?", "官方")
	if created.PriceMultiplier != "0.9" || created.DefaultPricing != defaultPricingBody {
		t.Fatalf("create ignored the defaults: %+v", created)
	}
}
