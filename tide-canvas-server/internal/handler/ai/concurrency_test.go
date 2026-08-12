package ai

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestGenerationRetentionWindowsCoverLongVideo(t *testing.T) {
	const videoBudget = 40 * time.Minute
	if taskStateTTL <= videoBudget {
		t.Fatalf("task state TTL = %s, must exceed video budget %s", taskStateTTL, videoBudget)
	}
	if staleTaskCutoff <= videoBudget {
		t.Fatalf("stale cutoff = %s, must exceed video budget %s", staleTaskCutoff, videoBudget)
	}
	if taskStateTTL != staleTaskCutoff {
		t.Fatalf("task state TTL %s and stale cutoff %s must stay aligned", taskStateTTL, staleTaskCutoff)
	}
}

func TestGenerationConcurrentLimitConfig(t *testing.T) {
	db := concurrencyTestDB(t)
	if got := generationConcurrentLimit(db); got != model.DefaultAIUserConcurrentLimit {
		t.Fatalf("missing config limit = %d", got)
	}
	row := model.SysConfig{ConfigKey: model.ConfigKeyAIUserConcurrentLimit, ConfigValue: "7", Group: "ai"}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if got := generationConcurrentLimit(db); got != 7 {
		t.Fatalf("configured limit = %d, want 7", got)
	}
	if err := db.Model(&row).Update("config_value", "invalid").Error; err != nil {
		t.Fatal(err)
	}
	if got := generationConcurrentLimit(db); got != model.DefaultAIUserConcurrentLimit {
		t.Fatalf("invalid config limit = %d", got)
	}
}

func TestReserveGenerationSlotCountsRecentProcessingTasks(t *testing.T) {
	db := concurrencyTestDB(t)
	now := time.Now()
	userID := idgen.ID(91001)
	otherID := idgen.ID(91002)
	for _, user := range []model.User{
		{ID: userID, Username: "limited", Email: "limited@example.test"},
		{ID: otherID, Username: "other", Email: "other@example.test"},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}

	createTask := func(id idgen.ID, owner idgen.ID, status int, created time.Time) {
		t.Helper()
		task := model.AiTask{ID: id, UserID: owner, Status: status, CreateTime: created, UpdateTime: created}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	createTask(92001, userID, statusProcessing, now.Add(-time.Minute))
	createTask(92002, userID, statusProcessing, now.Add(-2*time.Minute))
	createTask(92003, userID, statusProcessing, now.Add(-generationSlotTTL-time.Second)) // expired slot
	createTask(92004, userID, statusSuccess, now.Add(-time.Second))                      // terminal
	createTask(92005, otherID, statusProcessing, now.Add(-time.Second))                  // another user

	err := db.Transaction(func(tx *gorm.DB) error {
		return reserveGenerationSlot(tx, userID, 2, now)
	})
	if !errors.Is(err, errConcurrentLimit) {
		t.Fatalf("at-capacity error = %v, want errConcurrentLimit", err)
	}

	if err := db.Model(&model.AiTask{}).Where("id = ?", idgen.ID(92001)).Update("status", statusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return reserveGenerationSlot(tx, userID, 2, now)
	}); err != nil {
		t.Fatalf("released terminal slot was not reusable: %v", err)
	}

	if err := db.Model(&model.User{}).Where("id = ?", userID).Update("concurrency_unlimited", 1).Error; err != nil {
		t.Fatal(err)
	}
	createTask(92006, userID, statusProcessing, now.Add(-time.Second))
	if err := db.Transaction(func(tx *gorm.DB) error {
		return reserveGenerationSlot(tx, userID, 1, now)
	}); err != nil {
		t.Fatalf("unlimited user was capped: %v", err)
	}
}

func concurrencyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	return db
}
