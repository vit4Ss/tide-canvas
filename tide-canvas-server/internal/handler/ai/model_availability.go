package ai

import "tidecanvas/internal/model"

const modelMaintenanceMessage = "该渠道维护中，暂不可用"

func validateModelAvailability(m *model.AiModel) error {
	if m != nil && model.ModelConfigUnderMaintenance(m.Config) {
		return skillPlacementError{message: modelMaintenanceMessage}
	}
	return nil
}
