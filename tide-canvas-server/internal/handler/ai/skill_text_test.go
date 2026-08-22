package ai

import (
	"testing"

	"tidecanvas/internal/pkg/idgen"
)

func TestSkillTextTemporaryPathBelongsToCurrentUser(t *testing.T) {
	userID := idgen.ID(123)
	for _, pathValue := range []string{
		"/project/generated/tool-analysis/123/run/frame.jpg",
		`\project\generated\tool-analysis\123\run\audio.mp3`,
	} {
		if !skillTextTemporaryPathBelongsToUser(pathValue, userID) {
			t.Fatalf("valid tool path was rejected: %q", pathValue)
		}
	}
	for _, pathValue := range []string{
		"/project/generated/tool-analysis/124/run/frame.jpg",
		"/project/generated/tool-analysis/123/../124/frame.jpg",
		"/project/generated/tool-analysis/1234/run/frame.jpg",
	} {
		if skillTextTemporaryPathBelongsToUser(pathValue, userID) {
			t.Fatalf("foreign or traversing tool path was accepted: %q", pathValue)
		}
	}
}
