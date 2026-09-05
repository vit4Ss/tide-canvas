package chat

// charge.go: /chat 对话的按次计费。
//
// 口径与生成/优化链路一致（用户定稿「只要调用了模型就要消耗积分」）：
// 每条用户消息在上游调用前按所选文本模型的目录价（market_model.price）
// 预扣积分，余额不足直接拒发；上游调用失败原额退款。
// 模型定价 0 = 免费。refID 用一条新生成的雪花 id 关联积分流水
// （对话没有任务行可挂）。

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"

	"go.uber.org/zap"
)

// errInsufficientPoints 余额不足拒绝发送（handler 映射成「积分不足」话术）。
var errInsufficientPoints = errors.New("chat: insufficient points")

// textCharge 是一次已预扣的对话调用；cost==0 为免费。
type textCharge struct {
	cost    int
	ownerID idgen.ID
	refID   idgen.ID
	model   *model.MarketModel
}

// chargeTextCall 解析本轮所用文本模型并预扣积分。模型未配置或定价为 0 时
// 返回免费 charge（cost=0），不触碰积分。
func (s *service) chargeTextCall(ctx context.Context, ownerID idgen.ID, requestedModel string) (*textCharge, error) {
	ch := s.prepareTextCharge(ownerID, requestedModel)
	if err := consumeTextCharge(s.repo.db.WithContext(ctx), ch); err != nil {
		return nil, err
	}
	return ch, nil
}

// prepareTextCharge resolves the immutable charge metadata without mutating the
// balance. Idempotent streamed requests persist this metadata beside their user
// fence, then consume it in the same database transaction as that insert.
func (s *service) prepareTextCharge(ownerID idgen.ID, requestedModel string) *textCharge {
	m := s.repo.resolveTextModel(requestedModel)
	ch := &textCharge{ownerID: ownerID, model: m}
	if m == nil {
		return ch
	}
	ch.cost = int(m.Price.IntPart())
	if ch.cost <= 0 {
		ch.cost = 0
		return ch
	}
	ch.refID = idgen.Next()
	return ch
}

func consumeTextCharge(db *gorm.DB, ch *textCharge) error {
	if ch == nil || ch.cost <= 0 {
		return nil
	}
	modelName := "文本模型"
	if ch.model != nil && strings.TrimSpace(ch.model.Name) != "" {
		modelName = ch.model.Name
	}
	if err := points.Consume(db, ch.ownerID, ch.cost, "对话消耗："+modelName, ch.refID); err != nil {
		if errors.Is(err, points.ErrInsufficient) {
			return errInsufficientPoints
		}
		return err
	}
	return nil
}

// refundTextCall 上游调用失败后退回预扣积分。
func (s *service) refundTextCall(ch *textCharge) {
	if err := refundTextCallDB(s.repo.db, ch); err != nil {
		logger.L().Error("chat: refund failed",
			zap.String("refId", ch.refID.String()), zap.Error(err))
	}
}

// refundTextCallDB is transaction-aware so an idempotent fallback can persist
// its assistant, release its lease, and record the refund as one durable unit.
func refundTextCallDB(db *gorm.DB, ch *textCharge) error {
	if ch == nil || ch.cost <= 0 || ch.refID == 0 {
		return nil
	}
	return points.Refund(db, ch.ownerID, ch.cost, "对话失败退款", ch.refID)
}

// cost64 给日志用的积分数值（免费/空 charge 为 0）。
func (ch *textCharge) cost64() int64 {
	if ch == nil {
		return 0
	}
	return int64(ch.cost)
}

func (ch *textCharge) billingRefID() idgen.ID {
	if ch == nil {
		return 0
	}
	return ch.refID
}
