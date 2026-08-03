package project

import (
	"errors"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func openProjectRevisionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "-") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "cgo") {
			t.Skip("sqlite driver requires CGO in this environment")
		}
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Project{}); err != nil {
		t.Fatalf("migrate project: %v", err)
	}
	return db
}

func TestSaveCanvasCASRejectsStaleWholeSnapshot(t *testing.T) {
	db := openProjectRevisionTestDB(t)
	r := newRepo(db)
	projectID, ownerID := idgen.ID(1001), idgen.ID(7)
	if err := r.create(&model.Project{
		ID: projectID, OwnerID: ownerID, Name: "Canvas", CanvasData: `{"nodes":[]}`,
		UrlToken: "revision-test", Revision: 0,
	}); err != nil {
		t.Fatalf("create project: %v", err)
	}

	next, err := r.saveCanvasCAS(projectID, ownerID, 0, map[string]any{
		"canvas_data": `{"nodes":[{"id":"new"}]}`,
	})
	if err != nil || next != 1 {
		t.Fatalf("first CAS = (%d, %v), want (1, nil)", next, err)
	}

	if _, err := r.saveCanvasCAS(projectID, ownerID, 0, map[string]any{
		"canvas_data": `{"nodes":[{"id":"stale"}]}`,
	}); !errors.Is(err, errRevisionConflict) {
		t.Fatalf("stale CAS error = %v, want %v", err, errRevisionConflict)
	}

	stored, err := r.findByID(projectID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != 1 || stored.CanvasData != `{"nodes":[{"id":"new"}]}` {
		t.Fatalf("stale save changed committed snapshot: revision=%d canvas=%s", stored.Revision, stored.CanvasData)
	}
}

func TestSaveCanvasRejectsMissingOrNegativeRevisionBeforeWrite(t *testing.T) {
	svc := &service{}
	if _, err := svc.saveCanvas(1, 1, CanvasSaveDTO{CanvasData: "{}"}); !errors.Is(err, errInvalidRevision) {
		t.Fatalf("missing revision error = %v, want %v", err, errInvalidRevision)
	}
	negative := int64(-1)
	if _, err := svc.saveCanvas(1, 1, CanvasSaveDTO{
		CanvasData: "{}", ExpectedRevision: &negative,
	}); !errors.Is(err, errInvalidRevision) {
		t.Fatalf("negative revision error = %v, want %v", err, errInvalidRevision)
	}
}
