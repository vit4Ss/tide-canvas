package studiotemplate

import (
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
	"tidecanvas/internal/model"
)

func TestPublicCatalogueOmitsPrivateRecipesButAdminCanEdit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	defer pool.Close()
	if err := db.AutoMigrate(&model.StudioTemplate{}); err != nil {
		t.Fatal(err)
	}
	row := model.StudioTemplate{Title: "Public title", Kind: "inspiration", MediaType: "image", Prompt: "SECRET_RECIPE", Status: 1}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	h := &Handler{DB: db}
	r := gin.New()
	r.GET("/list", h.List(false))
	r.GET("/detail/:id", h.Get)
	r.GET("/admin", h.List(true))
	for _, url := range []string{"/list", "/detail/" + row.ID.String(), "/admin"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		if url == "/admin" {
			if !strings.Contains(w.Body.String(), "SECRET_RECIPE") {
				t.Fatal("admin lost recipe")
			}
		} else if strings.Contains(w.Body.String(), "SECRET_RECIPE") || strings.Contains(w.Body.String(), `"prompt"`) {
			t.Fatal("public recipe leak")
		}
	}
}
