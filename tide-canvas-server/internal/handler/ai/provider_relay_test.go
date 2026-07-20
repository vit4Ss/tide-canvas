package ai

import "testing"

// 供应商对引用型音乐任务(延长/翻唱)校验 prompt 与 gpt_description_prompt
// 不可同时缺席;歌词留空的延长请求必须补显式空串 prompt(上传登记除外)。
func TestAudioParamsTaskPromptFallback(t *testing.T) {
	t.Run("extend without lyrics gets empty prompt", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"extras": map[string]any{"task": "extend", "continue_clip_id": "c1"},
		})
		v, ok := p.Extras["prompt"]
		if !ok || v != "" {
			t.Fatalf("want extras[prompt]=\"\" for lyricless extend, got %#v (present=%v)", v, ok)
		}
	})

	t.Run("extend with lyrics keeps lyrics, no prompt injected", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"lyrics": "[Verse] hello",
			"extras": map[string]any{"task": "extend", "continue_clip_id": "c1"},
		})
		if _, ok := p.Extras["prompt"]; ok {
			t.Fatalf("prompt must not be injected when lyrics present: %#v", p.Extras)
		}
		if p.Extras["lyrics"] != "[Verse] hello" {
			t.Fatalf("lyrics lost: %#v", p.Extras)
		}
	})

	t.Run("cover without lyrics gets empty prompt", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"extras": map[string]any{"task": "cover", "cover_clip_id": "c2"},
		})
		if v, ok := p.Extras["prompt"]; !ok || v != "" {
			t.Fatalf("want extras[prompt]=\"\" for lyricless cover, got %#v (present=%v)", v, ok)
		}
	})

	t.Run("upload registration payload untouched", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{
			"extras": map[string]any{"task": "upload", "audio_url": "https://x/y.mp3"},
		})
		if _, ok := p.Extras["prompt"]; ok {
			t.Fatalf("upload must not gain a prompt field: %#v", p.Extras)
		}
	})

	t.Run("inspire mode (no task) untouched", func(t *testing.T) {
		p := audioParams("suno-v5", map[string]any{"prompt": "一首民谣"})
		if _, ok := p.Extras["prompt"]; ok {
			t.Fatalf("non-task request must not gain extras prompt: %#v", p.Extras)
		}
		if p.Input != "一首民谣" {
			t.Fatalf("input lost: %q", p.Input)
		}
	})
}
