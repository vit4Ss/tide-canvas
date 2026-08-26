package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

func openModelsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Skipf("sqlite unavailable: %v", err)
	}
	if err := db.AutoMigrate(&model.MarketModel{}, &model.SysConfig{}); err != nil {
		t.Fatalf("migrate model tables: %v", err)
	}
	return db
}

func TestAdminModelCreateDTOAccepts3DType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"混元生 3D 3.1","type":"3d"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	var dto AdminModelCreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		t.Fatalf("bind 3d model: %v", err)
	}
	if dto.Type != "3d" {
		t.Fatalf("type = %q, want 3d", dto.Type)
	}
}

func TestAdminModelUpdateDTOAccepts3DType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("PUT", "/", strings.NewReader(`{"type":"3d"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	var dto AdminModelUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		t.Fatalf("bind 3d update: %v", err)
	}
	if dto.Type == nil || *dto.Type != "3d" {
		t.Fatalf("type = %v, want 3d", dto.Type)
	}
}

func TestValidate3DReferenceConfig(t *testing.T) {
	valid := []json.RawMessage{
		nil,
		json.RawMessage(`{}`),
		json.RawMessage(`{"max3DImageSizeMB":10,"max3DMultiViewImages":4}`),
		json.RawMessage(`{"max3DImageSizeMB":0,"max3DMultiViewImages":8}`),
	}
	for _, raw := range valid {
		if err := validate3DReferenceConfig(raw); err != nil {
			t.Fatalf("valid config %s rejected: %v", raw, err)
		}
	}

	invalid := []json.RawMessage{
		json.RawMessage(`{"max3DImageSizeMB":-1}`),
		json.RawMessage(`{"max3DImageSizeMB":51}`),
		json.RawMessage(`{"max3DMultiViewImages":0}`),
		json.RawMessage(`{"max3DMultiViewImages":9}`),
	}
	for _, raw := range invalid {
		if err := validate3DReferenceConfig(raw); err == nil {
			t.Fatalf("invalid config %s was accepted", raw)
		}
	}
}

func TestAdminModelDTOsAcceptUpscaleType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	createContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	createContext.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"Video Upscaler","type":"upscale"}`))
	createContext.Request.Header.Set("Content-Type", "application/json")
	var createDTO AdminModelCreateDTO
	if err := createContext.ShouldBindJSON(&createDTO); err != nil {
		t.Fatalf("bind upscale model: %v", err)
	}
	if createDTO.Type != "upscale" {
		t.Fatalf("create type = %q, want upscale", createDTO.Type)
	}

	updateContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	updateContext.Request = httptest.NewRequest("PUT", "/", strings.NewReader(`{"type":"upscale"}`))
	updateContext.Request.Header.Set("Content-Type", "application/json")
	var updateDTO AdminModelUpdateDTO
	if err := updateContext.ShouldBindJSON(&updateDTO); err != nil {
		t.Fatalf("bind upscale update: %v", err)
	}
	if updateDTO.Type == nil || *updateDTO.Type != "upscale" {
		t.Fatalf("update type = %v, want upscale", updateDTO.Type)
	}
}

func TestValidateUpscalePricingConfig(t *testing.T) {
	valid := json.RawMessage(`{"resolutions":["1080p","4k"],"pricePerSecondByResolution":{"1080P":"1.25","4k":2.5}}`)
	if err := validateUpscalePricingConfig(valid); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	missing := json.RawMessage(`{"resolutions":["1080p","4k"],"pricePerSecondByResolution":{"1080p":1.25}}`)
	if err := validateUpscalePricingConfig(missing); err == nil || !strings.Contains(err.Error(), "4K") {
		t.Fatalf("missing 4k rate error = %v", err)
	}
	legacy := json.RawMessage(`{"resolutions":["4k"],"pricePerSecond":2.5}`)
	if err := validateUpscalePricingConfig(legacy); err == nil {
		t.Fatal("legacy uniform rate must be migrated before save")
	}
}

