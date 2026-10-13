package ai

import (
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestCreationRenameOwnershipAndSearch(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AiTask{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []model.AiTask{{ID: 11, UserID: 1, Status: 1, Handler: "text_to_image", ModelName: "Image", Input: "{}"}, {ID: 12, UserID: 2, Status: 1, Handler: "text_to_image"}, {ID: 13, UserID: 1, Status: 0, Handler: "text_to_image"}} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(middleware.CtxUserID, idgen.ID(1)) })
	h := &handler{svc: &service{repo: newRepo(db)}}
	r.PUT("/tasks/:id/name", h.renameTask)
	request := func(id, name string) int {
		raw, _ := json.Marshal(map[string]string{"name": name})
		req := httptest.NewRequest("PUT", "/tasks/"+id+"/name", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}
	if request("12", "Not mine") != 404 || request("13", "Still processing") != 404 {
		t.Fatal("renamed another user's or unfinished task")
	}
	if request("11", " ") != 400 || request("11", strings.Repeat("x", 161)) != 400 || request("11", "line\nbreak") != 400 {
		t.Fatal("invalid name accepted")
	}
	for range 2 {
		if request("11", "Product_100%") != 200 {
			t.Fatal("rename is not idempotent")
		}
	}
	var row model.AiTask
	db.First(&row, "id = 11")
	if row.DisplayName != "Product_100%" || row.ModelName != "Image" {
		t.Fatal("rename changed model identity")
	}
	var count int64
	if err := applyTaskListFilters(db.Model(&model.AiTask{}), 1, taskQuery{Keyword: "100%"}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("renamed creation is not searchable")
	}
	if err := applyTaskListFilters(db.Model(&model.AiTask{}), 2, taskQuery{Keyword: "100%"}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("search leaked another user's creation")
	}
}
