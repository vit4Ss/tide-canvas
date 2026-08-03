package file

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/storage"
)

const (
	uploadGrantCleanupInterval = time.Minute
	// The OSS signature is minted after the DB expiry timestamp. Keep a grace
	// window longer than normal signing/request transit and clock skew so the
	// janitor never deletes an object while its PUT URL may still be accepted.
	uploadGrantCleanupGrace  = 2 * time.Minute
	uploadGrantClaimTTL      = 5 * time.Minute
	uploadGrantCleanupBatch  = 25
	uploadGrantCleanupPasses = 4
)

// StartUploadGrantJanitor removes objects uploaded with an expired direct-upload
// grant but never registered as a File. Without this reconciler a caller could
// repeatedly PUT objects and let grants expire, bypassing storage_used accounting.
// The first pass runs immediately; later passes run once a minute until ctx ends.
func StartUploadGrantJanitor(ctx context.Context, d *app.Deps) {
	if d == nil || d.DB == nil || d.Storage == nil || d.Cfg == nil || d.Storage.Type() != "oss" {
		return
	}
	workerID := idgen.Next().String()
	go func() {
		sweep := func() {
			removed, err := sweepExpiredUploadGrants(ctx, d, workerID)
			if err != nil {
				logger.L().Warn("file: expired upload grant sweep failed", zap.Error(err))
			} else if removed > 0 {
				logger.L().Info("file: removed expired direct uploads", zap.Int64("count", removed))
			}
		}
		sweep()
		ticker := time.NewTicker(uploadGrantCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sweep()
			}
		}
	}()
}

// sweepExpiredUploadGrants claims a few rows at a time. The conditional UPDATE
// is the cross-process mutex: only one server gets each short-lived claim. Object
// deletion is intentionally outside a DB transaction; storage Delete is
// idempotent, and the row is removed only after Delete succeeds (missing objects
// are already treated as success by every StorageStrategy implementation).
func sweepExpiredUploadGrants(ctx context.Context, d *app.Deps, workerID string) (int64, error) {
	var removed int64
	storageScope := storage.ScopeID(d.Cfg.Storage)
	for pass := 0; pass < uploadGrantCleanupPasses; pass++ {
		claimed, err := claimExpiredUploadGrants(ctx, d.DB, workerID, storageScope, time.Now())
		if err != nil {
			return removed, err
		}
		if len(claimed) == 0 {
			break
		}
		for i := range claimed {
			grant := &claimed[i]
			// A File row is authoritative even if a prior process crashed before
			// marking the grant consumed. Reconcile the grant instead of deleting
			// an object that is already visible in the user's asset library.
			var registered model.File
			if err := d.DB.WithContext(ctx).Select("id").Where("storage_key = ?", grant.StorageKey).First(&registered).Error; err == nil {
				now := time.Now()
				_ = d.DB.WithContext(ctx).Model(&model.FileUploadGrant{}).
					Where("id = ? AND cleanup_worker_id = ?", grant.ID, workerID).
					Updates(map[string]any{"consumed_at": now, "registered_file_id": registered.ID, "cleanup_claimed_at": nil, "cleanup_worker_id": ""}).Error
				continue
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return removed, err
			}
			if grant.StorageScope == "" || grant.StorageScope != storageScope {
				return removed, fmt.Errorf("claimed upload grant has a different storage scope")
			}
			if err := d.Storage.Delete(ctx, grant.StorageKey); err != nil {
				// Let this process retry promptly; a crashed process is recovered by
				// the stale-claim TTL instead.
				_ = d.DB.WithContext(ctx).Model(&model.FileUploadGrant{}).
					Where("id = ? AND cleanup_worker_id = ? AND consumed_at IS NULL", grant.ID, workerID).
					Updates(map[string]any{"cleanup_claimed_at": nil, "cleanup_worker_id": ""}).Error
				logger.L().Warn("file: delete expired direct upload failed",
					zap.String("key", grant.StorageKey), zap.Error(err))
				continue
			}
			result := d.DB.WithContext(ctx).Where(
				"id = ? AND cleanup_worker_id = ? AND consumed_at IS NULL AND registered_file_id = 0 AND storage_scope = ? AND expires_at < ?",
				grant.ID, workerID, storageScope, time.Now(),
			).Delete(&model.FileUploadGrant{})
			if result.Error != nil {
				return removed, result.Error
			}
			removed += result.RowsAffected
		}
		if len(claimed) < uploadGrantCleanupBatch {
			break
		}
	}
	return removed, nil
}

func claimExpiredUploadGrants(ctx context.Context, db *gorm.DB, workerID, storageScope string, now time.Time) ([]model.FileUploadGrant, error) {
	staleBefore := now.Add(-uploadGrantClaimTTL)
	expiredBefore := uploadGrantCleanupCutoff(now)
	var candidates []model.FileUploadGrant
	if err := db.WithContext(ctx).
		Where("consumed_at IS NULL AND registered_file_id = 0 AND storage_scope = ? AND expires_at < ? AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at < ?)", storageScope, expiredBefore, staleBefore).
		Order("expires_at ASC").Limit(uploadGrantCleanupBatch).Find(&candidates).Error; err != nil {
		return nil, err
	}

	claimed := make([]model.FileUploadGrant, 0, len(candidates))
	for i := range candidates {
		candidate := candidates[i]
		result := db.WithContext(ctx).Model(&model.FileUploadGrant{}).
			Where("id = ? AND consumed_at IS NULL AND registered_file_id = 0 AND storage_scope = ? AND expires_at < ? AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at < ?)",
				candidate.ID, storageScope, expiredBefore, staleBefore).
			Updates(map[string]any{"cleanup_claimed_at": now, "cleanup_worker_id": workerID})
		if result.Error != nil {
			return claimed, result.Error
		}
		if result.RowsAffected == 1 {
			candidate.CleanupClaimedAt = &now
			candidate.CleanupWorkerID = workerID
			claimed = append(claimed, candidate)
		}
	}
	return claimed, nil
}

func uploadGrantCleanupCutoff(now time.Time) time.Time {
	return now.Add(-uploadGrantCleanupGrace)
}