func TestValidateVideoPerRequestPricingConfig(t *testing.T) {
	for _, raw := range []json.RawMessage{
		nil,
		json.RawMessage(`{}`),
		json.RawMessage(`{"videoBillingMode":"duration"}`),
		json.RawMessage(`{"videoBillingMode":"per_request","resolutions":["720p","1080p"],"pricePerRequestByResolution":{"720P":"12.5","1080p":25}}`),
	} {
		if err := validateVideoPricingConfig(raw); err != nil {
			t.Fatalf("config %s: %v", raw, err)
		}
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"videoBillingMode":"unknown"}`),
		json.RawMessage(`{"videoBillingMode":"per_request"}`),
		json.RawMessage(`{"videoBillingMode":"per_request","resolutions":["720p"],"pricePerRequestByResolution":{}}`),
		json.RawMessage(`{"videoBillingMode":"per_request","resolutions":["720p","720P"],"pricePerRequestByResolution":{"720p":10}}`),
		json.RawMessage(`{"videoBillingMode":"per_request","resolutions":["720p"],"pricePerRequestByResolution":{"720p":0}}`),
		json.RawMessage(`{"videoBillingMode":"per_request","resolutions":["720p"],"pricePerRequestByResolution":{"720p":1e308}}`),
		json.RawMessage(`{"videoBillingMode":"per_request","resolutions":["720p"],"pricePerRequestByResolution":{"720p":10,"720P":11}}`),
	} {
		if err := validateVideoPricingConfig(raw); err == nil {
			t.Fatalf("config %s should be rejected", raw)
		}
	}
}

func TestValidateOmniReferenceConfig(t *testing.T) {
	for _, raw := range []json.RawMessage{
		nil,
		json.RawMessage(`{}`),
		json.RawMessage(`{"modes":["omni_ref"]}`),
		json.RawMessage(`{"modes":["omni_ref"],"omniRefImageEnabled":false,"omniRefVideoEnabled":true,"omniRefAudioEnabled":false}`),
		json.RawMessage(`{"modes":["t2v"],"omniRefImageEnabled":false,"omniRefVideoEnabled":false,"omniRefAudioEnabled":false}`),
	} {
		if err := validateOmniReferenceConfig(raw); err != nil {
			t.Fatalf("config %s: %v", raw, err)
		}
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"omniRefImageEnabled":false,"omniRefVideoEnabled":false,"omniRefAudioEnabled":false}`),
		json.RawMessage(`{"modes":["omni_ref"],"omniRefImageEnabled":false,"omniRefVideoEnabled":false,"omniRefAudioEnabled":false}`),
		json.RawMessage(`{"modes":["omni_ref"],"omniRefImageEnabled":"no"}`),
	} {
		if err := validateOmniReferenceConfig(raw); err == nil {
			t.Fatalf("config %s should be rejected", raw)
		}
	}
}

func TestValidateReferenceVideoPricingConfig(t *testing.T) {
	for _, raw := range []json.RawMessage{
		nil,
		json.RawMessage(`{}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":false}`),
		json.RawMessage(`{"omniRefVideoEnabled":false,"referenceVideoBillingEnabled":true}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true,"durations":["7s",8],"resolutions":["720p"],"priceMatrix":{"7s":{"720p":49},"8s":{"720p":"56"}}}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true,"durations":["7s"],"resolutions":["720p"],"pricing":{"720P":{"7":49}}}`),
	} {
		if err := validateReferenceVideoPricingConfig(raw); err != nil {
			t.Fatalf("config %s: %v", raw, err)
		}
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"referenceVideoBillingEnabled":`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true,"durations":["seven"],"resolutions":["720p"],"priceMatrix":{"seven":{"720p":49}}}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true,"durations":["7s"],"resolutions":["720p"],"priceMatrix":{"7s":{"720p":0}}}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true,"durations":["7s","8s"],"resolutions":["720p"],"priceMatrix":{"7s":{"720p":49}}}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true,"durations":["7s"],"resolutions":["720p","1080p"],"priceMatrix":{"7s":{"720p":49}}}`),
		json.RawMessage(`{"referenceVideoBillingEnabled":true,"durations":["7s"],"resolutions":["720p"],"priceMatrix":{"7s":{"720p":1e308}}}`),
	} {
		if err := validateReferenceVideoPricingConfig(raw); err == nil {
			t.Fatalf("config %s should be rejected", raw)
		}
	}
}

