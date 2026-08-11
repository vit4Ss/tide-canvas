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
)

const capturedFrameHandler = "video_frame_capture"

var (
	errCapturedFrameNotFound = errors.New("captured frame upload not found")
	errCapturedFrameInvalid  = errors.New("captured frame upload is invalid")
)

// registerCapturedFrame moves a newly uploaded PNG from upload history into a
// completed, zero-cost generation-history task. The File row is an upload-time
// ownership receipt; once the AiTask exists it becomes the durable owner of the
// same object URL, so deleting the File row does not delete the stored object.
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
		var uploaded model.File
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", dto.FileID, userID).
			First(&uploaded).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCapturedFrameNotFound
			}
			return err
		}
		if uploaded.FileType != "image" || !strings.EqualFold(strings.TrimSpace(uploaded.MimeType), "image/png") ||
			strings.TrimSpace(uploaded.FileUrl) == "" {
			return errCapturedFrameInvalid
		}
		task.ResultUrl = uploaded.FileUrl
		if err := tx.Create(&task).Error; err != nil {
			return err
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
		if existing, found, replayErr := replay(s.repo.db); replayErr != nil || found {
			return existing, replayErr
		}
		return nil, err
	}
	vo := toTaskVO(&task)
	return &vo, nil
}
