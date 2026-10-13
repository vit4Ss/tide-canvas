package file

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

func TestFileRenameKeepsOwnerAndStorageURL(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.File{}); err != nil {
		t.Fatal(err)
	}
	f := model.File{ID: 31, OwnerID: 1, OriginalName: "original.png", FileUrl: "https://example.test/file.png"}
	if err := db.Create(&f).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	owner := idgen.ID(2)
	r.Use(func(c *gin.Context) { c.Set(middleware.CtxUserID, owner) })
	h := &handler{svc: &service{repo: &repo{db: db}}}
	r.PUT("/files/:id/name", h.rename)
	request := func(name string) int {
		raw, _ := json.Marshal(map[string]string{"name": name})
		req := httptest.NewRequest("PUT", "/files/31/name", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}
	if request("other.png") != 404 {
		t.Fatal("renamed another user's file")
	}
	owner = 1
	if request("../outside.png") != 400 {
		t.Fatal("path accepted as a name")
	}
	if request("New name.png") != 200 {
		t.Fatal("valid name rejected")
	}
	var got model.File
	db.First(&got, "id = 31")
	if got.OriginalName != "New name.png" || got.FileUrl != f.FileUrl || got.OwnerID != 1 {
		t.Fatalf("rename changed storage identity: %+v", got)
	}
}
