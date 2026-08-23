package file

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
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

func newDedupTestService(t *testing.T) (*service, *gorm.DB, *storage.LocalStorage, model.User, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.File{}, &model.FileUploadGrant{}); err != nil {
		t.Fatal(err)
	}
	storageRoot := t.TempDir()
	storageConfig := config.StorageConfig{
		Type: "local", LocalDir: storageRoot, PublicURL: "http://localhost:8080/static",
	}
	store, err := storage.NewLocalStorage(storageConfig)
	if err != nil {
		t.Fatal(err)
	}
	userToken := idgen.Next().String()
	user := model.User{
		ID: idgen.Next(), Username: "dedup-" + userToken, Email: "dedup-" + userToken + "@example.test", StorageQuota: 1 << 30,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	return &service{repo: newRepo(db), store: store, storageScope: storage.ScopeID(storageConfig)}, db, store, user, storageRoot
}

func testHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

type directTestStorage struct {
	*storage.LocalStorage
}

func (s *directTestStorage) Type() string { return "oss" }

func (s *directTestStorage) Presign(_ context.Context, key, contentType string, _ int64) (storage.PresignResult, error) {
	return storage.PresignResult{
		Direct: true, UploadURL: "https://upload.example.test/" + key, Key: key,
		FileURL: s.URL(key), ContentType: contentType,
	}, nil
}

func TestServerUploadReusesSameUserContent(t *testing.T) {
	svc, db, _, user, storageRoot := newDedupTestService(t)
	data := []byte("same file contents")
	upload := func(name string) *FileVO {
		vo, err := svc.upload(context.Background(), user.ID, uploadInput{
			OriginalName: name, ContentType: "text/plain", Size: int64(len(data)), Reader: bytes.NewReader(data),
		})
		if err != nil {
			t.Fatal(err)
		}
		return vo
	}

	first := upload("first.txt")
	second := upload("renamed.txt")
	if first.ID != second.ID || !second.Reused {
		t.Fatalf("duplicate upload returned first=%s second=%s reused=%v", first.ID, second.ID, second.Reused)
	}
	var count int64
	if err := db.Model(&model.File{}).Where("owner_id = ?", user.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("file rows = %d, err=%v", count, err)
	}
	var persistedUser model.User
	if err := db.First(&persistedUser, "id = ?", user.ID).Error; err != nil || persistedUser.StorageUsed != int64(len(data)) {
		t.Fatalf("storage used = %d, err=%v", persistedUser.StorageUsed, err)
	}
	objectCount := 0
	err := filepath.Walk(storageRoot, func(_ string, info os.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() {
			objectCount++
		}
		return err
	})
	if err != nil || objectCount != 1 {
		t.Fatalf("stored objects = %d, err=%v", objectCount, err)
	}
}

