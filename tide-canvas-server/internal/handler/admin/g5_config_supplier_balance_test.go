package admin

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
)

func TestSupplierBalanceTokenIsMaskedAndMaskPreservesStoredValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var sqlLogs bytes.Buffer
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: gormlogger.New(
		log.New(&sqlLogs, "", 0),
		gormlogger.Config{LogLevel: gormlogger.Info},
	)})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	row := model.SysConfig{
		ConfigKey:   model.ConfigKeyBalanceMikotoAccessToken,
		ConfigValue: "original-secret-token",
		Group:       model.ConfigGroupSupplierBalances,
		Description: "Mikoto token",
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("seed token: %v", err)
	}

	router := gin.New()
	group := router.Group("")
	RegisterConfig(group, &app.Deps{DB: db})

	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/config", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("GET /config status = %d, body=%s", get.Code, get.Body.String())
	}
	var listed struct {
		Data []ConfigVO `json:"data"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode GET response: %v", err)
	}
	if len(listed.Data) != 1 || listed.Data[0].ConfigValue != supplierConfigSecretMask {
		t.Fatalf("GET token value = %+v, want mask", listed.Data)
	}
	if bytes.Contains(get.Body.Bytes(), []byte("original-secret-token")) {
		t.Fatal("GET /config exposed the stored supplier token")
	}

	sqlLogs.Reset()
	putConfigValue(t, router, model.ConfigKeyBalanceMikotoAccessToken, supplierConfigSecretMask)
	if bytes.Contains(sqlLogs.Bytes(), []byte("original-secret-token")) {
		t.Fatal("preserved supplier token was written to SQL logs")
	}
	var stored model.SysConfig
	if err := db.Where("config_key = ?", model.ConfigKeyBalanceMikotoAccessToken).First(&stored).Error; err != nil {
		t.Fatalf("reload token: %v", err)
	}
	if stored.ConfigValue != "original-secret-token" {
		t.Fatalf("masked save replaced token with %q", stored.ConfigValue)
	}

	sqlLogs.Reset()
	putConfigValue(t, router, model.ConfigKeyBalanceMikotoAccessToken, "rotated-secret-token")
	if bytes.Contains(sqlLogs.Bytes(), []byte("rotated-secret-token")) {
		t.Fatal("supplier token was written to SQL logs")
	}
	if err := db.Where("config_key = ?", model.ConfigKeyBalanceMikotoAccessToken).First(&stored).Error; err != nil {
		t.Fatalf("reload rotated token: %v", err)
	}
	if stored.ConfigValue != "rotated-secret-token" {
		t.Fatalf("stored token = %q, want rotated value", stored.ConfigValue)
	}

	putConfigValue(t, router, model.ConfigKeyBalanceMikotoAccessToken, "   ")
	if err := db.Where("config_key = ?", model.ConfigKeyBalanceMikotoAccessToken).First(&stored).Error; err != nil {
		t.Fatalf("reload cleared token: %v", err)
	}
	if stored.ConfigValue != "" {
		t.Fatalf("stored token = %q, want cleared value", stored.ConfigValue)
	}
}

func putConfigValue(t *testing.T, router http.Handler, key, value string) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"items": []map[string]string{{
		"configKey": key, "configValue": value,
		"group": model.ConfigGroupSupplierBalances, "description": "Mikoto token",
	}}})
	if err != nil {
		t.Fatalf("marshal PUT body: %v", err)
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/config", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("PUT /config status = %d, body=%s", response.Code, response.Body.String())
	}
	if strings.TrimSpace(value) != "" && value != supplierConfigSecretMask && bytes.Contains(response.Body.Bytes(), []byte(value)) {
		t.Fatal("PUT /config exposed the newly stored supplier token")
	}
}

func TestSupplierBalanceThresholdRejectsNonFiniteValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatalf("migrate sys_config: %v", err)
	}
	router := gin.New()
	RegisterConfig(router.Group(""), &app.Deps{DB: db})

	body := []byte(`{"items":[{"configKey":"balance.mikoto.lowBalance","configValue":"Inf","group":"供应商余额"}]}`)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/config", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("non-finite threshold status = %d, body=%s", response.Code, response.Body.String())
	}
}
