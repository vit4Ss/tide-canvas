package userkey

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlog "gorm.io/gorm/logger"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func setup(t *testing.T, skipDefault ...bool) (*gorm.DB, *Service) {
	t.Helper()
	skip := true // Match production db.Open, which disables default transactions.
	if len(skipDefault) > 0 {
		skip = skipDefault[0]
	}
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{Logger: gormlog.Default.LogMode(gormlog.Silent), SkipDefaultTransaction: skip, PrepareStmt: true})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { pool.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserAPIKey{}); err != nil {
		t.Fatal(err)
	}
	s, err := New(db, "test-only-vault-secret")
	if err != nil {
		t.Fatal(err)
	}
	return db, s
}

func TestFailedKeyInsertRollsBackUserWithEitherTransactionSetting(t *testing.T) {
	for _, skip := range []bool{true, false} {
		name := "default-transactions"
		if skip {
			name = "production-no-default-transactions"
		}
		t.Run(name, func(t *testing.T) {
			db, s := setup(t, skip)
			if err := s.Install(); err != nil {
				t.Fatal(err)
			}
			if err := db.Exec("CREATE TRIGGER reject_key BEFORE INSERT ON user_api_key BEGIN SELECT RAISE(ABORT, 'key storage failure'); END").Error; err != nil {
				t.Fatal(err)
			}
			u := model.User{ID: idgen.Next(), Username: "failed", Email: "failed@example.test"}
			if err := db.Create(&u).Error; err == nil {
				t.Fatal("key storage failure was ignored")
			}
			var count int64
			if err := db.Model(&model.User{}).Where("id = ?", u.ID).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatal("account survived failed default-key creation")
			}
			if db.SkipDefaultTransaction != skip {
				t.Fatal("global transaction policy was changed")
			}
		})
	}
}

func owner(t *testing.T, db *gorm.DB) model.User {
	t.Helper()
	id := idgen.Next()
	u := model.User{ID: id, Username: "user" + id.String(), Email: id.String() + "@example.test", Status: 1, Points: 57}
	if err := db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	return u
}

func TestAutomaticProvisioningAndRollback(t *testing.T) {
	db, s := setup(t)
	if err := s.Install(); err != nil {
		t.Fatal(err)
	}
	u := owner(t, db)
	var row model.UserAPIKey
	if err := db.First(&row, "user_id = ?", u.ID).Error; err != nil {
		t.Fatal("create callback did not provision key:", err)
	}
	value, err := s.Reveal(context.Background(), u.ID, row.Revision)
	if err != nil || !strings.HasPrefix(value, Prefix) {
		t.Fatalf("reveal: %v", err)
	}
	if strings.Contains(row.Ciphertext, value) || row.KeyHash == value {
		t.Fatal("plaintext was stored")
	}
	encoded, _ := json.Marshal(row)
	for _, sensitive := range []string{value, row.KeyHash, row.Ciphertext} {
		if strings.Contains(string(encoded), sensitive) {
			t.Fatal("serialized credential leaked a secret")
		}
	}
	abortedID := idgen.Next()
	_ = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&model.User{ID: abortedID, Username: "rollback", Email: "rollback@example.test"}).Error; err != nil {
			t.Fatal(err)
		}
		return errors.New("rollback")
	})
	var count int64
	db.Model(&model.UserAPIKey{}).Where("user_id = ?", abortedID).Count(&count)
	if count != 0 {
		t.Fatal("key survived rolled-back user creation")
	}
	// Bulk creation also provisions exactly one key per user.
	batch := []model.User{{ID: idgen.Next(), Username: "batch1", Email: "batch1@example.test"}, {ID: idgen.Next(), Username: "batch2", Email: "batch2@example.test"}}
	if err := db.Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	db.Model(&model.UserAPIKey{}).Count(&count)
	if count != 3 {
		t.Fatalf("key count = %d", count)
	}
}

