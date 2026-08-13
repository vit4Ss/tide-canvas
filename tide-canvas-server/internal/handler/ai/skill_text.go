package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
)

// skillTextCompletionHandler is a generic, task-backed text completion used by
// SkillRun agent/workflow steps. Unlike assistant_chat it has no hard-coded
// persona or conversation persistence; billing, task lifecycle and audit still
// go through the regular AI generation service.
const skillTextCompletionHandler = "skill_text_completion"

type skillTextInput struct {
	SystemPrompt string `json:"systemPrompt"`
	Prompt       string `json:"prompt"`
	StrictJSON   bool   `json:"strictJson"`
	Messages     []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
	ImageURLs []string `json:"imageUrls"`
}

func (s *service) runSkillTextCompletion(ctx context.Context, userID idgen.ID, m *model.AiModel, effectiveInput map[string]any, pointCost int64) (GenerateResult, error) {
	if s.relay == nil {
		return GenerateResult{}, errors.New("text model relay is not configured")
	}
	raw, _ := json.Marshal(effectiveInput)
	var in skillTextInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return GenerateResult{}, errors.New("invalid text completion input")
	}
	modelKey := ""
	if m != nil {
		modelKey = strings.TrimSpace(m.ModelID)
	}
	if modelKey == "" {
		return GenerateResult{}, errors.New("text model is required")
	}

	msgs := make([]relaychat.Msg, 0, len(in.Messages)+2)
	if p := strings.TrimSpace(in.SystemPrompt); p != "" {
		msgs = append(msgs, relaychat.TextMsg("system", p))
	}
	for _, item := range in.Messages {
		role := strings.ToLower(strings.TrimSpace(item.Role))
		if role != "system" && role != "assistant" && role != "user" {
			role = "user"
		}
		if content := strings.TrimSpace(item.Content); content != "" {
			msgs = append(msgs, relaychat.TextMsg(role, content))
		}
	}
	prompt := strings.TrimSpace(in.Prompt)
	if prompt != "" || len(in.ImageURLs) > 0 {
		urls := in.ImageURLs
		if s.storage != nil {
			for i, u := range urls {
				urls[i] = s.storage.UpstreamURL(u)
			}
		}
		msgs = append(msgs, relaychat.UserMultimodal(prompt, urls))
	}
	if len(msgs) == 0 {
		return GenerateResult{}, errors.New("text completion prompt is required")
	}

	started := time.Now()
	reply, err := s.relay.Chat(ctx, modelKey, msgs)
	if err == nil {
		reply = strings.TrimSpace(reply)
		if reply == "" {
			err = errors.New("model returned empty response")
		} else if in.StrictJSON {
			reply = stripJSONFence(reply)
			if !json.Valid([]byte(reply)) {
				err = errors.New("model returned invalid JSON")
			}
		}
	}
	reqBody, _ := json.Marshal(msgs)
	eventlog.ModelText(userID, "skill", modelKey, "/v1/chat/completions", eventlog.SanitizeDataURIs(string(reqBody)), reply, started, err, pointCost)
	if err != nil {
		return GenerateResult{}, err
	}
	return GenerateResult{Meta: map[string]any{"text": reply}}, nil
}

func stripJSONFence(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = s[i+1:]
		}
		if i := strings.LastIndex(s, "```"); i >= 0 {
			s = s[:i]
		}
	}
	return strings.TrimSpace(s)
}
