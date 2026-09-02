package model

import "testing"

func TestModelConfigUnderMaintenanceDefaultsToNormal(t *testing.T) {
	for _, raw := range []string{"", `{}`, `{"availabilityStatus":"normal"}`, `{"availabilityStatus":false}`, `not-json`} {
		if ModelConfigUnderMaintenance(raw) {
			t.Fatalf("config %q unexpectedly entered maintenance", raw)
		}
	}
	if !ModelConfigUnderMaintenance(`{"availabilityStatus":"maintenance"}`) {
		t.Fatal("maintenance config was not recognized")
	}
}
