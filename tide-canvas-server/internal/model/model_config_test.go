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

func TestModelConfigMaxPromptChars(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want int
	}{
		{name: "missing", raw: `{}`, want: 0},
		{name: "zero unlimited", raw: `{"maxPromptChars":0}`, want: 0},
		{name: "negative unlimited", raw: `{"maxPromptChars":-1}`, want: 0},
		{name: "malformed unlimited", raw: `{"maxPromptChars":"100"}`, want: 0},
		{name: "configured", raw: `{"maxPromptChars":2000}`, want: 2000},
		{name: "clamped", raw: `{"maxPromptChars":1000001}`, want: MaxModelPromptChars},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := ModelConfigMaxPromptChars(tc.raw); got != tc.want {
				t.Fatalf("ModelConfigMaxPromptChars(%s) = %d, want %d", tc.raw, got, tc.want)
			}
		})
	}
}
