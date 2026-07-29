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

		// 审核类优先于输入类:回执带 prompt 字样也不能被「提示词」规则截胡。
		{"relaymedia: your prompt was flagged by our moderation system", "内容未通过安全审核，请调整后重试"},
		{"relaymedia: NSFW content detected", "内容未通过安全审核，请调整后重试"},
		// OpenAI 安审真实回执(经中转站透传):含 request ID 与 help.openai.com,
		// 一个字都不能出站,只认 "safety system" 特征。
		{`relaymedia: HTTP 400: {"error":{"message":"Your request was rejected by the ` +
			`safety system. If you believe this is an error, contact us at help.openai.com ` +
			`and include the request ID e04b5e0d-02da-4649-b0ff-23b97c91fc5a.","code":400,` +
			`"metadata":{"provider_name":"OpenAI"}}}`, "内容未通过安全审核，请调整后重试"},
		{"relaymedia: request rejected: artist name not allowed", "内容涉及受保护的名称或作品，请改用描述性表达后重试"},
		// 参考图版权:上游文案已是中文,但带厂商名与内部码,仍不能出站;且必须走
		// 「换图」而不是通用的「改描述」。
		{"dimensio: 参考图可能涉及版权限制，请修改后重试 (2039)", "参考图可能涉及版权限制，请更换参考素材后重试"},

		// 音乐:歌词过长要先于「歌词必填」命中。
		{"relaymedia: lyrics is too long (max 3000 chars)", "歌词过长，请精简后重试"},
		{"relaymedia: lyrics is required for this task", "请填写歌词后重试"},

		// 参考素材:含我们自抛的 edits 校验。
		{"relaymedia: edits require at least one image url", "请先上传所需的参考素材后重试"},
		{"relaymedia: failed to download image from url", "参考素材无法读取，请重新上传后重试"},
		{"relaymedia: unsupported image format: image/heic", "参考素材格式不支持，请改用 JPG / PNG 后重试"},
		{"relaymedia: HTTP 400: image too large", "参考素材体积或分辨率超限，请压缩后重试"},

		// 提示词:空与超长分流。
		{"relaymedia: prompt is required", "请输入提示词后重试"},
		{"relaymedia: audio requires input text or extras", "请输入提示词后重试"},
		{"relaymedia: prompt is too long", "提示词过长，请精简后重试"},

		// 生成参数。
		{"relaymedia: HTTP 400: unsupported aspect ratio 21:9", "所选画面比例或尺寸不受支持，请调整后重试"},
		{"relaymedia: invalid duration: must be 5 or 10", "所选时长不受支持，请调整后重试"},

		// 限流:不甩锅给用户,但给可操作动作。
		{"relaymedia: HTTP 429: rate limit exceeded", "当前生成排队较多，请稍后重试"},

		// 我们的问题,必须留在系统异常——不能让用户去改提示词。
		{"relaymedia: HTTP 402: insufficient balance", sys},
		{"relaymedia: HTTP 401: invalid api key", sys},
		{"relaymedia: task abc timed out: context deadline exceeded", sys},
		{"relaymedia: response body exceeds 1048576 bytes", sys},
		{"relaymedia: task abc succeeded with no media url", sys},
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
