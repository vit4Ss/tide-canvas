package ai

import (
	"context"
	"errors"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func capturedFrameTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.File{}, &model.AiTask{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRegisterCapturedFrameMovesUploadIntoGenerationHistory(t *testing.T) {
	db := capturedFrameTestDB(t)
	ownerID := idgen.ID(71001)
	fileID := idgen.ID(72001)
	if err := db.Create(&model.User{
		ID: ownerID, Username: "capture-owner", Email: "capture-owner@example.test", StorageUsed: 8192,
	}).Error; err != nil {
		t.Fatal(err)
	}
	uploaded := model.File{
		ID: fileID, OwnerID: ownerID, OriginalName: "frame-00-00-000.png",
		FileUrl: "https://cdn.example.test/frame.png", FileSize: 4096, FileType: "image", MimeType: "image/png",
	}
	if err := db.Create(&uploaded).Error; err != nil {
		t.Fatal(err)
	}

	svc := &service{repo: newRepo(db)}
	dto := capturedFrameDTO{
		FileID: fileID, CaptureTime: 0, Width: 1920, Height: 1080,
	}
	first, err := svc.registerCapturedFrame(context.Background(), ownerID, dto)
	if err != nil {
		t.Fatal(err)
	}
	if first.Handler != capturedFrameHandler || first.Status != statusSuccess || first.ResultURL != uploaded.FileUrl {
		t.Fatalf("unexpected task: %#v", first)
	}
	if first.ModelName != "视频截帧" || first.PointCost != 0 {
		t.Fatalf("unexpected capture metadata: %#v", first)
	}
	var files int64
	if err := db.Model(&model.File{}).Where("id = ?", fileID).Count(&files).Error; err != nil {
		t.Fatal(err)
	}
	if files != 0 {
		t.Fatalf("upload record still exists: count=%d", files)
	}
	var user model.User
	if err := db.First(&user, "id = ?", ownerID).Error; err != nil {
		t.Fatal(err)
	}
	if user.StorageUsed != 4096 {
		t.Fatalf("upload storage accounting was not transferred: storage_used=%d", user.StorageUsed)
	}

	// Retrying the promotion after an ambiguous response replays the same task,
	// even though the temporary File ownership receipt has already been removed.
	replayed, err := svc.registerCapturedFrame(context.Background(), ownerID, dto)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ID != first.ID {
		t.Fatalf("retry created a second task: first=%s replay=%s", first.ID.String(), replayed.ID.String())
	}
}

func TestRegisterCapturedFrameRejectsAnotherUsersUpload(t *testing.T) {
	db := capturedFrameTestDB(t)
	uploaded := model.File{
		ID: 73001, OwnerID: 71002, OriginalName: "frame.png",
		FileUrl: "https://cdn.example.test/private-frame.png", FileType: "image", MimeType: "image/png",
	}
	if err := db.Create(&uploaded).Error; err != nil {
		t.Fatal(err)
	}
	svc := &service{repo: newRepo(db)}
	_, err := svc.registerCapturedFrame(context.Background(), 71001, capturedFrameDTO{
		FileID: uploaded.ID, CaptureTime: 1, Width: 1280, Height: 720,
	})
	if !errors.Is(err, errCapturedFrameNotFound) {
		t.Fatalf("error = %v, want not found", err)
	}
}
