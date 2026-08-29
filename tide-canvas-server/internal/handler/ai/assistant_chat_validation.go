package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"tidecanvas/internal/model"
)

// maxAssistantChatAttachments is the hard wire limit shared with the normal
// chat endpoint. The canvas assistant used to have no equivalent guard, so a
// large asset-library selection could be charged first and rejected later by
// the relay.
const maxAssistantChatAttachments = 12

// validateAssistantChatInput rejects attachment requests that the selected
// text model is explicitly configured not to accept, or that exceed its own
// attachment count. This runs before the task/points transaction, making an
// invalid multimodal request a normal 400 instead of a paid task followed by
// an automatic refund.
func validateAssistantChatInput(dto *generateDTO, m *model.AiModel) error {
	if dto == nil || m == nil || dto.Handler != assistantChatHandler || len(dto.Input) == 0 {
		return nil
	}
	var in assistantChatInput
	if json.Unmarshal(dto.Input, &in) != nil || len(in.Attachments) == 0 {
		return nil
	}

	if len(in.Attachments) > maxAssistantChatAttachments {
		return skillPlacementError{message: fmt.Sprintf(
			"一次最多分析 %d 个附件，请减少后重试", maxAssistantChatAttachments)}
	}

	var cfg map[string]any
	if strings.TrimSpace(m.Config) != "" && json.Unmarshal([]byte(m.Config), &cfg) == nil && cfg != nil {
		// fileUpload is the admin-facing source of truth. paramsSchema.file_upload
		// is accepted for models synced before the explicit switch was added.
		if enabled, configured := boolConfigValue(cfg, "fileUpload"); configured && !enabled {
			return skillPlacementError{message: "当前文本模型不支持图片或文件输入，请切换支持视觉理解的文本模型"}
		}
		if schema, ok := cfg["paramsSchema"].(map[string]any); ok {
			if enabled, configured := boolConfigValue(schema, "file_upload"); configured && !enabled {
				return skillPlacementError{message: "当前文本模型不支持图片或文件输入，请切换支持视觉理解的文本模型"}
			}
		}
		if limit := inputInt(cfg, "maxFileCount"); limit > 0 && len(in.Attachments) > limit {
			return skillPlacementError{message: fmt.Sprintf(
				"当前文本模型最多分析 %d 个附件，当前选择了 %d 个，请减少后重试",
				limit, len(in.Attachments))}
		}
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
