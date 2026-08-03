package skill

import "testing"

func TestChoosePublicSkillBindingKeepsDisabledExactOverride(t *testing.T) {
	bindings := []publicSkillBinding{
		{Surface: "canvas", TargetType: "*", Enabled: true},
		{Surface: "canvas", TargetType: "character", Enabled: false},
	}
	got := choosePublicSkillBinding(bindings, "canvas", "character")
	if got == nil || got.TargetType != "character" || got.Enabled {
		t.Fatalf("disabled exact row did not override wildcard: %#v", got)
	}
}
