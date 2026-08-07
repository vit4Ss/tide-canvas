package content

import "testing"

func TestIsHiddenPricingRoute(t *testing.T) {
	t.Parallel()

	cases := map[string]bool{
		"/pricing":                    true,
		"/pricing/":                   true,
		"/pricing/legacy?from=notice": true,
		"https://example.com/pricing": true,
		"pricing":                     true,
		"/admin/pricing":              false,
		"/studio":                     false,
	}
	for raw, want := range cases {
		raw, want := raw, want
		t.Run(raw, func(t *testing.T) {
			t.Parallel()
			if got := isHiddenPricingRoute(raw); got != want {
				t.Fatalf("isHiddenPricingRoute(%q) = %v, want %v", raw, got, want)
			}
		})
	}
}

func TestParseHomeGlobalRetiresPricingTarget(t *testing.T) {
	t.Parallel()

	vo, ok := parseHomeGlobal(`{"ctaLabel":"升级","ctaTarget":"pricing"}`)
	if !ok {
		t.Fatal("parseHomeGlobal rejected valid JSON")
	}
	if vo.CtaTarget != "studio" {
		t.Fatalf("cta target = %q, want studio", vo.CtaTarget)
	}
}

func TestParseFooterColsFiltersPricingLinks(t *testing.T) {
	t.Parallel()

	cols, ok := parseFooterCols(`[{"title":"关于","links":[{"label":"价格","href":"/pricing"},{"label":"条款","href":"/terms"}]}]`)
	if !ok || len(cols) != 1 || len(cols[0].Links) != 1 {
		t.Fatalf("unexpected filtered footer: ok=%v cols=%#v", ok, cols)
	}
	if cols[0].Links[0].Href != "/terms" {
		t.Fatalf("remaining link = %q, want /terms", cols[0].Links[0].Href)
	}
}
