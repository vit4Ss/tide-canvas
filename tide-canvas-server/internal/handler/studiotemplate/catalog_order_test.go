package studiotemplate

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
)

func TestAdminNewestShowsNewPackWithoutChangingPublicDisplayOrder(t *testing.T) {
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
	if err := SeedContentPacks(db); err != nil {
		t.Fatal(err)
	}
	// Batch imports can share a timestamp. The ID tie-break must be stable.
	if err := db.Model(&model.StudioTemplate{}).Where("1 = 1").Update("create_time", time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	var imported []model.StudioTemplate
	if err := db.Where("source_key LIKE ?", GroupbuyPromoSourcePrefix+"%").Find(&imported).Error; err != nil {
		t.Fatal(err)
	}
	newIDs := map[string]bool{}
	for _, row := range imported {
		newIDs[row.ID.String()] = true
	}
	r := gin.New()
	h := &Handler{DB: db}
	r.GET("/admin", h.List(true))
	r.GET("/public", h.List(false))
	type result struct {
		Success bool
		Code    int
		Data    struct {
			Records []model.StudioTemplate
			Total   int
		}
	}
	get := func(path string) result {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		var response result
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response
	}
	seen := map[string]bool{}
	for _, page := range []string{"1", "2"} {
		response := get("/admin?mediaType=video&kind=inspiration&status=0&order=newest&pageSize=18&pageNum=" + page)
		if !response.Success || response.Data.Total != 70 || len(response.Data.Records) != 18 {
			t.Fatal("newest pagination failed", response)
		}
		for _, row := range response.Data.Records {
			if !newIDs[row.ID.String()] || seen[row.ID.String()] {
				t.Fatal("new batch hidden or unstable page order", row.Title)
			}
			seen[row.ID.String()] = true
		}
	}
	sorted := get("/admin?order=sort&pageSize=18")
	if !sorted.Success || sorted.Data.Records[0].SortOrder != 200 {
		t.Fatal("operator ordering changed")
	}
	old := sorted.Data.Records[0]
	newest := get("/admin?order=newest&pageSize=1").Data.Records[0]
	if err := db.Model(&model.StudioTemplate{}).Where("id IN ?", []any{old.ID, newest.ID}).Update("status", 1).Error; err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/public", "/public?order=newest", "/public?order=sort"} {
		response := get(path)
		if !response.Success || response.Data.Total != 2 || response.Data.Records[0].ID != old.ID {
			t.Fatal("public display order or draft isolation changed", path)
		}
	}
	if response := get("/admin?order=create_time"); response.Success || response.Code != 400 {
		t.Fatal("unsupported sort expression accepted")
	}
}
