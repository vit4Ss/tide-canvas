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
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/chatattach"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
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
	Attachments []assistantAttach `json:"attachments"`
}

// assistantAttach 是面板发来的一条附件（canvas-assistant-panel.tsx 的
// attachments.map）。注意它带的是 FileVO 的 type/mimeType，没有 kind——
// 种类由 attachKind 在服务端推导，与前端 referenceKindFromMeta 同口径。
type assistantAttach struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Type     string `json:"type"`     // FileVO.fileType: image | video | other
	MimeType string `json:"mimeType"` // 如 image/png、application/pdf、audio/mpeg
}

// attachKind 把附件归到 chatattach 认识的四类。镜像前端
// upload-limits.ts 的 referenceKindFromMeta，额外单独识别 audio——
// chatattach 对音频有专门的「无法收听」说明文案，归进 file 会被当文档去抓取。
func attachKind(a assistantAttach) string {
	t := strings.ToLower(strings.TrimSpace(a.Type))
	mt := strings.ToLower(strings.TrimSpace(a.MimeType))
	switch {
	case t == "image" || strings.HasPrefix(mt, "image/"):
		return "image"
	case t == "video" || strings.HasPrefix(mt, "video/"):
		return "video"
	case strings.HasPrefix(mt, "audio/"):
		return "audio"
	default:
		return "file"
	}
}

func toChatAttaches(atts []assistantAttach) []chatattach.Attach {
	out := make([]chatattach.Attach, 0, len(atts))
	for _, a := range atts {
		if u := strings.TrimSpace(a.URL); u != "" {
			out = append(out, chatattach.Attach{URL: u, Kind: attachKind(a)})
		}
	}
	return out
}

// runAssistantChat handles handler == "assistant_chat": call the relay text model
// with the conversation history and return the reply in Meta["text"]. Empty reply
// / no relay / no text model surface as a task failure with a clear message.
func (s *service) runAssistantChat(ctx context.Context, userID idgen.ID, m *model.AiModel, effectiveInput map[string]any, pointCost int64) (GenerateResult, error) {
	if s.relay == nil {
		return GenerateResult{}, errors.New("AI 助手未启用：未配置中转站密钥")
	}
	var in assistantChatInput
	raw, _ := json.Marshal(effectiveInput)
	_ = json.Unmarshal(raw, &in)
	prompt := strings.TrimSpace(in.Prompt)
	atts := toChatAttaches(in.Attachments)
	// 只有附件没正文也算有效输入（面板会补默认提示词，这里是防御）。
	if prompt == "" && len(atts) == 0 {
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
	// 当前轮挂附件：图片走 image_url part，文档抓下来走 file part，视频/音频
	// 与读取失败的情况由 note 以文字说明并入正文（与生成页对话同一套实现，
	// 见 pkg/chatattach）。历史消息不带附件——它们只有落库的纯文本。
	imageURLs := chatattach.ImageURLs(atts)
	// 本站存储的图片改写成传输加速域名,境外上游取图才不会超时（与生成参考图
	// 同一规则,见 provider_relay）。
	if s.storage != nil {
		for i, u := range imageURLs {
			imageURLs[i] = s.storage.UpstreamURL(u)
		}
	}
	docFiles, docNote := chatattach.Extractor{Hosts: s.docHosts, Store: s.storage}.FileParts(ctx, atts)
	if docNote != "" {
		prompt = strings.TrimSpace(prompt + "\n\n" + docNote)
	}
	msgs = append(msgs, relaychat.UserWithAttachments(prompt, imageURLs, docFiles))

	// 与生成页对话同一口径记录模型调用（生成记录模块按它审计每次调用）;
	// 只记当前轮（最后一条 user 消息,历史在面板持久化消息里）,附件 base64
	// 净化后再落库,保留文件名/类型。
	start := time.Now()
	reply, err := s.relay.Chat(ctx, modelKey, msgs)
	turn := msgs
	if n := len(msgs); n > 1 {
		turn = msgs[n-1:]
	}
	reqBody, _ := json.Marshal(turn)
	eventlog.ModelText(userID, "assistant", modelKey, "/v1/chat/completions", eventlog.SanitizeDataURIs(string(reqBody)), reply, start, err, pointCost)
	if err != nil {
		return GenerateResult{}, err
	}
	reply = strings.TrimSpace(reply)
	if reply == "" {
		return GenerateResult{}, errors.New("AI 未返回内容")
	}
	return GenerateResult{Meta: map[string]any{"text": reply}}, nil
}
