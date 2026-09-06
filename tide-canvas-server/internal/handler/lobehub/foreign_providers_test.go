package lobehub

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// lobeStub answers the tRPC calls hideForeignProviders makes, recording which
// providers it was asked to disable.
type lobeStub struct {
	mu       sync.Mutex
	list     string
	refuse   map[string]bool
	disabled []string
	listErr  bool
}

func (l *lobeStub) server() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/trpc/lambda/aiProvider.getAiProviderList" {
			if l.listErr {
				w.WriteHeader(500)
				fmt.Fprint(w, `{"error":{"json":{"message":"nope"}}}`)
				return
			}
			fmt.Fprintf(w, `{"result":{"data":{"json":%s}}}`, l.list)
			return
		}
		if r.URL.Path == "/trpc/lambda/aiProvider.toggleProviderEnabled" {
			var body struct {
				JSON struct {
					ID      string `json:"id"`
					Enabled bool   `json:"enabled"`
				} `json:"json"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			l.mu.Lock()
			defer l.mu.Unlock()
			if l.refuse[body.JSON.ID] {
				w.WriteHeader(400)
				fmt.Fprint(w, `{"error":{"json":{"message":"official provider"}}}`)
				return
			}
			if !body.JSON.Enabled {
				l.disabled = append(l.disabled, body.JSON.ID)
			}
			fmt.Fprint(w, `{"result":{"data":{"json":{"ok":true}}}}`)
			return
		}
		w.WriteHeader(404)
	}))
}

func (l *lobeStub) taken() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.disabled...)
}

func TestOnlyTheMainSiteProviderKeepsItsModels(t *testing.T) {
	stub := &lobeStub{list: `[{"id":"flowinglight","enabled":true},{"id":"anthropic","enabled":true},{"id":"google","enabled":true},{"id":"openai","enabled":false},{"id":"","enabled":true}]`}
	up := stub.server()
	defer up.Close()
	f := setup(t, up.URL, "")

	f.s.hideForeignProviders(t.Context(), "session=x", "flowinglight")

	got := stub.taken()
	want := map[string]bool{"anthropic": true, "google": true}
	if len(got) != len(want) {
		t.Fatalf("unexpected disable set: %v", got)
	}
	for _, id := range got {
		if !want[id] {
			t.Fatalf("%q must not be disabled: %v", id, got)
		}
	}
}

// A release that protects one of its own providers must not cost the user the
// connection, nor stop the other providers from being hidden.
func TestARefusedProviderDoesNotStopTheRest(t *testing.T) {
	stub := &lobeStub{
		list:   `[{"id":"lobehub","enabled":true},{"id":"anthropic","enabled":true}]`,
		refuse: map[string]bool{"lobehub": true},
	}
	up := stub.server()
	defer up.Close()
	f := setup(t, up.URL, "")

	f.s.hideForeignProviders(t.Context(), "session=x", "flowinglight")

	if got := stub.taken(); len(got) != 1 || got[0] != "anthropic" {
		t.Fatalf("a refusal derailed the rest: %v", got)
	}
}

func TestAnUnreadableProviderListIsNotFatal(t *testing.T) {
	stub := &lobeStub{listErr: true}
	up := stub.server()
	defer up.Close()
	f := setup(t, up.URL, "")

	f.s.hideForeignProviders(t.Context(), "session=x", "flowinglight")

	if got := stub.taken(); len(got) != 0 {
		t.Fatalf("nothing should be disabled without a readable list: %v", got)
	}
}
