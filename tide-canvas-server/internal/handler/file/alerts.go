package file

import (
	"context"
	"strings"
	"time"

	"go.uber.org/zap"

	"tidecanvas/internal/pkg/alerting"
	"tidecanvas/internal/pkg/logger"
)

func (s *service) storageFingerprint(operation string) string {
	kind := "unknown"
	if s.store != nil && strings.TrimSpace(s.store.Type()) != "" {
		kind = s.store.Type()
	}
	return "storage." + operation + ".failed:" + kind
}

func (s *service) publishStorageFailure(operation string, cause error) {
	if s.alerts == nil || cause == nil {
		return
	}
	s.storageAlerting.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	kind := "unknown"
	if s.store != nil {
		kind = s.store.Type()
	}
	if err := s.alerts.Publish(ctx, alerting.EventInput{
		EventType: "storage." + operation + ".failed", Category: "storage", Severity: alerting.SeverityCritical,
		Fingerprint: s.storageFingerprint(operation), Title: "文件存储写入失败",
		Content: "文件未能写入当前存储后端，上传与生成结果归档可能受到影响。", Source: "handler/file",
		Details: map[string]any{"operation": operation, "storageType": kind, "error": cause.Error()},
	}); err != nil {
		logger.L().Warn("file: publish storage alert failed", zap.Error(err))
	}
}

func (s *service) resolveStorageFailure(operation string) {
	if s.alerts == nil || !s.storageAlerting.Swap(false) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = s.alerts.Resolve(ctx, s.storageFingerprint(operation), "文件存储服务恢复", "文件已能够正常写入当前存储后端。", nil)
}
