package ai

import (
	"strings"
	"testing"
)

// Suno 延长/翻唱的歌曲描述必须走「顶层 prompt」(实测 extras 内无效)。
// audioParams 应据 task 与歌词/描述是否为空,正确决定顶层 Prompt。
func TestAudioParamsTopLevelPrompt(t *testing.T) {
	t.Run("extend without lyrics/desc → default top-level prompt", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"extras": map[string]any{"task": "extend", "continue_clip_id": "c1"},
		})
		if strings.TrimSpace(p.Prompt) == "" {
			t.Fatalf("want non-empty default Prompt for blank extend, got %q", p.Prompt)
		}
		if _, ok := p.Extras["prompt"]; ok {
			t.Fatalf("must not inject extras.prompt (provider ignores it): %#v", p.Extras)
		}
	})

	t.Run("extend with lyrics → no top-level prompt (lyrics carries it)", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"lyrics": "[Verse] hello",
			"extras": map[string]any{"task": "extend", "continue_clip_id": "c1"},
		})
		if p.Prompt != "" {
			t.Fatalf("Prompt must stay empty when lyrics present, got %q", p.Prompt)
		}
		if p.Extras["lyrics"] != "[Verse] hello" {
			t.Fatalf("lyrics lost: %#v", p.Extras)
		}
	})

	t.Run("extend with user description → prompt set, input cleared (no double-send)", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"prompt": "轻快的钢琴续写",
			"extras": map[string]any{"task": "extend", "continue_clip_id": "c1"},
		})
		if p.Prompt != "轻快的钢琴续写" {
			t.Fatalf("want user description as Prompt, got %q", p.Prompt)
		}
		if p.Input != "" {
			t.Fatalf("Input must be cleared for extend (desc goes to Prompt only), got %q", p.Input)
		}
	})

	t.Run("cover without lyrics → default top-level prompt", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"extras": map[string]any{"task": "cover", "cover_clip_id": "c2"},
		})
		if strings.TrimSpace(p.Prompt) == "" {
			t.Fatalf("want non-empty default Prompt for blank cover, got %q", p.Prompt)
		}
	})

	t.Run("upload registration → no top-level prompt", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"extras": map[string]any{"task": "upload", "audio_url": "https://x/y.mp3"},
		})
		if p.Prompt != "" {
			t.Fatalf("upload must not gain a Prompt: %q", p.Prompt)
		}
	})

	t.Run("inspire (no task) → Input kept, no top-level prompt", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{"prompt": "一首民谣"})
		if p.Input != "一首民谣" {
			t.Fatalf("input lost: %q", p.Input)
		}
		if p.Prompt != "" {
			t.Fatalf("inspire must not set top-level Prompt (keeps input behavior): %q", p.Prompt)
		}
	})
}

// 错误分级:输入类映射到具体可操作文案,其余一律系统异常统一口径。
func TestUserFacingGenError(t *testing.T) {
	sys := "系统异常，请联系客服"
	cases := []struct {
		raw  string
		want string
	}{
		{"relaymedia: mxapi: 502 ... gpt_description_prompt,prompt can not both null", "请补充音乐描述或歌词后重试"},
		{"upstream: at least one reference image is required", "请先上传所需的参考素材后重试"},
		{"blocked by content policy", "内容未通过安全审核，请调整后重试"},
		{"relaymedia: mxapi: 502 BAD_GATEWAY connection reset", sys},
		{"context deadline exceeded", sys},
	}
	for _, c := range cases {
		got := userFacingGenError(errStr(c.raw))
		if got != c.want {
			t.Errorf("raw=%q → got %q, want %q", c.raw, got, c.want)
		}
	}
	if userFacingGenError(nil) != sys {
		t.Errorf("nil err should map to system message")
	}
}

type errStr string

func (e errStr) Error() string { return string(e) }
