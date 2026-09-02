package ai

// optimize.go implements POST /api/ai/optimize-prompt: the 创作台「AI 优化」button.
// It rewrites a user prompt into a richer, generation-ready prompt using the
// relay text model designated in 模型管理 (the AI-optimization primary, else any
// listed text model), via the OpenAI-compatible streaming chat completions.
// Each call charges the configured text model's point price up front (guarded
// against overspend) and refunds it if the relay call fails.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"
	"tidecanvas/internal/pkg/response"
)

// errOptimizeUnusable 标记「调用方自己能处理」的失败：缺输入、未配置文本模型。
// 用哨兵包装而不是靠比对文案，是因为 handler 必须据此选错误码——这类要走
// 400 让文案原样到达用户/管理员；真正的上游故障仍走 500 收敛成统一话术。
var errOptimizeUnusable = errors.New("optimize unusable")

func optimizeUnusable(msg string) error {
	return fmt.Errorf("%w: %s", errOptimizeUnusable, msg)
}

// optimizeUnusableMsg 取回 optimizeUnusable 包装的原始文案（去掉哨兵前缀）。
func optimizeUnusableMsg(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, ": "); i >= 0 {
		return msg[i+2:]
	}
	return msg
}

// optimizePromptDTO is the request body for prompt optimization.
type optimizePromptDTO struct {
	Prompt string `json:"prompt" binding:"required"`
}

// optimizeSystemPrompt instructs the text model to return only the improved
// prompt, no commentary.
const optimizeSystemPrompt = "你是 AIGC 提示词优化助手。请把用户提供的绘画/视频提示词改写得更具体、更有画面感、更利于模型生成：" +
	"适当补充风格、主体细节、光影、构图、镜头、质感与分辨率等，同时严格保留原意与核心主体，并保持与原文一致的语言。" +
	"只输出优化后的提示词本身，不要任何解释、标题、前后缀或引号。"

func (h *handler) optimizePrompt(c *gin.Context) {
	var dto optimizePromptDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "缺少提示词")
		return
	}
	out, err := h.svc.optimizePrompt(c.Request.Context(), middleware.CurrentUserID(c), dto.Prompt)
	if err != nil {
		if errors.Is(err, errInsufficientPoints) {
			response.Fail(c, response.CodeQuotaInsufficient, "积分不足，请充值后再试")
			return
		}
		// 调用方可自行处理的（缺输入 / 未配置文本模型）走 400，文案原样到达；
		// 其余是上游/内部故障，仍按 500 收敛成统一话术，原文只进日志。
		if errors.Is(err, errOptimizeUnusable) {
			response.Fail(c, response.CodeBadRequest, optimizeUnusableMsg(err))
			return
		}
		logger.L().Warn("ai: optimize prompt failed", zap.Error(err))
		response.Fail(c, response.CodeServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"prompt": out})
}

// optimizeCost GET /api/ai/optimize-cost -> {cost}
// 创作台「AI 优化」按钮的积分角标：当前用户一次优化将实扣的积分（含团队倍率）。
// 未配置中转站/文本模型时返回 0——按钮不显示积分，点击时才提示具体原因。
func (h *handler) optimizeCost(c *gin.Context) {
	response.OK(c, gin.H{"cost": h.svc.optimizeCost(c.Request.Context(), middleware.CurrentUserID(c))})
}

// optimizeCost computes the points one optimize call will charge for this user,
// mirroring optimizePrompt's pricing exactly. 0 when the feature is unconfigured
// or the model is free.
func (s *service) optimizeCost(ctx context.Context, userID idgen.ID) int {
	if s.relay == nil {
		return 0
	}
	mm := s.repo.textModel()
	if mm == nil {
		return 0
	}
	if model.ModelConfigUnderMaintenance(mm.Config) {
		return 0
	}
	am := marketToAiModel(mm)
	return resolveCost(&am, nil)
}

// optimizePrompt rewrites the prompt via the configured relay text model,
// charging the model's configured point price (团队倍率同生成链路) up front and
// refunding on relay failure. A model priced 0 is free.
func (s *service) optimizePrompt(ctx context.Context, userID idgen.ID, prompt string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", optimizeUnusable("请先输入提示词")
	}
	if s.relay == nil {
		return "", optimizeUnusable("AI 优化未启用：未配置中转站密钥")
	}
	mm := s.repo.textModel()
	if mm == nil {
		return "", optimizeUnusable("AI 优化未启用：请在模型管理添加文本模型并设为「AI 优化主模型」")
	}
	if model.ModelConfigUnderMaintenance(mm.Config) {
		return "", optimizeUnusable(modelMaintenanceMessage)
	}

	// Same pricing path as /generate (creditCost override → catalog price),
	// with no per-call input dimensions for a text rewrite.
	am := marketToAiModel(mm)
	cost := resolveCost(&am, nil)
	refID := idgen.Next() // ledger correlation id (no task row exists for optimize)
	if cost > 0 {
		if err := points.Consume(s.repo.db, userID, cost, "AI 优化："+mm.Name, refID); err != nil {
			if errors.Is(err, points.ErrInsufficient) {
				return "", errInsufficientPoints
			}
			return "", errors.New("AI 优化失败，请稍后重试")
		}
	}

	msgs := []relaychat.Msg{
		{Role: "system", Content: optimizeSystemPrompt},
		{Role: "user", Content: prompt},
	}
	start := time.Now()
	reply, err := s.relay.Chat(ctx, mm.ModelKey, msgs)
	reqBody, _ := json.Marshal(msgs)
	eventlog.ModelText(userID, "optimize", mm.ModelKey, "/v1/chat/completions", string(reqBody), reply, start, err, int64(cost), eventlog.ModelTextBillingRef{ID: refID, Type: "ledger"})
	if err != nil {
		if cost > 0 {
			if rerr := points.Refund(s.repo.db, userID, cost, "AI 优化失败退款", refID); rerr != nil {
				logger.L().Error("ai: optimize refund failed",
					zap.String("userId", userID.String()), zap.Error(rerr))
			}
		}
		return "", errors.New("AI 优化失败，请稍后重试")
	}
	return reply, nil
}
