package alerting

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
)

var retryDelays = []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute}

func (s *Service) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.drain(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.L().Warn("alerting: outbox drain failed", zap.Error(err))
				}
			}
		}
	}()
}

func (s *Service) drain(ctx context.Context) error {
	var ids []idgen.ID
	now := time.Now()
	err := s.db.WithContext(ctx).Model(&model.AlertDelivery{}).
		Where("status IN ? AND next_attempt_at <= ? AND (locked_at IS NULL OR locked_at < ?)", []string{"pending", "retry", "processing"}, now, now.Add(-2*time.Minute)).
		Order("next_attempt_at ASC").Limit(20).Pluck("id", &ids).Error
	if err != nil {
		return err
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.processOne(ctx, id); err != nil {
			logger.L().Warn("alerting: delivery failed", zap.String("deliveryId", id.String()), zap.Error(err))
		}
	}
	return nil
}

func (s *Service) processOne(ctx context.Context, id idgen.ID) error {
	now := time.Now()
	claimed := s.db.WithContext(ctx).Model(&model.AlertDelivery{}).
		Where("id = ? AND status IN ? AND next_attempt_at <= ? AND (locked_at IS NULL OR locked_at < ?)", id, []string{"pending", "retry", "processing"}, now, now.Add(-2*time.Minute)).
		Updates(map[string]any{"status": "processing", "locked_by": s.instanceID, "locked_at": now})
	if claimed.Error != nil {
		return claimed.Error
	}
	if claimed.RowsAffected != 1 {
		return nil
	}
	var delivery model.AlertDelivery
	if err := s.db.WithContext(ctx).First(&delivery, "id = ?", id).Error; err != nil {
		return err
	}
	var channel model.AlertChannel
	if err := s.db.WithContext(ctx).First(&channel, "id = ?", delivery.ChannelID).Error; err != nil {
		s.finishDelivery(ctx, &delivery, sendResult{Permanent: true}, err)
		return err
	}
	if !channel.Enabled {
		err := errors.New("通知渠道已停用")
		s.finishDelivery(ctx, &delivery, sendResult{Permanent: true}, err)
		return err
	}
	cfg, err := s.vault.open(channel.ConfigEncrypted)
	if err != nil {
		s.finishDelivery(ctx, &delivery, sendResult{Permanent: true}, err)
		return err
	}
	result, sendErr := s.send(ctx, channel.Type, cfg, delivery.Message)
	s.finishDelivery(ctx, &delivery, result, sendErr)
	s.updateChannelHealth(ctx, channel.ID, result, sendErr)
	return sendErr
}

func (s *Service) finishDelivery(ctx context.Context, d *model.AlertDelivery, result sendResult, sendErr error) {
	now := time.Now()
	attempts := d.AttemptCount + 1
	updates := map[string]any{"attempt_count": attempts, "http_status": result.StatusCode, "response_excerpt": result.Response, "locked_by": "", "locked_at": nil}
	if sendErr == nil {
		updates["status"] = "sent"
		updates["sent_at"] = now
		updates["error_message"] = ""
	} else {
		updates["error_message"] = truncateRunes(sendErr.Error(), 500)
		if result.Permanent || attempts >= 5 {
			updates["status"] = "failed"
		} else {
			updates["status"] = "retry"
			updates["next_attempt_at"] = now.Add(retryDelays[attempts-1])
		}
	}
	if err := s.db.WithContext(ctx).Model(&model.AlertDelivery{}).Where("id = ? AND locked_by = ?", d.ID, s.instanceID).Updates(updates).Error; err != nil {
		logger.L().Error("alerting: persist delivery outcome failed", zap.String("deliveryId", d.ID.String()), zap.Error(err))
	}
}

func (s *Service) updateChannelHealth(ctx context.Context, id idgen.ID, result sendResult, sendErr error) {
	now := time.Now()
	updates := map[string]any{}
	if sendErr == nil {
		updates["last_success_at"] = now
		updates["last_error"] = ""
	} else {
		updates["last_failure_at"] = now
		updates["last_error"] = truncateRunes(sendErr.Error(), 500)
	}
	if err := s.db.WithContext(ctx).Model(&model.AlertChannel{}).Where("id = ?", id).Updates(updates).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		logger.L().Warn("alerting: update channel health failed", zap.Error(err))
	}
}