func TestAdminModelStatusRejectsInvalidReferenceVideoPricing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openModelsTestDB(t)
	row := model.MarketModel{
		Name:     "Invalid reference billing",
		ModelKey: "invalid-reference-billing",
		Type:     "video",
		Status:   2,
		Config:   `{"referenceVideoBillingEnabled":true}`,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Params = gin.Params{{Key: "id", Value: row.ID.String()}}
	c.Request = httptest.NewRequest(http.MethodPut, "/admin/models/"+row.ID.String()+"/status", strings.NewReader(`{"enabled":true}`))
	c.Request.Header.Set("Content-Type", "application/json")
	(&modelsHandler{db: db}).setStatus(c)

	if err := db.First(&row, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != 2 {
		t.Fatalf("invalid billing model status = %d, want 2", row.Status)
	}
	if !strings.Contains(recorder.Body.String(), "开启参考视频计费后") {
		t.Fatalf("response = %s, want reference-video pricing validation error", recorder.Body.String())
	}
}

func TestAdminModelUpdateCannotPublishInvalidReferenceVideoPricing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openModelsTestDB(t)
	row := model.MarketModel{
		Name:     "Invalid reference billing update",
		ModelKey: "invalid-reference-billing-update",
		Type:     "video",
		Status:   2,
		Config:   `{"referenceVideoBillingEnabled":true}`,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Params = gin.Params{{Key: "id", Value: row.ID.String()}}
	c.Request = httptest.NewRequest(http.MethodPut, "/admin/models/"+row.ID.String(), strings.NewReader(`{"status":1}`))
	c.Request.Header.Set("Content-Type", "application/json")
	(&modelsHandler{db: db}).update(c)

	if err := db.First(&row, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != 2 {
		t.Fatalf("invalid billing model status = %d, want 2", row.Status)
	}
	if !strings.Contains(recorder.Body.String(), "开启参考视频计费后") {
		t.Fatalf("response = %s, want reference-video pricing validation error", recorder.Body.String())
	}
}

func TestAdminModelCreatePersists3DTypeAndPendingStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openModelsTestDB(t)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/admin/models", strings.NewReader(`{
		"name":"Hunyuan 3D 3.1",
		"type":"3d",
		"modelKey":"hy-3d-3.1",
		"status":0,
		"config":{"modes":["t2_3d"]}
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	(&modelsHandler{db: db}).create(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var row model.MarketModel
	if err := db.Where("model_key = ?", "hy-3d-3.1").First(&row).Error; err != nil {
		t.Fatalf("load created 3D model: %v", err)
	}
	if row.Type != "3d" || row.Status != 0 {
		t.Fatalf("created row type/status = %q/%d, want 3d/0", row.Type, row.Status)
	}
	if !strings.Contains(row.Config, `"t2_3d"`) {
		t.Fatalf("config = %s, want t2_3d mode", row.Config)
	}
}

func TestAdminModelTypeOrderPersists3D(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openModelsTestDB(t)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/admin/models/type-order", strings.NewReader(`{
		"types":["3d","text","audio","image","video"]
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	(&modelsHandler{db: db}).putTypeOrder(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var row model.SysConfig
	if err := db.Where("config_key = ?", model.ConfigKeyMarketTypeOrder).First(&row).Error; err != nil {
		t.Fatalf("load type order: %v", err)
	}
	// 未随请求提交的类型(upscale)按出厂顺序补到末尾,保证局部保存不藏分类。
	if row.ConfigValue != "3d,text,audio,image,video,upscale" {
		t.Fatalf("stored type order = %q", row.ConfigValue)
	}
}
