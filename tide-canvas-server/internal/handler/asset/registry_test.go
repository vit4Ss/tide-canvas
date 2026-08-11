package asset

import (
	"context"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func assetTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.MediaAsset{}); err != nil {
		t.Fatalf("migrate media assets: %v", err)
	}
	return db
}

func TestFinalizeGenerationKeepsIndependentOutputsAndDeletionTombstone(t *testing.T) {
	db := assetTestDB(t)
	now := time.Now().Truncate(time.Second)
	task := &model.AiTask{
		ID:         idgen.Next(),
		UserID:     idgen.Next(),
		ProjectID:  idgen.Next(),
		Handler:    "text_to_image",
		ModelName:  "Image Model",
		Status:     0,
		CreateTime: now,
		UpdateTime: now,
	}
	ctx := context.Background()
	if err := EnsureGenerationPending(ctx, db, task); err != nil {
		t.Fatalf("create pending asset: %v", err)
	}

	task.Status = 1
	task.ResultUrl = "https://assets.test/one.png"
	task.ResultMeta = `{"urls":["https://assets.test/one.png","https://assets.test/two.png"]}`
	if err := FinalizeGeneration(ctx, db, task); err != nil {
		t.Fatalf("finalize generation: %v", err)
	}
	var rows []model.MediaAsset
	if err := db.Order("output_index ASC").Find(&rows).Error; err != nil {
		t.Fatalf("list outputs: %v", err)
	}
	if len(rows) != 2 || rows[0].Status != StatusReady || rows[1].OutputIndex != 1 {
		t.Fatalf("expected two ready independent outputs, got %#v", rows)
	}

	if err := db.Model(&model.MediaAsset{}).Where("id = ?", rows[0].ID).Update("removed", true).Error; err != nil {
		t.Fatalf("tombstone output: %v", err)
	}
	if err := FinalizeGeneration(ctx, db, task); err != nil {
		t.Fatalf("repeat finalize: %v", err)
	}
	var first model.MediaAsset
	if err := db.First(&first, "id = ?", rows[0].ID).Error; err != nil {
		t.Fatalf("reload tombstone: %v", err)
	}
	if !first.Removed {
		t.Fatal("re-finalization resurrected a deleted output")
	}
}

func TestEnsureUploadSkipsInternalSkillArchive(t *testing.T) {
	db := assetTestDB(t)
	artifactID := idgen.Next()
	file := &model.File{
		ID:               idgen.Next(),
		OwnerID:          idgen.Next(),
		SourceArtifactID: &artifactID,
		OriginalName:     "generated.png",
		FileUrl:          "https://assets.test/generated.png",
		FileType:         "image",
		MimeType:         "image/png",
		CreateTime:       time.Now(),
	}
	if err := EnsureUpload(context.Background(), db, file); err != nil {
		t.Fatalf("ensure upload: %v", err)
	}
	var count int64
	if err := db.Model(&model.MediaAsset{}).Count(&count).Error; err != nil {
		t.Fatalf("count assets: %v", err)
	}
	if count != 0 {
		t.Fatalf("internal generated archive was indexed as an upload: %d", count)
	}
}
