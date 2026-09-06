package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/chatupstream"
)

// The AI chat supply chain holds third-party credentials, so these tests are
// mostly about what must never come back out and what must never be sold
// without a price.

type chatFixture struct {
	t        *testing.T
	h        *chatProvidersHandler
	r        *gin.Engine
	provider model.ChatProvider
}

func newChatFixture(t *testing.T) *chatFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Skipf("sqlite unavailable: %v", err)
	}
	if err := db.AutoMigrate(&model.ChatProvider{}, &model.ChatEndpoint{}, &model.ChatModel{}); err != nil {
		t.Fatalf("migrate chat tables: %v", err)
	}
	h := &chatProvidersHandler{db: db, vault: chatupstream.New("test-secret"), client: http.DefaultClient}
	r := gin.New()
	r.GET("/chat-providers", h.list)
	r.POST("/chat-providers/:id/endpoints", h.createEndpoint)
	r.PUT("/chat-endpoints/:id", h.updateEndpoint)
	r.POST("/chat-providers/:id/fetch-models", h.fetchModels)
	r.PUT("/chat-models/:id", h.updateModel)
	r.DELETE("/chat-providers/:id", h.deleteProvider)

	provider := model.ChatProvider{Name: "中转站", Enabled: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatal(err)
	}
	return &chatFixture{t: t, h: h, r: r, provider: provider}
}

func (f *chatFixture) call(method, path, body string) *httptest.ResponseRecorder {
	f.t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	f.r.ServeHTTP(w, req)
	return w
}

// endpoint writes an address straight to the table, which is how the gateway
// finds it. The API refuses plain http, so a test server needs this door.
func (f *chatFixture) endpoint(baseURL, apiKey string) model.ChatEndpoint {
	f.t.Helper()
	sealed, err := f.h.vault.Seal(apiKey)
	if err != nil {
		f.t.Fatal(err)
	}
	row := model.ChatEndpoint{ProviderID: f.provider.ID, BaseURL: baseURL, APIKey: sealed, Enabled: true}
	if err := f.h.db.Create(&row).Error; err != nil {
		f.t.Fatal(err)
	}
	return row
}

// An operator holding only the models permission fills this form, so an address
// inside the deployment must be refused: fetch-models would otherwise read the
// private network and hand the reply back.
func TestAnInternalAddressIsRefused(t *testing.T) {
	f := newChatFixture(t)
	for _, bad := range []string{
		"https://127.0.0.1/v1",
		"https://169.254.169.254/latest/meta-data",
		"https://10.0.0.5:8080",
		"https://[::1]/v1",
		"http://api.example.com/v1",
		"https://user:pw@api.example.com",
		"https://api.example.com/v1?key=leak",
	} {
		body := fmt.Sprintf(`{"baseUrl":%q,"apiKey":"sk-test"}`, bad)
		w := f.call("POST", "/chat-providers/"+f.provider.ID.String()+"/endpoints", body)
		if !strings.Contains(w.Body.String(), "https") {
			t.Fatalf("%s was accepted as an upstream address: %s", bad, w.Body.String())
		}
	}
	var count int64
	f.h.db.Model(&model.ChatEndpoint{}).Count(&count)
	if count != 0 {
		t.Fatalf("%d internal address(es) were stored", count)
	}
}

// The credential is the whole point of the vault: the list may say whether one
// exists and nothing more, in any encoding.
func TestTheChatProviderListNeverCarriesTheCredential(t *testing.T) {
	f := newChatFixture(t)
	f.endpoint("https://api.example.com", "sk-live-should-never-appear")

	w := f.call("GET", "/chat-providers", "")
	if w.Code != 200 {
		t.Fatalf("list failed: %d %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, "sk-live-should-never-appear") {
		t.Fatalf("the plaintext credential was served: %s", body)
	}
	var stored model.ChatEndpoint
	f.h.db.First(&stored)
	if strings.Contains(body, stored.APIKey) {
		t.Fatalf("the sealed credential was served: %s", body)
	}
	if !strings.Contains(body, `"hasApiKey":true`) {
		t.Fatalf("the operator cannot tell a key is set: %s", body)
	}
}

// The form shows a mask, so saving an unrelated change must not overwrite the
// stored key with the mask itself — that would silently break every call.
func TestSavingWithTheMaskKeepsTheStoredKey(t *testing.T) {
	f := newChatFixture(t)
	row := f.endpoint("https://api.example.com", "sk-original")

	w := f.call("PUT", "/chat-endpoints/"+row.ID.String(),
		fmt.Sprintf(`{"label":"主线路","apiKey":%q}`, chatupstream.Masked))
	if w.Code != 200 {
		t.Fatalf("save failed: %d %s", w.Code, w.Body.String())
	}
	var after model.ChatEndpoint
	f.h.db.First(&after, "id = ?", row.ID)
	got, err := f.h.vault.Open(after.APIKey)
	if err != nil || got != "sk-original" {
		t.Fatalf("the stored credential changed: %q %v", got, err)
	}
	if after.Label != "主线路" {
		t.Fatalf("the edit was lost: %+v", after)
	}
}

// A model with no price would appear in the picker and then be refused by the
// gateway. Refuse it here, where the operator can be told why.
func TestAChatModelCannotBeOpenedWithoutAPrice(t *testing.T) {
	f := newChatFixture(t)
	m := model.ChatModel{ProviderID: f.provider.ID, ModelKey: "gpt-x", Name: "gpt-x"}
	if err := f.h.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}

	w := f.call("PUT", "/chat-models/"+m.ID.String(), `{"enabled":true}`)
	if !strings.Contains(w.Body.String(), "单价") {
		t.Fatalf("an unpriced model was opened: %d %s", w.Code, w.Body.String())
	}
	var after model.ChatModel
	f.h.db.First(&after, "id = ?", m.ID)
	if after.Enabled {
		t.Fatal("an unpriced model is on sale")
	}

	priced := `{"enabled":true,"pricing":{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"2","outputPointsPerMillion":"8"}}}`
	if w := f.call("PUT", "/chat-models/"+m.ID.String(), priced); w.Code != 200 {
		t.Fatalf("a priced model was still refused: %d %s", w.Code, w.Body.String())
	}
	f.h.db.First(&after, "id = ?", m.ID)
	if !after.Enabled {
		t.Fatal("pricing and opening in one save did not take effect")
	}
}

