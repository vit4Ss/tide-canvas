package chatgateway

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"tidecanvas/internal/model"
)

// Two providers may both offer the same upstream model id. The catalogue shows
// one entry, and the call is billed at that entry's price — never at a second,
// differently priced row the user was never quoted.
func TestOneEntryAndOnePriceWhenProvidersShareAModelID(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)

	// A second provider offering the same id, priced far higher, sorted after.
	other := model.ChatProvider{Name: "Backup Provider", Enabled: true, SortOrder: 5}
	if err := f.s.d.DB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	sealed, err := f.s.upstreams.Seal("other-secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Create(&model.ChatEndpoint{ProviderID: other.ID, BaseURL: up.URL, APIKey: sealed, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	dearer := strings.ReplaceAll(tokenTestPricing, `"300"`, `"9000"`)
	if err := f.s.d.DB.Create(&model.ChatModel{ProviderID: other.ID, ModelKey: "test-model", Name: "Same id, dearer", Enabled: true, SortOrder: 5, Pricing: dearer}).Error; err != nil {
		t.Fatal(err)
	}

	models := jsonMap(t, f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil))["data"].([]any)
	if len(models) != 1 {
		t.Fatalf("a shared model id produced %d catalogue entries", len(models))
	}
	quoted := models[0].(map[string]any)["token_pricing"].(map[string]any)["outputPointsPerMillion"]
	if quoted != "300" {
		t.Fatalf("quoted the wrong price: %v", quoted)
	}

	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil); w.Code != 200 {
		t.Fatalf("call failed: %d %s", w.Code, w.Body.String())
	}
	// 100 input at 100/M + 100 output at 300/M = 0.04 raw points, rounded
	// to one whole point by the per-request billing contract.
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19 {
		t.Fatalf("charged at a price the user was not quoted: %v", user.PointBalance())
	}
}
func TestInterruptedTerminalChunkRetainsContentAndReplay(t *testing.T) {
	for _, stream := range []bool{true, false} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			var calls atomic.Int32
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"last words\"},\"finish_reason\":\"length\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n")
			}))
			defer up.Close()
			f := setup(t, up.URL)
			body := fmt.Sprintf(`{"model":"test-model","stream":%t,"messages":[{"role":"user","content":"hi"}]}`, stream)
			for retry := 0; retry < 2; retry++ {
				w := f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, map[string]string{"Idempotency-Key": "partial-terminal"})
				if !strings.Contains(w.Body.String(), "last words") {
					t.Errorf("partial content lost, stream=%t retry=%d: %s", stream, retry, w.Body.String())
				}
				if !strings.Contains(w.Body.String(), `"error"`) {
					t.Error("partial output incorrectly presented as success")
				}
				if stream && strings.Contains(w.Body.String(), `"finish_reason":"length"`) {
					t.Error("premature finish marker emitted before the error")
				}
			}
			var user model.User
			f.s.d.DB.First(&user, "id = ?", f.user.ID)
			if user.PointBalance() != 19 || user.PointHeldMicros != 0 || calls.Load() != 1 {
				t.Fatalf("partial response replay charged twice: balance=%v held=%d calls=%d",
					user.PointBalance(), user.PointHeldMicros, calls.Load())
			}
		})
	}
}
