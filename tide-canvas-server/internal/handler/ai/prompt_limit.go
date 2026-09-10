package ai

import (
	"fmt"
	"unicode/utf8"

	"tidecanvas/internal/model"
)

// validateModelPromptCharLimit applies only to video models and runs before a
// task row or point charge is created. Frontends perform the same check for
// immediate feedback; this remains authoritative for API/manual callers.
func validateModelPromptCharLimit(dto *generateDTO, m *model.AiModel) error {
	if dto == nil || m == nil || m.Type != "video" {
		return nil
	}
	limit := model.ModelConfigMaxPromptChars(m.Config)
	if limit <= 0 {
		return nil
	}
	prompt, _ := decodeInput(dto.Input)["prompt"].(string)
	count := utf8.RuneCountInString(prompt)
	if count <= limit {
		return nil
	}
	return skillPlacementError{message: fmt.Sprintf(
		"提示词超过当前模型的 %d 字限制（当前 %d 字），请精简后再生成",
		limit,
		count,
	)}
}
