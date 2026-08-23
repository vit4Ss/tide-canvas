package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

const capturedFrameHandler = "video_frame_capture"

var (
	errCapturedFrameNotFound = errors.New("captured frame upload not found")
	errCapturedFrameInvalid  = errors.New("captured frame upload is invalid")
)

// registerCapturedFrame promotes an owned PNG/JPEG into a completed, zero-cost
// generation-history task. Explicitly-new temporary uploads are moved; reused or
// legacy-client assets are cloned so the original File remains independently
// deletable.
func (s *service) registerCapturedFrame(ctx context.Context, userID idgen.ID, dto capturedFrameDTO) (*AiTaskVO, error) {
	if dto.FileID == 0 || dto.CaptureTime < 0 || math.IsNaN(dto.CaptureTime) || math.IsInf(dto.CaptureTime, 0) ||
		dto.Width <= 0 || dto.Height <= 0 || dto.Width > 32768 || dto.Height > 32768 {
		return nil, errCapturedFrameInvalid
	}

	clientRequestID := "captured-frame:" + dto.FileID.String()
	replay := func(db *gorm.DB) (*AiTaskVO, bool, error) {
		var existing model.AiTask
		err := db.WithContext(ctx).
			Where("user_id = ? AND client_request_id = ?", userID, clientRequestID).
			First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		if err != nil {
			return nil, false, err
		}
		vo := toTaskVO(&existing)
		return &vo, true, nil
	}
	if existing, found, err := replay(s.repo.db); err != nil || found {
		return existing, err
	}

	// Content-deduplicated uploads can return a File row that existed before this
	// capture request. Moving that row would remove the user's original asset and
	// make its quota accounting incorrect. Give generation history an independent
	// object in that case, so either collection can later be deleted safely.
	var clonedKey, clonedURL, clonedSourceKey string
	if !dto.MoveOriginal {
		var source model.File
		if err := s.repo.db.WithContext(ctx).Where("id = ? AND owner_id = ?", dto.FileID, userID).First(&source).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errCapturedFrameNotFound
			}
			return nil, err
		}
		if !validCapturedFrameUpload(&source) {
			return nil, errCapturedFrameInvalid
		}
		var err error
		clonedKey, clonedURL, err = s.cloneCapturedFrameObject(ctx, userID, &source)
		if err != nil {
			return nil, err
		}
		clonedSourceKey = source.StorageKey
	}

	input, err := json.Marshal(map[string]any{
		"source":      "video_frame_capture",
		"captureTime": dto.CaptureTime,
		"fileId":      dto.FileID.String(),
	})
	if err != nil {
		return nil, err
	}
	meta, err := json.Marshal(map[string]any{
		"width":       dto.Width,
		"height":      dto.Height,
		"captureTime": dto.CaptureTime,
	})
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(clientRequestID))
	now := time.Now()
	task := model.AiTask{
		ID:                idgen.Next(),
		UserID:            userID,
		Handler:           capturedFrameHandler,
		ModelName:         "视频截帧",
		Status:            statusSuccess,
		Progress:          100,
		ClientRequestID:   &clientRequestID,
		ClientRequestHash: fmt.Sprintf("%x", hash[:]),
		PointCost:         0,
		Origin:            "direct",
		OutputRole:        "final",
		// A captured frame belongs in the owner's generation history, but it is
		// not an upstream AI generation and must not become a community work.
		RegisterWork: false,
		Input:        string(input),
		ResultMeta:   string(meta),
		CreateTime:   now,
		UpdateTime:   now,
		CompleteTime: &now,
	}

	err = s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// File upload/delete paths lock the account before a File row. Keep the
		// same order here so capture promotion cannot deadlock quota accounting.
		var owner model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "storage_used").First(&owner, "id = ?", userID).Error; err != nil {
			return err
		}
		var uploaded model.File
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", dto.FileID, userID).
			First(&uploaded).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCapturedFrameNotFound
			}
			return err
		}
		if !validCapturedFrameUpload(&uploaded) {
			return errCapturedFrameInvalid
		}
		if !dto.MoveOriginal {
			// Recheck the locked row after the storage copy. A deleted/replaced
			// source must not leave a task pointing at an unrelated clone.
			if uploaded.StorageKey != clonedSourceKey || clonedURL == "" {
				return errCapturedFrameInvalid
			}
			task.ResultUrl = clonedURL
		} else {
			task.ResultUrl = uploaded.FileUrl
		}
		if err := tx.Create(&task).Error; err != nil {
			return err
		}
		if !dto.MoveOriginal {
			return nil
		}
		deleted := tx.Where("id = ? AND owner_id = ?", dto.FileID, userID).Delete(&model.File{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected != 1 {
			return errCapturedFrameNotFound
		}
		// The object is now a generated asset rather than an uploaded-library
		// asset. Generated outputs are not charged against upload storage quota,
		// so transfer the accounting in the same transaction as the two records.
		if uploaded.FileSize > 0 {
			if err := tx.Model(&model.User{}).Where("id = ?", userID).
				UpdateColumn("storage_used", gorm.Expr(
					"CASE WHEN storage_used > ? THEN storage_used - ? ELSE 0 END",
					uploaded.FileSize, uploaded.FileSize,
				)).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		// A concurrent retry can lose either the File-row lock or the unique task
		// key race after the winner commits. Return the durable winning task.
		if existing, found, replayErr := replay(s.repo.db); replayErr != nil {
			// An ambiguous DB result is safer as a possible orphan than deleting an
			// object that a committed task may already own.
			return nil, replayErr
		} else if found {
			if clonedKey != "" && existing.ResultURL != clonedURL {
				_ = s.storage.Delete(ctx, clonedKey)
			}
			return existing, nil
		}
		if clonedKey != "" {
			_ = s.storage.Delete(ctx, clonedKey)
		}
		return nil, err
	}
	vo := toTaskVO(&task)
	return &vo, nil
}

func validCapturedFrameUpload(uploaded *model.File) bool {
	if uploaded == nil {
		return false
	}
	mimeType := strings.ToLower(strings.TrimSpace(uploaded.MimeType))
	return uploaded.FileType == "image" &&
		(mimeType == "image/png" || mimeType == "image/jpeg" || mimeType == "image/jpg") &&
		strings.TrimSpace(uploaded.FileUrl) != ""
}

func (s *service) cloneCapturedFrameObject(ctx context.Context, userID idgen.ID, source *model.File) (string, string, error) {
	if s.storage == nil || source == nil || strings.TrimSpace(source.StorageKey) == "" {
		return "", "", errCapturedFrameInvalid
	}
	if source.StorageType != "" && source.StorageType != s.storage.Type() {
		return "", "", errCapturedFrameInvalid
	}
	readerStore, ok := s.storage.(storage.ObjectReader)
	if !ok {
		return "", "", errCapturedFrameInvalid
	}
	stream, err := readerStore.Open(ctx, source.StorageKey)
	if err != nil {
		return "", "", err
	}
	defer stream.Close()
	ext := ".png"
	if strings.EqualFold(strings.TrimSpace(source.MimeType), "image/jpeg") || strings.EqualFold(strings.TrimSpace(source.MimeType), "image/jpg") {
		ext = ".jpg"
	}
	now := time.Now()
	key := fmt.Sprintf("captures/%04d/%02d/%s/%s%s", now.Year(), int(now.Month()), userID.String(), idgen.Next().String(), ext)
	url, err := s.storage.Save(ctx, key, stream, source.MimeType)
	if err != nil {
		_ = s.storage.Delete(ctx, key)
		return "", "", err
	}
	return key, url, nil
}
