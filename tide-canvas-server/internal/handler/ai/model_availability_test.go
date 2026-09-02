package ai

import (
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

func TestValidateModelAvailability(t *testing.T) {
	if err := validateModelAvailability(&model.AiModel{Config: `{}`}); err != nil {
		t.Fatalf("default model rejected: %v", err)
	}
	err := validateModelAvailability(&model.AiModel{Config: `{"availabilityStatus":"maintenance"}`})
	if err == nil || !strings.Contains(err.Error(), modelMaintenanceMessage) {
		t.Fatalf("maintenance error = %v", err)
	}
}
