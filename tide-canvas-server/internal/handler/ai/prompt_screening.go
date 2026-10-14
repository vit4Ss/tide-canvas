package ai

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf16"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

type promptScreeningClient struct {
	url, token, mode string
	http             *http.Client
}

func newPromptScreeningClient(cfg *config.Config) *promptScreeningClient {
	if cfg == nil || !cfg.Pancake.PromptScreening {
		return nil
	}
	mode := "test"
	if cfg.Env == config.EnvProd {
		mode = "prod"
	}
	return &promptScreeningClient{url: cfg.Pancake.AdapterURL + "/scan-prompt", token: cfg.Pancake.InternalToken, mode: mode,
		http: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

type promptVerdict struct {
	Action    string `json:"action"`
	Reason    string `json:"reasonCode"`
	RequestID string `json:"requestId"`
}
type promptScreeningError struct{ action, reference string }

func (e *promptScreeningError) Error() string {
	message := "The safety check could not be completed. Try again later. No generation credits were charged."
	if e.action == "block" {
		message = "This prompt does not meet our acceptable use policy. Revise it or contact support. No generation credits were charged."
	}
	if e.action == "review" {
		message = "This prompt needs a safety review. No generation was started and no generation credits were charged. Try again later or contact support."
	}
	if e.action == "length" {
		message = "The combined prompt and text instructions exceed the 10,000-character safety-check limit. Shorten them and try again. No generation credits were charged."
	}
	if e.reference != "" {
		message += " Reference: " + e.reference
	}
	return message
}

func (p *promptScreeningClient) scan(ctx context.Context, prompt string) promptVerdict {
	failed := promptVerdict{Action: "unavailable", Reason: "service_unavailable"}
	body, err := json.Marshal(map[string]string{"mode": p.mode, "prompt": prompt})
	if err != nil {
		return failed
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.url, bytes.NewReader(body))
	if err != nil {
		return failed
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.http.Do(req)
	if err != nil {
		return failed
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return failed
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16385))
	if err != nil || len(raw) > 16384 {
		return failed
	}
	var verdict promptVerdict
	if json.Unmarshal(raw, &verdict) != nil || len(verdict.RequestID) == 0 || len(verdict.RequestID) > 128 {
		return failed
	}
	for _, c := range verdict.RequestID {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return failed
		}
	}
	switch verdict.Reason {
	case "allowed", "review_required", "restricted_content", "service_degraded":
	default:
		return failed
	}
	switch verdict.Action {
	case "allow":
		if verdict.Reason != "allowed" {
			return failed
		}
	case "review", "block":
	default:
		return failed
	}
	return verdict
}

// Include all supported user-written prompt aliases and audio instructions,
// including nested extras. Never forward media URLs, base64 files or credentials.
func generationPromptText(raw json.RawMessage) (string, error) {
	var value map[string]any
	if len(raw) == 0 {
		return "", nil
	}
	if json.Unmarshal(raw, &value) != nil {
		return "", &promptScreeningError{action: "unavailable"}
	}
	seen := map[string]bool{}
	parts := []string{}
	var walk func(any, int) error
	walk = func(value any, depth int) error {
		if depth > 20 {
			return &promptScreeningError{action: "length"}
		}
		switch v := value.(type) {
		case map[string]any:
			keys := make([]string, 0, len(v))
			for key := range v {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				switch strings.ToLower(strings.ReplaceAll(key, "_", "")) {
				case "prompt", "input", "text", "lyrics", "instructions", "instruction", "style", "tags", "title", "negativetags", "negativeprompt", "description", "gptdescriptionprompt", "userprompt":
					if text, ok := v[key].(string); ok {
						text = strings.TrimSpace(text)
						if text != "" && !seen[text] {
							parts = append(parts, text)
							seen[text] = true
						}
					}
				}
				if err := walk(v[key], depth+1); err != nil {
					return err
				}
			}
		case []any:
			for _, item := range v {
				if err := walk(item, depth+1); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := walk(value, 0); err != nil {
		return "", err
	}
	text := strings.Join(parts, "\n\n")
	// Match the SDK's UTF-16 limit; never truncate unreviewed text.
	if len(utf16.Encode([]rune(text))) > 10000 {
		return "", &promptScreeningError{action: "length"}
	}
	return text, nil
}

func (s *service) screenGenerationPrompt(ctx context.Context, userID idgen.ID, dto generateDTO, m *model.AiModel) error {
	if s.promptScreening == nil {
		return nil
	}
	switch m.Type {
	case "image", "video", "audio", "3d", "upscale":
	default:
		return nil
	}
	prompt, err := generationPromptText(dto.Input)
	if err != nil {
		return err
	}
	// Empty prompts (for example video enhancement) need output/media screening,
	// not a fabricated text prompt. This integration does not claim that coverage.
	if prompt == "" {
		return nil
	}
	verdict := s.promptScreening.scan(ctx, prompt)
	mac := hmac.New(sha256.New, []byte(s.promptScreening.token))
	_, _ = mac.Write([]byte(prompt))
	receipt := model.PromptSafetyCheck{ID: idgen.Next(), UserID: userID, ModelID: m.ID,
		PromptHash: hex.EncodeToString(mac.Sum(nil)), Action: verdict.Action, Reason: verdict.Reason,
		ProviderRequestID: verdict.RequestID, CreateTime: time.Now()}
	// Do not proceed without a durable decision receipt; no task or debit exists.
	if err := s.repo.db.WithContext(ctx).Create(&receipt).Error; err != nil {
		return &promptScreeningError{action: "unavailable"}
	}
	if verdict.Action != "allow" {
		return &promptScreeningError{action: verdict.Action, reference: fmt.Sprintf("PS-%s", receipt.ID.String())}
	}
	return nil
}

// Resolve skill templates before checking and keep that exact input for the
// worker. A template edit while the request is queued must not substitute text
// that was never screened. Public task/history input remains the user's input.
func (s *service) prepareScreenedGenerationPrompt(ctx context.Context, userID idgen.ID, dto *generateDTO, m *model.AiModel, gh GenHandler, tool *model.AiTool) error {
	if s.promptScreening == nil {
		return nil
	}
	switch m.Type {
	case "image", "video", "audio", "3d", "upscale":
	default:
		return nil
	}
	input := decodeInput(dto.Input)
	if input == nil {
		input = map[string]any{}
	}
	if strings.TrimSpace(dto.PinnedSkillPrompt) != "" {
		delete(input, "skillId")
		input = applyPromptTemplate(input, strings.TrimSpace(dto.PinnedSkillPrompt))
	} else {
		input = s.applySkill(input, gh)
	}
	applyBaseToolPromptGuard(tool, gh, input)
	if preset, ok := gh.(presetEditHandler); ok {
		prompt, extra := preset.prompt, preset.extra
		if tool != nil {
			if tool.PresetPrompt != "" {
				prompt = tool.PresetPrompt
			}
			if configured := decodeToolExtra(tool.ExtraParams); configured != nil {
				extra = configured
			}
		}
		input["prompt"] = prompt
		for key, value := range extra {
			if _, present := input[key]; !present {
				input[key] = value
			}
		}
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return &promptScreeningError{action: "unavailable"}
	}
	checked := *dto
	checked.Input = raw
	if err := s.screenGenerationPrompt(ctx, userID, checked, m); err != nil {
		return err
	}
	dto.screenedInput = raw
	return nil
}