func TestBackfillConcurrencyAndIndependentOwners(t *testing.T) {
	db, s := setup(t)
	first, second := owner(t, db), owner(t, db)
	const workers = 12
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- s.Backfill(context.Background()) }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	db.Model(&model.UserAPIKey{}).Count(&count)
	if count != 2 {
		t.Fatalf("backfill created %d keys", count)
	}
	a, _ := s.Ensure(context.Background(), first.ID)
	b, _ := s.Ensure(context.Background(), second.ID)
	keyA, _ := s.Reveal(context.Background(), first.ID, a.Revision)
	keyB, _ := s.Reveal(context.Background(), second.ID, b.Revision)
	if keyA == keyB || keyA == "" {
		t.Fatal("owners shared a key")
	}
	got, err := s.Authenticate(context.Background(), keyA)
	if err != nil || got.ID != first.ID || got.Points != 57 {
		t.Fatalf("authentication: %v", err)
	}
	// AES-GCM binds the encrypted credential to the owner as associated data.
	db.Model(&model.UserAPIKey{}).Where("user_id = ?", second.ID).Update("ciphertext", a.Ciphertext)
	if _, err := s.Reveal(context.Background(), second.ID, b.Revision); !errors.Is(err, ErrVault) {
		t.Fatal("cross-owner ciphertext was accepted")
	}
}

func TestIgnoredUserRowsDoNotCreateOrphanKeys(t *testing.T) {
	db, s := setup(t)
	if err := s.Install(); err != nil {
		t.Fatal(err)
	}
	u := owner(t, db)
	skippedID := idgen.Next()
	batch := []model.User{
		{ID: skippedID, Username: u.Username, Email: "collision@example.test"},
		{ID: idgen.Next(), Username: "new-user", Email: "new@example.test"},
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&batch).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.UserAPIKey{}).Where("user_id = ?", skippedID).Count(&count)
	if count != 0 {
		t.Fatal("skipped user insertion created an orphan key")
	}
	db.Model(&model.UserAPIKey{}).Count(&count)
	if count != 2 {
		t.Fatalf("key count = %d, want 2 real owners", count)
	}
}

func TestDisableRotateAndStaleMutations(t *testing.T) {
	db, s := setup(t)
	u := owner(t, db)
	ctx := context.Background()
	row, _ := s.Ensure(ctx, u.ID)
	oldKey, _ := s.Reveal(ctx, u.ID, row.Revision)
	row, err := s.Change(ctx, u.ID, row.Revision, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, oldKey); !errors.Is(err, ErrInvalid) {
		t.Fatal("disabled key was accepted")
	}
	if _, err := s.Change(ctx, u.ID, 1, false, true); !errors.Is(err, ErrConflict) {
		t.Fatal("stale update was accepted")
	}
	if err := s.Backfill(ctx); err != nil {
		t.Fatal(err)
	}
	row, err = s.Change(ctx, u.ID, row.Revision, true, false)
	if err != nil || row.DisabledAt == nil {
		t.Fatal("rotation re-enabled a disabled key")
	}
	newKey, err := s.Reveal(ctx, u.ID, row.Revision)
	if err != nil || newKey == oldKey {
		t.Fatal("rotation failed")
	}
	row, err = s.Change(ctx, u.ID, row.Revision, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, oldKey); !errors.Is(err, ErrInvalid) {
		t.Fatal("rotated key was accepted")
	}
	if _, err := s.Authenticate(ctx, newKey); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.User{}).Where("id = ?", u.ID).Update("status", 0)
	if _, err := s.Authenticate(ctx, newKey); !errors.Is(err, ErrInvalid) {
		t.Fatal("disabled user was accepted")
	}
	db.Model(&model.User{}).Where("id = ?", u.ID).Update("status", 1)
	db.Delete(&u)
	if _, err := s.Authenticate(ctx, newKey); !errors.Is(err, ErrInvalid) {
		t.Fatal("deleted user was accepted")
	}
	if _, err := s.Ensure(ctx, 0); !errors.Is(err, ErrAccount) {
		t.Fatal("zero owner was accepted")
	}
	for _, invalid := range []string{"", "Bearer " + newKey, "scrw_legacy", Prefix + strings.Repeat("!", 43)} {
		if _, err := s.Authenticate(ctx, invalid); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid shape accepted: %d bytes", len(invalid))
		}
	}
}

