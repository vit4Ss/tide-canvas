package admin

import (
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
