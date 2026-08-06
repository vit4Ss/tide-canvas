package ai

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

var errConcurrentLimit = errors.New("generation concurrency limit reached")

// generationSlotTTL is deliberately independent of the provider timeout. The
// upstream operation may continue, but it no longer blocks the user from
// starting another task after this safety window.
const generationSlotTTL = 5 * time.Minute

func generationConcurrentLimit(db *gorm.DB) int {
	var value string
	if err := db.Model(&model.SysConfig{}).
		Where("config_key = ?", model.ConfigKeyAIUserConcurrentLimit).
		Pluck("config_value", &value).Error; err == nil {
		if n, ok := model.ParseAIUserConcurrentLimit(value); ok {
			return n
		}
	}
	return model.DefaultAIUserConcurrentLimit
}

// reserveGenerationSlot serializes admissions on the owning user row. Counting
// and creating the task inside the same transaction prevents rapid parallel
// requests from all observing the same free slot and overshooting the limit.
// Users explicitly marked concurrency_unlimited bypass the global cap.
func reserveGenerationSlot(tx *gorm.DB, userID idgen.ID, limit int, now time.Time) error {
	var user model.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "concurrency_unlimited").
		First(&user, "id = ?", userID).Error; err != nil {
		return err
	}
	if user.ConcurrencyUnlimited != 0 {
		return nil
	}
	if limit < model.MinAIUserConcurrentLimit || limit > model.MaxAIUserConcurrentLimit {
		limit = model.DefaultAIUserConcurrentLimit
	}

	var active int64
	if err := tx.Model(&model.AiTask{}).
		Where("user_id = ? AND status = ? AND create_time >= ?", userID, statusProcessing, now.Add(-generationSlotTTL)).
		Count(&active).Error; err != nil {
		return err
	}
	if active >= int64(limit) {
		return errConcurrentLimit
	}
	return nil
}
