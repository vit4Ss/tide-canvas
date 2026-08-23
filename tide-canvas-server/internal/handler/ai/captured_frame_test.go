package ai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
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
		FileID: fileID, CaptureTime: 0, Width: 1920, Height: 1080, MoveOriginal: true,
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
	if err := db.Create(&model.User{
		ID: 71001, Username: "capture-caller", Email: "capture-caller@example.test",
	}).Error; err != nil {
		t.Fatal(err)
	}
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

func TestRegisterCapturedFrameAcceptsCompressedJPEG(t *testing.T) {
	db := capturedFrameTestDB(t)
	ownerID := idgen.ID(74001)
	fileID := idgen.ID(74002)
	if err := db.Create(&model.User{
		ID: ownerID, Username: "jpeg-owner", Email: "jpeg-owner@example.test",
	}).Error; err != nil {
		t.Fatal(err)
	}
	uploaded := model.File{
		ID: fileID, OwnerID: ownerID, OriginalName: "storyboard.jpg",
		FileUrl: "https://cdn.example.test/storyboard.jpg", FileSize: 2048, FileType: "image", MimeType: "image/jpeg",
	}
	if err := db.Create(&uploaded).Error; err != nil {
		t.Fatal(err)
	}
	svc := &service{repo: newRepo(db)}
	result, err := svc.registerCapturedFrame(context.Background(), ownerID, capturedFrameDTO{
		FileID: fileID, CaptureTime: 1.5, Width: 1920, Height: 1080, MoveOriginal: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ResultURL != uploaded.FileUrl {
		t.Fatalf("result URL = %q, want %q", result.ResultURL, uploaded.FileUrl)
	}
}

func TestRegisterCapturedFrameClonesReusedUploadAndPreservesOriginal(t *testing.T) {
	db := capturedFrameTestDB(t)
	ownerID := idgen.ID(75001)
	fileID := idgen.ID(75002)
	data := []byte("reused captured frame bytes")
	store, err := storage.NewLocalStorage(config.StorageConfig{
		LocalDir: t.TempDir(), PublicURL: "http://localhost:8080/static",
	})
	if err != nil {
		t.Fatal(err)
	}
	key := "uploads/image/2026/08/75001/source.png"
	url, err := store.Save(context.Background(), key, bytes.NewReader(data), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{
		ID: ownerID, Username: "reused-capture-owner", Email: "reused-capture-owner@example.test", StorageUsed: int64(len(data)),
	}).Error; err != nil {
		t.Fatal(err)
	}
	uploaded := model.File{
		ID: fileID, OwnerID: ownerID, OriginalName: "source.png", StorageKey: key,
		FileUrl: url, FileSize: int64(len(data)), FileType: "image", MimeType: "image/png", StorageType: "local",
	}
	if err := db.Create(&uploaded).Error; err != nil {
		t.Fatal(err)
	}

	svc := &service{repo: newRepo(db), storage: store}
	result, err := svc.registerCapturedFrame(context.Background(), ownerID, capturedFrameDTO{
		FileID: fileID, CaptureTime: 2.5, Width: 1920, Height: 1080,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ResultURL == uploaded.FileUrl {
		t.Fatal("reused upload and generated history share one deletable object")
	}
	var preserved model.File
	if err := db.First(&preserved, "id = ?", fileID).Error; err != nil {
		t.Fatalf("reused upload was removed: %v", err)
	}
	var user model.User
	if err := db.First(&user, "id = ?", ownerID).Error; err != nil || user.StorageUsed != int64(len(data)) {
		t.Fatalf("storage used = %d, err=%v", user.StorageUsed, err)
	}
	const publicBase = "http://localhost:8080/static/"
	cloneKey := strings.TrimPrefix(result.ResultURL, publicBase)
	if cloneKey == result.ResultURL || cloneKey == "" {
		t.Fatalf("clone URL is not owned storage: %s", result.ResultURL)
	}
	stream, err := store.Open(context.Background(), cloneKey)
	if err != nil {
		t.Fatal(err)
	}
	cloned, readErr := io.ReadAll(stream)
	closeErr := stream.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(cloned, data) {
		t.Fatalf("cloned bytes mismatch: read=%v close=%v data=%q", readErr, closeErr, cloned)
	}
}
