package ai

// optimize.go implements POST /api/ai/optimize-prompt: the 创作台「AI 优化」button.
// It rewrites a user prompt into a richer, generation-ready prompt using the
// relay text model designated in 模型管理 (the AI-optimization primary, else any
// listed text model), via the OpenAI-compatible streaming chat completions.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
	"tidecanvas/internal/pkg/response"
)

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
		response.Fail(c, response.CodeServerError, err.Error())
		return
	}
	response.OK(c, gin.H{"prompt": out})
}

// optimizePrompt rewrites the prompt via the configured relay text model.
func (s *service) optimizePrompt(ctx context.Context, userID idgen.ID, prompt string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", errors.New("请先输入提示词")
	}
	if s.relay == nil {
		return "", errors.New("AI 优化未启用：未配置中转站密钥")
	}
	model := s.repo.textModelKey()
	if model == "" {
		return "", errors.New("AI 优化未启用：请在模型管理添加文本模型并设为「AI 优化主模型」")
	}
	msgs := []relaychat.Msg{
		{Role: "system", Content: optimizeSystemPrompt},
		{Role: "user", Content: prompt},
	}
	start := time.Now()
	reply, err := s.relay.Chat(ctx, model, msgs)
	reqBody, _ := json.Marshal(msgs)
	eventlog.ModelText(userID, "optimize", model, "/v1/chat/completions", string(reqBody), reply, time.Since(start).Milliseconds(), err)
	if err != nil {
		return "", errors.New("AI 优化失败，请稍后重试")
	}
	return reply, nil
}
