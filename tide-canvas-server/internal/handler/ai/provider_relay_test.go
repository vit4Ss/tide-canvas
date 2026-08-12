package ai

import (
	"fmt"
	"strings"
	"testing"

	"tidecanvas/internal/pkg/relaymedia"
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

func TestThreeDParamsMapsStudioInput(t *testing.T) {
	p := (&relayProviderClient{}).threeDParams("hy-3d-3.1", map[string]any{
		"prompt":       "机械小狗",
		"enablePbr":    true,
		"faceCount":    float64(640000),
		"generateType": "Geometry",
		"resultFormat": "FBX",
		"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "https://cdn/front.png"},
			map[string]any{"view_type": "back", "view_image_url": "https://cdn/back.png"},
		},
	})
	if p.Model != "hy-3d-3.1" || p.Prompt != "机械小狗" || !p.EnablePBR || p.FaceCount != 640000 {
		t.Fatalf("threeDParams = %+v", p)
	}
	if p.GenerateType != "Geometry" || p.ResultFormat != "FBX" {
		t.Fatalf("3D options = %+v", p)
	}
	if len(p.MultiViewImages) != 2 || p.MultiViewImages[0].ViewType != "front" || p.MultiViewImages[1].ViewImageURL != "https://cdn/back.png" {
		t.Fatalf("views = %+v", p.MultiViewImages)
	}
}

