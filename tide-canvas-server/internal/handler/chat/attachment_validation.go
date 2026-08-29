package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const maxTextChatAttachments = 12

var errInvalidTextAttachments = errors.New("chat: invalid text attachments")

type invalidTextAttachmentsError struct {
	message string
}

func (e invalidTextAttachmentsError) Error() string { return e.message }

// Unwrap lets handlers classify the error without losing the precise message
// that should be shown to the caller.
func (e invalidTextAttachmentsError) Unwrap() error { return errInvalidTextAttachments }

// validateTextAttachments is the pre-charge guard for normal /chat requests.
// The UI filters by model config, but the server must repeat that check because
// stale clients and asset-library selections can otherwise reach the relay
// after the points have already been reserved.
func (s *service) validateTextAttachments(atts []MessageAttach, requestedModel string) error {
	if len(atts) == 0 {
		return nil
	}
	if len(atts) > maxTextChatAttachments {
		return invalidTextAttachmentsError{message: fmt.Sprintf(
			"一次最多分析 %d 个附件，请减少后重试", maxTextChatAttachments)}
	}
	m := s.repo.resolveTextModel(requestedModel)
	if m == nil || strings.TrimSpace(m.Config) == "" {
		// Legacy text models without capability metadata remain compatible. The
		// relay result is still classified safely if the provider rejects input.
		return nil
	}
	var cfg map[string]any
	if json.Unmarshal([]byte(m.Config), &cfg) != nil || cfg == nil {
		return nil
	}
	if enabled, configured := boolConfigValue(cfg, "fileUpload"); configured && !enabled {
		return invalidTextAttachmentsError{message: "当前文本模型不支持图片或文件输入，请切换支持视觉理解的文本模型"}
	}
	if schema, ok := cfg["paramsSchema"].(map[string]any); ok {
		if enabled, configured := boolConfigValue(schema, "file_upload"); configured && !enabled {
			return invalidTextAttachmentsError{message: "当前文本模型不支持图片或文件输入，请切换支持视觉理解的文本模型"}
		}
	}
	if limit := configInt(cfg, "maxFileCount"); limit > 0 && len(atts) > limit {
		return invalidTextAttachmentsError{message: fmt.Sprintf(
			"当前文本模型最多分析 %d 个附件，当前选择了 %d 个，请减少后重试",
			limit, len(atts))}
	}
	return nil
}

func boolConfigValue(cfg map[string]any, key string) (bool, bool) {
	v, ok := cfg[key]
	if !ok {
		return false, false
	}
	switch value := v.(type) {
	case bool:
		return value, true
	case string:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "true", "1", "yes", "on":
			return true, true
		case "false", "0", "no", "off":
			return false, true
		}
	}
	return false, false
}

func configInt(cfg map[string]any, key string) int {
	switch value := cfg[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case string:
		value = strings.TrimSpace(value)
		end := 0
		for end < len(value) && value[end] >= '0' && value[end] <= '9' {
			end++
		}
		if end > 0 {
			var out int
			for _, digit := range value[:end] {
				out = out*10 + int(digit-'0')
			}
			return out
		}
	}
	return 0
}