func TestReplicasConvergeOnOneKeyAndOneRotation(t *testing.T) {
	// Separate GORM instances and connection pools exercise SQL interleaving,
	// rather than serializing all goroutines on the one-connection fixture.
	dsn := filepath.ToSlash(filepath.Join(t.TempDir(), "replicas.db")) + "?_journal_mode=WAL&_busy_timeout=5000"
	openReplica := func() (*gorm.DB, *Service) {
		t.Helper()
		db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: gormlog.Default.LogMode(gormlog.Silent), SkipDefaultTransaction: true, PrepareStmt: true})
		if err != nil {
			t.Fatal(err)
		}
		pool, _ := db.DB()
		pool.SetMaxOpenConns(4)
		t.Cleanup(func() { pool.Close() })
		s, err := New(db, "shared-replica-secret")
		if err != nil {
			t.Fatal(err)
		}
		return db, s
	}
	db, first := openReplica()
	if err := db.AutoMigrate(&model.User{}, &model.UserAPIKey{}); err != nil {
		t.Fatal(err)
	}
	_, second := openReplica()
	u := owner(t, db)
	replicas := []*Service{first, second}
	const workers = 12
	type result struct {
		row *model.UserAPIKey
		err error
	}
	runConcurrent := func(action func(*Service) (*model.UserAPIKey, error)) []result {
		start := make(chan struct{})
		results := make(chan result, workers)
		for i := 0; i < workers; i++ {
			go func(s *Service) { <-start; row, err := action(s); results <- result{row, err} }(replicas[i%len(replicas)])
		}
		close(start)
		out := make([]result, 0, workers)
		for i := 0; i < workers; i++ {
			out = append(out, <-results)
		}
		return out
	}
	ctx := context.Background()
	issued := runConcurrent(func(s *Service) (*model.UserAPIKey, error) { return s.Ensure(ctx, u.ID) })
	var original *model.UserAPIKey
	for _, result := range issued {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if original == nil {
			original = result.row
		}
		if result.row.KeyHash != original.KeyHash || result.row.Revision != 1 {
			t.Fatal("replicas returned different default credentials")
		}
	}
	oldKey, err := first.Reveal(ctx, u.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	rotated := runConcurrent(func(s *Service) (*model.UserAPIKey, error) { return s.Change(ctx, u.ID, 1, true, false) })
	winners := 0
	for _, result := range rotated {
		if result.err == nil {
			winners++
			if result.row.Revision != 2 {
				t.Fatal("rotation incremented revision more than once")
			}
		} else if !errors.Is(result.err, ErrConflict) {
			t.Fatal(result.err)
		}
	}
	if winners != 1 {
		t.Fatalf("successful concurrent rotations = %d, want 1", winners)
	}
	for _, s := range replicas {
		if _, err := s.Authenticate(ctx, oldKey); !errors.Is(err, ErrInvalid) {
			t.Fatal("a replica accepted the rotated credential")
		}
	}
	var count int64
	if err := db.Model(&model.UserAPIKey{}).Where("user_id = ?", u.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("credential count = %d, error = %v", count, err)
	}
}

func TestProvisioningRecoversAfterRollbackOnSameConnection(t *testing.T) {
	db, s := setup(t)
	if err := s.Install(); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TRIGGER reject_key BEFORE INSERT ON user_api_key BEGIN SELECT RAISE(ABORT, 'temporary write failure'); END").Error; err != nil {
		t.Fatal(err)
	}
	u := model.User{ID: idgen.Next(), Username: "retry-owner", Email: "retry@example.test"}
	if err := db.Create(&u).Error; err == nil {
		t.Fatal("expected initial failure")
	}
	if err := db.Exec("DROP TRIGGER reject_key").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("retry after rollback failed: %v", err)
	}
	row, err := s.Ensure(context.Background(), u.ID)
	if err != nil {
		t.Fatal(err)
	}
	key, err := s.Reveal(context.Background(), u.ID, row.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(context.Background(), key); err != nil {
		t.Fatal(err)
	}
}

func TestVaultChangesDoNotSilentlyReplaceExistingCredentials(t *testing.T) {
	db, s := setup(t)
	u := owner(t, db)
	ctx := context.Background()
	before, err := s.Ensure(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	value, err := s.Reveal(ctx, u.ID, before.Revision)
	if err != nil {
		t.Fatal(err)
	}
	changed, err := New(db, "different-vault-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := changed.Reveal(ctx, u.ID, before.Revision); !errors.Is(err, ErrVault) {
		t.Fatal("wrong vault key was accepted")
	}
	after, err := changed.Ensure(ctx, u.ID)
	if err != nil || before.KeyHash != after.KeyHash || before.Revision != after.Revision {
		t.Fatal("vault change replaced the default credential")
	}
	if _, err := changed.Authenticate(ctx, value); err != nil {
		t.Fatal("vault change broke hash authentication")
	}
	// Corrupted storage must also fail without releasing partial plaintext.
	if err := db.Model(&model.UserAPIKey{}).Where("user_id = ?", u.ID).Update("ciphertext", "v1:YQ").Error; err != nil {
		t.Fatal(err)
	}
	if result, err := s.Reveal(ctx, u.ID, before.Revision); !errors.Is(err, ErrVault) || result != "" {
		t.Fatal("corrupt ciphertext did not fail closed")
	}
}