// Re-running discovery is routine. It must not undo the operator's naming,
// pricing or on/off decisions, and must not drop a model the upstream stopped
// advertising while users are still on it.
func TestChatModelDiscoveryOnlyAdds(t *testing.T) {
	f := newChatFixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("path = %s, want /v1/models", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-fetch" {
			t.Errorf("Authorization = %q", got)
		}
		fmt.Fprint(w, `{"data":[{"id":"kept"},{"id":"fresh"},{"id":"fresh"},{"id":""}]}`)
	}))
	defer upstream.Close()
	f.endpoint(upstream.URL, "sk-fetch")

	const price = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"2","outputPointsPerMillion":"8"}}`
	kept := model.ChatModel{
		ProviderID: f.provider.ID, ModelKey: "kept", Name: "运营改过的名字", Enabled: true, Pricing: price,
	}
	retired := model.ChatModel{ProviderID: f.provider.ID, ModelKey: "retired", Name: "retired", Enabled: true, Pricing: price}
	if err := f.h.db.Create(&kept).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.h.db.Create(&retired).Error; err != nil {
		t.Fatal(err)
	}

	w := f.call("POST", "/chat-providers/"+f.provider.ID.String()+"/fetch-models", "{}")
	if w.Code != 200 {
		t.Fatalf("discovery failed: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		Data struct{ Total, Added int } `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Data.Total != 2 || result.Data.Added != 1 {
		t.Fatalf("total/added = %d/%d, want 2/1 (blank and duplicate dropped)", result.Data.Total, result.Data.Added)
	}

	// A fresh destination each time: GORM folds a primary key already set on
	// the struct into the query, which would quietly re-read the same row.
	var keptAfter model.ChatModel
	f.h.db.First(&keptAfter, "id = ?", kept.ID)
	if keptAfter.Name != "运营改过的名字" || !keptAfter.Enabled || keptAfter.Pricing != price {
		t.Fatalf("discovery overwrote the operator's decisions: %+v", keptAfter)
	}
	var retiredAfter model.ChatModel
	if err := f.h.db.First(&retiredAfter, "id = ?", retired.ID).Error; err != nil {
		t.Fatalf("a model the upstream stopped listing was dropped from under its users: %v", err)
	}
	var fresh model.ChatModel
	if err := f.h.db.First(&fresh, "model_key = ?", "fresh").Error; err != nil {
		t.Fatalf("the new model was not recorded: %v", err)
	}
	if fresh.Enabled || fresh.Pricing != "" || fresh.DiscoveredAt == nil {
		t.Fatalf("a newly discovered model arrived on sale: %+v", fresh)
	}
}

// Deleting a provider must take its credentials with it; a row nobody can see
// is a credential nobody will ever rotate.
func TestDeletingAChatProviderTakesItsCredentialsAlong(t *testing.T) {
	f := newChatFixture(t)
	f.endpoint("https://api.example.com", "sk-orphan")
	if err := f.h.db.Create(&model.ChatModel{ProviderID: f.provider.ID, ModelKey: "m"}).Error; err != nil {
		t.Fatal(err)
	}

	if w := f.call("DELETE", "/chat-providers/"+f.provider.ID.String(), ""); w.Code != 200 {
		t.Fatalf("delete failed: %d %s", w.Code, w.Body.String())
	}
	var endpoints, models int64
	f.h.db.Model(&model.ChatEndpoint{}).Count(&endpoints)
	f.h.db.Model(&model.ChatModel{}).Count(&models)
	if endpoints != 0 || models != 0 {
		t.Fatalf("orphans left behind: %d endpoints, %d models", endpoints, models)
	}
}

// Adding a provider or an address already switched off is how an operator
// stages one before it is ready. It must actually be off: a bool that arrives
// as false is exactly the value a GORM `default` tag would swallow, leaving
// the row live upstream with its credentials.
func TestCreatingSomethingSwitchedOffLeavesItOff(t *testing.T) {
	f := newChatFixture(t)

	w := f.call("POST", "/chat-providers/"+f.provider.ID.String()+"/endpoints",
		`{"baseUrl":"https://api.example.com","apiKey":"sk-staged","enabled":false}`)
	if w.Code != 200 {
		t.Fatalf("create failed: %d %s", w.Code, w.Body.String())
	}
	var endpoint model.ChatEndpoint
	if err := f.h.db.First(&endpoint).Error; err != nil {
		t.Fatal(err)
	}
	if endpoint.Enabled {
		t.Fatal("an address created switched off went live")
	}

	// The same field, defaulted: leaving it out still means enabled.
	if w := f.call("POST", "/chat-providers/"+f.provider.ID.String()+"/endpoints",
		`{"baseUrl":"https://backup.example.com","apiKey":"sk-live"}`); w.Code != 200 {
		t.Fatalf("create failed: %d %s", w.Code, w.Body.String())
	}
	var live model.ChatEndpoint
	if err := f.h.db.Where("base_url = ?", "https://backup.example.com").First(&live).Error; err != nil {
		t.Fatal(err)
	}
	if !live.Enabled {
		t.Fatal("an address created without the flag did not default to enabled")
	}
}
