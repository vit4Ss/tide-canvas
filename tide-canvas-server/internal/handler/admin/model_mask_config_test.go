package admin

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"strings"
	"testing"
	"tidecanvas/internal/model"
)

func TestMaskConfigurationValidation(t *testing.T) {
	for _, tc := range []struct {
		typ, raw string
		valid    bool
	}{
		{"image", `{}`, true}, {"image", `{"supportsMask":true}`, true},
		{"image", `{"supportsMask":false}`, true}, {"video", `{"supportsMask":true}`, false},
		{"image", `{"supportsMask":"true"}`, false}, {"image", `{"supportsMask":null}`, false},
	} {
		if err := validateMaskConfig(tc.typ, json.RawMessage(tc.raw)); (err == nil) != tc.valid {
			t.Errorf("%s %s: %v", tc.typ, tc.raw, err)
		}
	}
}

func TestMaskFlagSurvivesAdminSaveAndRelaySync(t *testing.T) {
	db := openModelsTestDB(t)
	h := &modelsHandler{db: db}
	c, w := gin.CreateTestContext(httptest.NewRecorder())
	_ = w
	c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"蒙版模型","type":"image","modelKey":"mask-model","config":{"supportsMask":true}}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.create(c)
	var row model.MarketModel
	if err := db.Where("model_key = ?", "mask-model").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if !model.ModelConfigSupportsMask(row.Config) {
		t.Fatalf("lost flag: %s", row.Config)
	}
	merged := mergeRelayConfig(row.Config, `{"supportsMask":false,"operations":["edits"]}`)
	if !model.ModelConfigSupportsMask(merged) {
		t.Fatalf("relay overwrote admin flag: %s", merged)
	}
}
