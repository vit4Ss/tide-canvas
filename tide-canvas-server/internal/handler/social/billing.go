package social

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
)

func writeChargeError(c *gin.Context, err error) {
	if errors.Is(err, points.ErrInsufficient) {
		response.Fail(c, response.CodeQuotaInsufficient, "积分不足，请充值后再试")
	} else if errors.Is(err, points.ErrSocialRequest) || errors.Is(err, points.ErrSocialUnavailable) || errors.Is(err, points.ErrSocialPriceChanged) {
		response.Fail(c, response.CodeBadRequest, err.Error())
	} else {
		logger.L().Error("social execution billing failed", zap.Error(err))
		response.Fail(c, response.CodeServerError, "积分处理失败，请稍后再试")
	}
}

func replaySocial(c *gin.Context, r *model.SocialActivityRecord) {
	if r.Deleted.Valid || r.Refunded || r.Status == model.SocialActivityFailed || r.Status == model.SocialActivityExpired {
		response.Fail(c, response.CodeBadRequest, "上次执行已结束，失败的扣费已退回，请重新发起")
		return
	}
	if r.ActivityType == model.SocialActivityAnalysis && r.Status == model.SocialActivitySucceeded {
		var value inspectVO
		if json.Unmarshal([]byte(r.SnapshotJSON), &value) == nil {
			response.OK(c, value)
			return
		}
	}
	if r.ActivityType == model.SocialActivityDownload && r.Status == model.SocialActivityReady && r.ExpiresAt != nil && r.ExpiresAt.After(time.Now()) {
		var value videoDownloadResolveVO
		if json.Unmarshal([]byte(r.SnapshotJSON), &value) == nil {
			response.OK(c, value)
			return
		}
	}
	response.Fail(c, response.CodeRateLimited, "本次任务正在执行或已完成，请查看历史记录")
}

func (h *handler) reconcileCharges() {
	if err := points.ReconcileSocialCharges(h.db, time.Now()); err != nil {
		logger.L().Error("social execution refund recovery failed", zap.Error(err))
	}
}
