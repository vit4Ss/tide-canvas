package skillrun

import (
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

func TestBindPreparedArchivesCountsDirectUploadReservations(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.File{}, &model.FileUploadGrant{}, &model.SkillRunArtifact{}); err != nil {
		t.Fatal(err)
	}
	storageConfig := config.StorageConfig{Type: "local", LocalDir: t.TempDir()}
	ownerID := idgen.Next()
	if err := db.Create(&model.User{
		ID: ownerID, Username: "archive-quota", Email: "archive-quota@example.test", StorageQuota: 100,
	}).Error; err != nil {
		t.Fatal(err)
	}
	grant := model.FileUploadGrant{
		ID: idgen.Next(), OwnerID: ownerID,
		StorageKey:   "uploads/other/2026/08/" + ownerID.String() + "/reserved.txt",
		StorageScope: storage.ScopeID(storageConfig), OriginalName: "reserved.txt", ExpectedSize: 80,
		FileType: "other", Category: "general", ContentType: "text/plain", ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	run := &model.SkillRun{BaseModel: model.BaseModel{ID: idgen.Next()}, UserID: ownerID, EntryPoint: "asset"}
	artifactID := idgen.Next()
	artifact := model.SkillRunArtifact{
		BaseModel: model.BaseModel{ID: artifactID}, RunID: run.ID, Type: "file", URL: "https://provider.example.test/result.txt", IsFinal: true,
	}
	if err := db.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	sourceID := artifactID
	prepared := preparedAssetArchives{
		artifactID: {
			Prepared: true,
			File: model.File{
				ID: idgen.Next(), OwnerID: ownerID, SourceArtifactID: &sourceID, OriginalName: "result.txt",
				StorageKey: "archives/result.txt", FileUrl: "https://cdn.example.test/result.txt", FileSize: 30,
				FileType: "other", Category: "general", MimeType: "text/plain", StorageType: "local",
			},
		},
	}
	svc := &service{db: db, deps: &app.Deps{DB: db, Cfg: &config.Config{Storage: storageConfig}}}
	err = db.Transaction(func(tx *gorm.DB) error {
		return svc.bindPreparedArchivesTx(tx, run, prepared)
	})
	if err == nil || !strings.Contains(err.Error(), "storage quota is insufficient") {
		t.Fatalf("archive error = %v, want reserved quota rejection", err)
	}
	var files int64
	if countErr := db.Model(&model.File{}).Count(&files).Error; countErr != nil || files != 0 {
		t.Fatalf("rejected archive created %d files, err=%v", files, countErr)
	}
	var persistedArtifact model.SkillRunArtifact
	if findErr := db.First(&persistedArtifact, "id = ?", artifactID).Error; findErr != nil || persistedArtifact.FileID != 0 {
		t.Fatalf("rejected archive bound file_id=%s, err=%v", persistedArtifact.FileID, findErr)
	}
}

func TestBindPreparedArchivesAllowsExistingFileWhenQuotaReserved(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.File{}, &model.FileUploadGrant{}, &model.SkillRunArtifact{}); err != nil {
		t.Fatal(err)
	}
	storageConfig := config.StorageConfig{Type: "local", LocalDir: t.TempDir()}
	ownerID := idgen.Next()
	if err := db.Create(&model.User{
		ID: ownerID, Username: "archive-existing", Email: "archive-existing@example.test", StorageQuota: 100, StorageUsed: 100,
	}).Error; err != nil {
		t.Fatal(err)
	}
	grant := model.FileUploadGrant{
		ID: idgen.Next(), OwnerID: ownerID,
		StorageKey:   "uploads/other/2026/08/" + ownerID.String() + "/reserved-existing.txt",
		StorageScope: storage.ScopeID(storageConfig), OriginalName: "reserved-existing.txt", ExpectedSize: 10,
		FileType: "other", Category: "general", ContentType: "text/plain", ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	run := &model.SkillRun{BaseModel: model.BaseModel{ID: idgen.Next()}, UserID: ownerID, EntryPoint: "asset"}
	artifactID := idgen.Next()
	artifact := model.SkillRunArtifact{
		BaseModel: model.BaseModel{ID: artifactID}, RunID: run.ID, Type: "file", URL: "https://provider.example.test/existing.txt", IsFinal: true,
	}
	if err := db.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	sourceID := artifactID
	existingFile := model.File{
		ID: idgen.Next(), OwnerID: ownerID, SourceArtifactID: &sourceID, OriginalName: "existing.txt",
		StorageKey: "archives/existing.txt", FileUrl: "https://cdn.example.test/existing.txt", FileSize: 30,
		FileType: "other", Category: "general", MimeType: "text/plain", StorageType: "local",
	}
	if err := db.Create(&existingFile).Error; err != nil {
		t.Fatal(err)
	}
	prepared := preparedAssetArchives{
		artifactID: {Prepared: false, File: existingFile},
	}
	svc := &service{db: db, deps: &app.Deps{DB: db, Cfg: &config.Config{Storage: storageConfig}}}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return svc.bindPreparedArchivesTx(tx, run, prepared)
	}); err != nil {
		t.Fatalf("existing archive binding was blocked by quota reservations: %v", err)
	}
	var persistedArtifact model.SkillRunArtifact
	if err := db.First(&persistedArtifact, "id = ?", artifactID).Error; err != nil || persistedArtifact.FileID != existingFile.ID {
		t.Fatalf("existing archive file_id=%s err=%v", persistedArtifact.FileID, err)
	}
}