func TestUpscaleParamsMapsStudioInput(t *testing.T) {
	p := (&relayProviderClient{}).upscaleParams("wavespeed-ai/video-upscaler", map[string]any{
		"videoUrl":         "https://example.com/input.mp4",
		"targetResolution": "4k",
	})
	if p.Model != "wavespeed-ai/video-upscaler" || p.VideoURL != "https://example.com/input.mp4" || p.TargetResolution != "4k" {
		t.Fatalf("upscaleParams = %+v", p)
	}
	// snake_case 键同样可用;通用 resolution 键刻意忽略(视频节点残留的 480p
	// 会撞超分白名单,不带档位走上游默认 1080p 反而能成)。
	p = (&relayProviderClient{}).upscaleParams("bytedance/video-upscaler", map[string]any{
		"video_url":         "https://example.com/in.mp4",
		"resolution":        "480p",
		"target_resolution": "2k",
	})
	if p.VideoURL != "https://example.com/in.mp4" || p.TargetResolution != "2k" {
		t.Fatalf("upscaleParams (snake) = %+v", p)
	}
	p = (&relayProviderClient{}).upscaleParams("bytedance/video-upscaler", map[string]any{
		"videoUrl":   "https://example.com/in.mp4",
		"resolution": "480p",
	})
	if p.TargetResolution != "" {
		t.Fatalf("generic resolution must be ignored, got %q", p.TargetResolution)
	}
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
		{"relaymedia: invalid aspect '3:4' for model 'gpt-image-2'; supported: 1:1, 2:3", "所选画面比例或尺寸不受支持，请调整后重试"},
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

func TestUserFacingGenErrorUsesSelectedRelayBusinessMessages(t *testing.T) {
	t.Parallel()

	const apiYIOuter = `APIYI: 400 BAD_REQUEST {"error":{"message":"The generated image was filtered by the safety policy. Please adjust your prompt and try again.","localized_message":"Unknown error","type":"invalid_request_error","param":"","code":"image_safety"}}`
	// 5002 always uses the stable Chinese safety copy, regardless of Relay's
	// language, nested provider details, empty message, or error wrapping.
	for _, err := range []error{
		&relaymedia.UpstreamError{Code: "5002", Type: "task_failed", Message: "English safety detail"},
		&relaymedia.UpstreamError{Code: "5002", Message: apiYIOuter},
		&relaymedia.UpstreamError{Code: "5002"},
		fmt.Errorf("provider failed: %w", &relaymedia.UpstreamError{Code: "5002", Message: "rate limit exceeded"}),
	} {
		if got := userFacingGenError(err); got != userFacingSafetyErr {
			t.Errorf("code 5002: got %q, want %q", got, userFacingSafetyErr)
		}
	}

	// 5009 is Relay's dedicated copyright restriction. Use stable, actionable
	// product copy and never leak or depend on the provider's raw wording.
	for _, err := range []error{
		&relaymedia.UpstreamError{HTTPStatus: 422, Code: "5009", Type: "copyright_restriction", Message: "copyrighted audio detail"},
		&relaymedia.UpstreamError{HTTPStatus: 422, Code: "5009"},
		fmt.Errorf("provider failed: %w", &relaymedia.UpstreamError{Code: "5009", Message: "rate limit exceeded"}),
	} {
		if got := userFacingGenError(err); got != userFacingCopyrightErr {
			t.Errorf("code 5009: got %q, want %q", got, userFacingCopyrightErr)
		}
	}

	// 5003 keeps Relay's actionable invalid-input detail.
	message5003 := "Relay 返回的可操作提示 5003"
	if got := userFacingGenError(&relaymedia.UpstreamError{Code: "5003", Type: "task_failed", Message: message5003}); got != message5003 {
		t.Errorf("code 5003: got %q, want %q", got, message5003)
	}

	// Do not assume the first brace begins the provider envelope. Some relays
	// prepend structured metadata before the actual nested error.
	multiObject := `metadata {"attempt":1} APIYI: 400 BAD_REQUEST {"error":{"message":"inner input error"}}`
	if got := userFacingGenError(&relaymedia.UpstreamError{Code: "5003", Message: multiObject}); got != "inner input error" {
		t.Errorf("later nested provider error: got %q", got)
	}

	// Malformed or message-less nested JSON must preserve the outer Relay copy.
	for _, outer := range []string{
		`APIYI: 400 BAD_REQUEST {"error":{"message":`,
		`APIYI: 400 BAD_REQUEST {"error":{"message":""}}`,
	} {
		if got := userFacingGenError(&relaymedia.UpstreamError{Code: "5003", Message: outer}); got != outer {
			t.Errorf("nested fallback: got %q, want outer %q", got, outer)
		}
	}

	// The business code takes priority over the legacy keyword classifier, and
	// errors.As must still find it when an intermediate layer wraps the error.
	direct := "rate limit exceeded"
	wrapped := fmt.Errorf("provider failed: %w", &relaymedia.UpstreamError{Code: "5003", Message: direct})
	if got := userFacingGenError(wrapped); got != direct {
		t.Errorf("wrapped code 5003: got %q, want direct message %q", got, direct)
	}

	// Empty selected-code messages still use the old safe fallback.
	if got := userFacingGenError(&relaymedia.UpstreamError{Code: "5003"}); got != userFacingGenErr {
		t.Errorf("empty code 5003 message: got %q, want fallback %q", got, userFacingGenErr)
	}

	// Keep the persisted task error within ai_tasks.error_msg varchar(1024),
	// without corrupting multi-byte text.
	longMessage := strings.Repeat("错", 1100)
	got := userFacingGenError(&relaymedia.UpstreamError{Code: "5003", Message: longMessage})
	if len([]rune(got)) != 1024 || !strings.HasSuffix(got, "…") {
		t.Errorf("long direct message was not safely capped: runes=%d suffix=%q", len([]rune(got)), got[len(got)-3:])
	}

	// 其它业务码不得因为结构化 code 而直接透传，仍走原有关键词/兜底规则。
	if got := userFacingGenError(&relaymedia.UpstreamError{Code: "5004", Message: "relay account balance: secret detail"}); got != userFacingGenErr {
		t.Errorf("code 5004 leaked relay message: %q", got)
	}
	if got := userFacingGenError(&relaymedia.UpstreamError{Code: "5008", Message: "rate limit exceeded"}); got != "当前生成排队较多，请稍后重试" {
		t.Errorf("code 5008 did not use legacy msg mapping: %q", got)
	}
}

type errStr string

func (e errStr) Error() string { return string(e) }
