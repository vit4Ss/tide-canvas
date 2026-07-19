package ai

// assistant_chat.go implements the canvas AI 助手 (画布右侧「AI 助手」面板)。前端
// 走统一的 /api/ai/generate + 轮询 getTask，handler = "assistant_chat"；这里在
// runTask 中特判该 handler，用 relay 文本模型完成一次对话补全，把回复放进
// GenerateResult.Meta["text"]，经 AiTaskVO.resultMeta 回传给面板（parseTaskResult
// 读取 text/content/answer 等键）。

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/relaychat"
)

// assistantChatHandler is the handler key the canvas assistant panel sends.
const assistantChatHandler = "assistant_chat"

// assistantChatSystemPrompt is the canvas assistant persona.
const assistantChatSystemPrompt = "你是流光画布的 AI 创作助手。请用简体中文、简洁而专业地回答用户关于 AI 创作、" +
	"提示词撰写、画面构图与本产品使用的问题；需要时直接给出可复制使用的提示词。不要输出多余的客套与解释。"

// assistantChatInput mirrors the canvas assistant panel's generate input:
// { prompt, messages:[{role,content}], attachments:[...] }.
type assistantChatInput struct {
	Prompt   string `json:"prompt"`
	Messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
}

// runAssistantChat handles handler == "assistant_chat": call the relay text model
// with the conversation history and return the reply in Meta["text"]. Empty reply
// / no relay / no text model surface as a task failure with a clear message.
func (s *service) runAssistantChat(ctx context.Context, m *model.AiModel, dto generateDTO) (GenerateResult, error) {
	if s.relay == nil {
		return GenerateResult{}, errors.New("AI 助手未启用：未配置中转站密钥")
	}
	var in assistantChatInput
	_ = json.Unmarshal(dto.Input, &in)
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		return GenerateResult{}, errors.New("请输入内容")
	}

	// 上游模型 key：优先所选模型的 ModelID（上游标识），退回配置的文本模型。
	modelKey := ""
	if m != nil {
		modelKey = strings.TrimSpace(m.ModelID)
	}
	if modelKey == "" {
		if mm := s.repo.textModel(); mm != nil {
			modelKey = mm.ModelKey
		}
	}
	if modelKey == "" {
		return GenerateResult{}, errors.New("AI 助手未启用：请在模型管理添加文本模型")
	}

	msgs := make([]relaychat.Msg, 0, len(in.Messages)+2)
	msgs = append(msgs, relaychat.Msg{Role: "system", Content: assistantChatSystemPrompt})
	for _, h := range in.Messages {
		content := strings.TrimSpace(h.Content)
		if content == "" {
			continue
		}
		role := h.Role
		if role != "user" && role != "assistant" && role != "system" {
			role = "user"
		}
		msgs = append(msgs, relaychat.Msg{Role: role, Content: content})
	}
	msgs = append(msgs, relaychat.Msg{Role: "user", Content: prompt})

	reply, err := s.relay.Chat(ctx, modelKey, msgs)
	if err != nil {
		return GenerateResult{}, err
	}
	reply = strings.TrimSpace(reply)
	if reply == "" {
		return GenerateResult{}, errors.New("AI 未返回内容")
	}
	return GenerateResult{Meta: map[string]any{"text": reply}}, nil
}
