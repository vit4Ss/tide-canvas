package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.uber.org/zap"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/alerting"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
)

var videoHandlers = map[string]bool{
	"text_to_video": true, "image_to_video": true, "start_end_to_video": true,
	"first_last_frame": true, "reference_to_video": true, "video_upscale": true,
}

func (s *service) publishGenerationFailure(taskID idgen.ID, handler string, m *model.AiModel, cause error, cost int, refunded bool) {
	if s.alerts == nil || !videoHandlers[handler] || isContentRestriction(cause) {
		return
	}
	severity, class := alerting.SeverityError, "provider"
	raw := strings.ToLower(errMessage(cause))
	if strings.Contains(raw, "401") || strings.Contains(raw, "403") || strings.Contains(raw, "unauthorized") || strings.Contains(raw, "forbidden") || strings.Contains(raw, "invalid api key") {
		severity, class = alerting.SeverityCritical, "authentication"
	} else if strings.Contains(raw, "timeout") || strings.Contains(raw, "deadline") {
		class = "timeout"
	} else if strings.Contains(raw, "429") || strings.Contains(raw, "rate limit") {
		class = "rate_limit"
	}
	modelName := "unknown"
	if m != nil && strings.TrimSpace(m.ModelID) != "" {
		modelName = m.ModelID
	}
	fingerprint := fmt.Sprintf("ai.video.failed:%s:%s:%s", handler, modelName, class)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := s.alerts.Publish(ctx, alerting.EventInput{
		EventType: "ai.video.generation_failed", Category: "ai", Severity: severity, Fingerprint: fingerprint,
		Title: "视频生成服务异常", Content: "视频生成任务未完成，系统已按规则聚合通知。", Source: "handler/ai",
		Details: map[string]any{"taskId": taskID.String(), "handler": handler, "model": modelName, "errorClass": class, "error": errMessage(cause), "pointCost": cost, "refunded": refunded},
	})
	if err != nil {
		logger.L().Warn("ai: publish generation alert failed", zap.Error(err))
	}
}

func (s *service) publishRefundFailure(taskID idgen.ID, cost int, reason string, cause error) {
	if s.alerts == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := s.alerts.Publish(ctx, alerting.EventInput{EventType: "billing.points.refund_failed", Category: "billing", Severity: alerting.SeverityCritical,
		Fingerprint: "billing.points.refund_failed:" + taskID.String(), Title: "生成任务积分退款失败", Content: "任务失败或取消后，积分退款未能完成，需要管理员核查。", Source: "handler/ai",
		Details: map[string]any{"taskId": taskID.String(), "pointCost": cost, "reason": reason, "error": cause.Error()}})
	if err != nil {
		logger.L().Warn("ai: publish refund alert failed", zap.Error(err))
	}
}

func isContentRestriction(err error) bool {
	if err == nil {
		return false
	}
	v := strings.ToLower(err.Error())
	for _, needle := range []string{"code 5009", "copyright", "版权", "content policy", "content restriction", "policy violation", "moderation"} {
		if strings.Contains(v, needle) {
			return true
		}
	}
	return false
}
