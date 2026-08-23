package ai

import (
	"strings"
	"testing"

	"tidecanvas/internal/pkg/idgen"
)

const planningAnalysisReply = "我先只基于这 8 张关键帧整理视觉证据，音频转写部分会标记为无法确认。"

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

func TestAnalysisResponseRejectsPlanningOnlyText(t *testing.T) {
	if analysisResponseComplete("analyze_video", planningAnalysisReply) {
		t.Fatal("planning-only video response was accepted as complete")
	}
	if analysisResponseComplete("analyze_audio", planningAnalysisReply) {
		t.Fatal("planning-only audio response was accepted as complete")
	}
}

func TestAnalysisResponseRequiresTimestampedDeliverables(t *testing.T) {
	video := "## 结论摘要\n" + strings.Repeat("画面观察具体且有证据。", 20) +
		"\n## 时间轴证据\n| [00:00] | 观察 | 作用 | 高 |\n## ASR 转写\n[00:00] 无法确认音轨内容。\n## 叙事结构\n结构清晰。\n## 镜头节奏\n节奏平稳。\n## 改进建议\n建议强化开场。"
	if !analysisResponseComplete("analyze_video", video) {
		t.Fatal("complete timestamped video response was rejected")
	}
	audio := "## 摘要\n" + strings.Repeat("内容证据明确。", 20) +
		"\n## ASR 转写\n[00:00] 说话人A：示例内容。\n## 行动项\n未明确负责人和期限。"
	if !analysisResponseComplete("analyze_audio", audio) {
		t.Fatal("complete timestamped audio response was rejected")
	}
	if !analysisResponseComplete("", planningAnalysisReply) {
		t.Fatal("ordinary text completion was incorrectly subjected to analysis validation")
	}
}

func TestAudioDataURIBecomesDedicatedInputAudio(t *testing.T) {
	audio, ok, err := inputAudioAttachment("data:audio/mpeg;base64,YWJj", "audio/mpeg")
	if err != nil || !ok || audio.Format != "mp3" || audio.Data != "YWJj" {
		t.Fatalf("inputAudioAttachment() = %#v, %v, %v", audio, ok, err)
	}
	if _, ok, err := inputAudioAttachment("data:text/plain;base64,YWJj", "text/plain"); err != nil || ok {
		t.Fatalf("document was misclassified as audio: ok=%v err=%v", ok, err)
	}
	if _, ok, err := inputAudioAttachment("data:audio/mpeg;base64,%%%", "audio/mpeg"); !ok || err == nil {
		t.Fatal("invalid audio base64 was accepted")
	}
}