func TestDeleteRemovesOneHashedAssetAndAccountsOnce(t *testing.T) {
	svc, db, store, user, _ := newDedupTestService(t)
	data := []byte("delete exactly once")
	uploaded, err := svc.upload(context.Background(), user.ID, uploadInput{
		OriginalName: "delete.txt", ContentType: "text/plain", Size: int64(len(data)), Reader: bytes.NewReader(data),
	})
	if err != nil {
		t.Fatal(err)
	}
	var stored model.File
	if err := db.First(&stored, "id = ?", uploaded.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.delete(context.Background(), user.ID, uploaded.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.delete(context.Background(), user.ID, uploaded.ID); !errors.Is(err, errFileNotFound) {
		t.Fatalf("second delete error = %v", err)
	}
	var persistedUser model.User
	if err := db.First(&persistedUser, "id = ?", user.ID).Error; err != nil || persistedUser.StorageUsed != 0 {
		t.Fatalf("storage used = %d, err=%v", persistedUser.StorageUsed, err)
	}
	if _, err := store.Stat(context.Background(), stored.StorageKey); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted object still exists: %v", err)
	}
}

func TestHistoricalNullHashRowsAreLeftUntouched(t *testing.T) {
	svc, db, _, user, _ := newDedupTestService(t)
	legacy := model.File{
		ID: idgen.Next(), OwnerID: user.ID, OriginalName: "legacy.txt", StorageKey: "legacy/object.txt",
		FileUrl: "http://localhost:8080/static/legacy/object.txt", FileSize: 4, FileType: "other",
		Category: assetCategoryGeneral, MimeType: "text/plain", StorageType: "local",
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	legacyDuplicate := legacy
	legacyDuplicate.ID = idgen.Next()
	legacyDuplicate.OriginalName = "legacy-copy.txt"
	legacyDuplicate.StorageKey = "legacy/object-copy.txt"
	legacyDuplicate.FileUrl = "http://localhost:8080/static/legacy/object-copy.txt"
	if err := db.Create(&legacyDuplicate).Error; err != nil {
		t.Fatalf("historical NULL-hash duplicates must remain valid: %v", err)
	}
	data := []byte("same file contents")
	created, err := svc.upload(context.Background(), user.ID, uploadInput{
		OriginalName: "new.txt", ContentType: "text/plain", Size: int64(len(data)), Reader: bytes.NewReader(data),
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == legacy.ID || created.Reused {
		t.Fatal("a pre-release NULL-hash row was unexpectedly folded into new deduplication")
	}
	var count int64
	if err := db.Model(&model.File{}).Where("owner_id = ?", user.ID).Count(&count).Error; err != nil || count != 3 {
		t.Fatalf("file rows = %d, err=%v", count, err)
	}
}

func TestContentHashSchemaUpgradeKeepsHistoricalRowsNullable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE files (
		id INTEGER PRIMARY KEY,
		owner_id INTEGER NOT NULL,
		original_name TEXT
	)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO files (id, owner_id, original_name) VALUES
		(1, 7, 'legacy-a.png'), (2, 7, 'legacy-b.png')`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.File{}); err != nil {
		t.Fatalf("adding nullable content hashes to historical duplicates failed: %v", err)
	}
	var rows []model.File
	if err := db.Order("id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].ContentHash != nil || rows[1].ContentHash != nil {
		t.Fatalf("historical rows were rewritten: %#v", rows)
	}
	hash := testHash([]byte("new content"))
	firstNew := model.File{ID: 3, OwnerID: 7, OriginalName: "new-a.png", ContentHash: &hash}
	if err := db.Create(&firstNew).Error; err != nil {
		t.Fatal(err)
	}
	secondNew := model.File{ID: 4, OwnerID: 7, OriginalName: "new-b.png", ContentHash: &hash}
	if err := db.Create(&secondNew).Error; err == nil {
		t.Fatal("same-owner post-upgrade duplicate bypassed the unique content index")
	}
}

func TestSameContentIsNotReusedAcrossUsers(t *testing.T) {
	svc, db, _, firstUser, _ := newDedupTestService(t)
	secondToken := idgen.Next().String()
	secondUser := model.User{
		ID: idgen.Next(), Username: "dedup-other-" + secondToken, Email: "dedup-other-" + secondToken + "@example.test", StorageQuota: 1 << 30,
	}
	if err := db.Create(&secondUser).Error; err != nil {
		t.Fatal(err)
	}
	data := []byte("shared bytes owned independently")
	upload := func(ownerID idgen.ID) *FileVO {
		vo, err := svc.upload(context.Background(), ownerID, uploadInput{
			OriginalName: "shared.txt", ContentType: "text/plain", Size: int64(len(data)), Reader: bytes.NewReader(data),
		})
		if err != nil {
			t.Fatal(err)
		}
		return vo
	}

	first := upload(firstUser.ID)
	second := upload(secondUser.ID)
	if first.ID == second.ID || second.Reused {
		t.Fatalf("cross-user upload was incorrectly reused: first=%s second=%s reused=%v", first.ID, second.ID, second.Reused)
	}
	var count int64
	if err := db.Model(&model.File{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("file rows = %d, err=%v", count, err)
	}
}

func TestDirectRegistrationReusesContentAndDefersObjectCleanup(t *testing.T) {
	svc, db, store, user, storageRoot := newDedupTestService(t)
	data := []byte("direct upload contents")
	register := func(suffix string) *FileVO {
		key := "uploads/other/2026/08/" + user.ID.String() + "/" + suffix + ".txt"
		if _, err := store.Save(context.Background(), key, bytes.NewReader(data), "text/plain"); err != nil {
			t.Fatal(err)
		}
		grant := model.FileUploadGrant{
			ID: idgen.Next(), OwnerID: user.ID, StorageKey: key, StorageScope: svc.storageScope,
			OriginalName: suffix + ".txt", ExpectedSize: int64(len(data)), FileType: "other",
			Category: assetCategoryGeneral, ContentType: "text/plain", ExpiresAt: time.Now().Add(time.Minute),
		}
		if err := db.Create(&grant).Error; err != nil {
			t.Fatal(err)
		}
		vo, err := svc.register(context.Background(), user.ID, registerDTO{Key: key})
		if err != nil {
			t.Fatal(err)
		}
		return vo
	}

	first := register("10001")
	second := register("10002")
	if first.ID != second.ID || !second.Reused {
		t.Fatalf("direct duplicate returned first=%s second=%s reused=%v", first.ID, second.ID, second.Reused)
	}
	duplicateKey := "uploads/other/2026/08/" + user.ID.String() + "/10002.txt"
	if _, err := store.Stat(context.Background(), duplicateKey); err != nil {
		t.Fatalf("duplicate object was removed while its signed URL could still be replayed: %v", err)
	}
	var duplicateGrant model.FileUploadGrant
	if err := db.First(&duplicateGrant, "storage_key = ?", duplicateKey).Error; err != nil {
		t.Fatal(err)
	}
	if duplicateGrant.ConsumedAt == nil || !duplicateGrant.CleanupObject || duplicateGrant.RegisteredFileID != first.ID {
		t.Fatalf("duplicate grant was not scheduled for cleanup: %#v", duplicateGrant)
	}
	if err := db.Model(&model.FileUploadGrant{}).Where("id = ?", duplicateGrant.ID).
		Update("expires_at", time.Now().Add(-uploadGrantCleanupGrace-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	storageConfig := config.StorageConfig{
		Type: "local", LocalDir: storageRoot, PublicURL: "http://localhost:8080/static",
	}
	removed, err := sweepExpiredUploadGrants(context.Background(), &app.Deps{
		DB: db, Storage: store, Cfg: &config.Config{Storage: storageConfig},
	}, "dedup-cleaner")
	if err != nil || removed != 1 {
		t.Fatalf("deferred cleanup removed=%d err=%v", removed, err)
	}
	if _, err := store.Stat(context.Background(), duplicateKey); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expired duplicate object still exists: %v", err)
	}
	var count int64
	if err := db.Model(&model.File{}).Where("owner_id = ?", user.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("file rows = %d, err=%v", count, err)
	}
}

func TestPresignCanReturnExistingHashedAssetBeforeUpload(t *testing.T) {
	svc, db, _, user, _ := newDedupTestService(t)
	data := []byte("already uploaded")
	hash := testHash(data)
	existing := model.File{
		ID: idgen.Next(), OwnerID: user.ID, OriginalName: "existing.txt", ContentHash: &hash,
		StorageKey: "uploads/other/2026/08/" + user.ID.String() + "/existing.txt",
		FileUrl:    "http://localhost:8080/static/existing.txt", FileSize: int64(len(data)), FileType: "other",
		Category: assetCategoryGeneral, MimeType: "text/plain", StorageType: "local",
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatal(err)
	}
	result, err := svc.presign(context.Background(), user.ID, presignDTO{
		Filename: "same-again.txt", ContentType: "text/plain", ContentHash: hash, Size: int64(len(data)),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExistingFile == nil || result.ExistingFile.ID != existing.ID || !result.ExistingFile.Reused {
		t.Fatalf("presign did not reuse existing asset: %#v", result.ExistingFile)
	}
}

func TestRepeatedPresignExtendsSharedGrantPastNewestSignature(t *testing.T) {
	svc, db, localStore, user, _ := newDedupTestService(t)
	svc.store = &directTestStorage{LocalStorage: localStore}
	hash := testHash([]byte("same direct upload"))
	dto := presignDTO{
		Filename: "same.txt", ContentType: "text/plain", ContentHash: hash, Size: int64(len("same direct upload")),
	}
	first, err := svc.presign(context.Background(), user.ID, dto)
	if err != nil || !first.Direct || first.Key == "" {
		t.Fatalf("first presign = %#v, err=%v", first, err)
	}
	nearExpiry := time.Now().Add(time.Minute)
	if err := db.Model(&model.FileUploadGrant{}).Where("owner_id = ?", user.ID).Update("expires_at", nearExpiry).Error; err != nil {
		t.Fatal(err)
	}
	beforeSecond := time.Now()
	second, err := svc.presign(context.Background(), user.ID, dto)
	if err != nil || second.Key != first.Key {
		t.Fatalf("second presign = %#v, err=%v", second, err)
	}
	var grants []model.FileUploadGrant
	if err := db.Where("owner_id = ?", user.ID).Find(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].ExpiresAt.Before(beforeSecond.Add(directUploadGrantTTL-time.Second)) {
		t.Fatalf("shared grant expiry was not extended: %#v", grants)
	}
}

func TestPresignCountsDeferredDuplicateObjectsAgainstQuota(t *testing.T) {
	svc, db, localStore, user, _ := newDedupTestService(t)
	svc.store = &directTestStorage{LocalStorage: localStore}
	if err := db.Model(&model.User{}).Where("id = ?", user.ID).
		Updates(map[string]any{"storage_quota": 100, "storage_used": 60}).Error; err != nil {
		t.Fatal(err)
	}
	consumed := time.Now()
	deferred := model.FileUploadGrant{
		ID: idgen.Next(), OwnerID: user.ID,
		StorageKey:   "uploads/other/2026/08/" + user.ID.String() + "/deferred.txt",
		StorageScope: svc.storageScope, OriginalName: "deferred.txt", ExpectedSize: 30,
		FileType: "other", Category: assetCategoryGeneral, ContentType: "text/plain",
		ExpiresAt: time.Now().Add(time.Minute), ConsumedAt: &consumed,
		RegisteredFileID: idgen.Next(), CleanupObject: true,
	}
	if err := db.Create(&deferred).Error; err != nil {
		t.Fatal(err)
	}
	_, err := svc.presign(context.Background(), user.ID, presignDTO{
		Filename: "new.txt", ContentType: "text/plain", ContentHash: testHash([]byte("new 20-byte content!!")), Size: 20,
	})
	if !errors.Is(err, errStorageInsufficient) {
		t.Fatalf("presign error = %v, want deferred object to reserve quota", err)
	}
}

func TestServerUploadCountsDirectReservationsAgainstQuota(t *testing.T) {
	svc, db, _, user, storageRoot := newDedupTestService(t)
	if err := db.Model(&model.User{}).Where("id = ?", user.ID).
		Updates(map[string]any{"storage_quota": 100, "storage_used": 0}).Error; err != nil {
		t.Fatal(err)
	}
	reservedGrant := model.FileUploadGrant{
		ID: idgen.Next(), OwnerID: user.ID,
		StorageKey:   "uploads/other/2026/08/" + user.ID.String() + "/reserved.txt",
		StorageScope: svc.storageScope, OriginalName: "reserved.txt", ExpectedSize: 80,
		FileType: "other", Category: assetCategoryGeneral, ContentType: "text/plain",
		ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := db.Create(&reservedGrant).Error; err != nil {
		t.Fatal(err)
	}
	data := bytes.Repeat([]byte{'x'}, 30)
	if _, err := svc.upload(context.Background(), user.ID, uploadInput{
		OriginalName: "multipart.txt", ContentType: "text/plain", Size: int64(len(data)), Reader: bytes.NewReader(data),
	}); !errors.Is(err, errStorageInsufficient) {
		t.Fatalf("multipart upload error = %v, want direct reservation to consume quota", err)
	}
	var files int64
	if err := db.Model(&model.File{}).Count(&files).Error; err != nil || files != 0 {
		t.Fatalf("over-quota upload created %d files, err=%v", files, err)
	}
	objectCount := 0
	if err := filepath.Walk(storageRoot, func(_ string, info os.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() {
			objectCount++
		}
		return err
	}); err != nil || objectCount != 0 {
		t.Fatalf("rejected multipart object count=%d err=%v", objectCount, err)
	}
}

func TestDeferredCleanupNeverDeletesCanonicalFileObject(t *testing.T) {
	svc, db, store, user, storageRoot := newDedupTestService(t)
	data := []byte("canonical object")
	key := "uploads/other/2026/08/" + user.ID.String() + "/canonical.txt"
	url, err := store.Save(context.Background(), key, bytes.NewReader(data), "text/plain")
	if err != nil {
		t.Fatal(err)
	}
	hash := testHash(data)
	fileRow := model.File{
		ID: idgen.Next(), OwnerID: user.ID, OriginalName: "canonical.txt", ContentHash: &hash,
		StorageKey: key, FileUrl: url, FileSize: int64(len(data)), FileType: "other",
		Category: assetCategoryGeneral, MimeType: "text/plain", StorageType: "local",
	}
	if err := db.Create(&fileRow).Error; err != nil {
		t.Fatal(err)
	}
	consumed := time.Now().Add(-time.Hour)
	grant := model.FileUploadGrant{
		ID: idgen.Next(), OwnerID: user.ID, StorageKey: key, StorageScope: svc.storageScope,
		OriginalName: "canonical.txt", ExpectedSize: int64(len(data)), FileType: "other",
		Category: assetCategoryGeneral, ContentType: "text/plain",
		ExpiresAt: time.Now().Add(-uploadGrantCleanupGrace - time.Minute), ConsumedAt: &consumed,
		RegisteredFileID: fileRow.ID, CleanupObject: true,
	}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	storageConfig := config.StorageConfig{
		Type: "local", LocalDir: storageRoot, PublicURL: "http://localhost:8080/static",
	}
	removed, err := sweepExpiredUploadGrants(context.Background(), &app.Deps{
		DB: db, Storage: store, Cfg: &config.Config{Storage: storageConfig},
	}, "canonical-cleaner")
	if err != nil || removed != 0 {
		t.Fatalf("canonical cleanup removed=%d err=%v", removed, err)
	}
	if _, err := store.Stat(context.Background(), key); err != nil {
		t.Fatalf("canonical object was deleted: %v", err)
	}
	var persistedGrant model.FileUploadGrant
	if err := db.First(&persistedGrant, "id = ?", grant.ID).Error; err != nil || persistedGrant.CleanupObject {
		t.Fatalf("canonical grant cleanup marker was not cleared: %#v err=%v", persistedGrant, err)
	}
}

func TestDirectRegistrationRejectsClientHashMismatch(t *testing.T) {
	svc, db, store, user, _ := newDedupTestService(t)
	data := []byte("authoritative direct-upload bytes")
	key := "uploads/other/2026/08/" + user.ID.String() + "/mismatch.txt"
	if _, err := store.Save(context.Background(), key, bytes.NewReader(data), "text/plain"); err != nil {
		t.Fatal(err)
	}
	wrongHash := testHash([]byte("different bytes"))
	grant := model.FileUploadGrant{
		ID: idgen.Next(), OwnerID: user.ID, StorageKey: key, StorageScope: svc.storageScope,
		OriginalName: "mismatch.txt", ContentHash: wrongHash, ExpectedSize: int64(len(data)), FileType: "other",
		Category: assetCategoryGeneral, ContentType: "text/plain", ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.register(context.Background(), user.ID, registerDTO{Key: key}); !errors.Is(err, errUploadMismatch) {
		t.Fatalf("register error = %v, want %v", err, errUploadMismatch)
	}
	var count int64
	if err := db.Model(&model.File{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("mismatched direct upload created %d file rows, err=%v", count, err)
	}
}
