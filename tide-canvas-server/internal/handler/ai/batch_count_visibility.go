package ai

import (
	"encoding/json"
	"strings"

	"tidecanvas/internal/model"
)

// modelHidesBatchCount reads the admin-owned image-model UI policy. Missing or
// false preserves the historical default: batch selection remains available.
func modelHidesBatchCount(m *model.AiModel) bool {
	if m == nil || !strings.EqualFold(strings.TrimSpace(m.Type), "image") {
		return false
	}
	var cfg struct {
		HideBatchCount bool `json:"hideBatchCount"`
	}
	return json.Unmarshal([]byte(m.Config), &cfg) == nil && cfg.HideBatchCount
}

// validateHiddenBatchCountInput is the rolling-deploy/server-side guard. A
// stale client may still render the old selector, but it must not silently
// create and charge a multi-image task after the administrator hides it.
func validateHiddenBatchCountInput(dto *generateDTO, m *model.AiModel) error {
	if dto == nil || !modelHidesBatchCount(m) {
		return nil
	}
	if batchCount(decodeInput(dto.Input)) > 1 {
		return skillPlacementError{message: "所选图片模型已固定为单张生成，请刷新页面后重试"}
	}
	return nil
}
