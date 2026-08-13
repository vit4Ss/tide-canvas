package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"tidecanvas/internal/pkg/relaychat"
)

// 附件种类由服务端从 FileVO 的 type/mimeType 推导（面板不发 kind）。
// 口径必须与前端 upload-limits.ts 的 referenceKindFromMeta 一致，
// 额外单独识别 audio——chatattach 对音频有专门文案，归进 file 会被当文档去抓。
func TestAttachKind(t *testing.T) {
	cases := []struct {
		name string
		att  assistantAttach
		want string
	}{
		{"fileType=image", assistantAttach{Type: "image"}, "image"},
		{"mime image", assistantAttach{Type: "other", MimeType: "image/png"}, "image"},
		{"fileType=video", assistantAttach{Type: "video"}, "video"},
		{"mime video", assistantAttach{Type: "other", MimeType: "video/mp4"}, "video"},
		{"mime audio → 单列", assistantAttach{Type: "other", MimeType: "audio/mpeg"}, "audio"},
		{"pdf → file", assistantAttach{Type: "other", MimeType: "application/pdf"}, "file"},
		{"未知全空 → file", assistantAttach{}, "file"},
		{"大小写不敏感", assistantAttach{Type: "IMAGE"}, "image"},
		{"mime 带空格", assistantAttach{MimeType: "  image/jpeg "}, "image"},
	}
	for _, c := range cases {
		if got := attachKind(c.att); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// 空 URL 的附件不该进转发列表（否则会平白生成一条「未能读取」说明）。
func TestToChatAttachesSkipsEmptyURL(t *testing.T) {
	out := toChatAttaches([]assistantAttach{
		{URL: "https://cdn.example.com/a.png", Type: "image"},
		{URL: "   ", Type: "image"},
		{URL: "", Type: "other", MimeType: "application/pdf"},
		{URL: "https://cdn.example.com/b.pdf", Type: "other", MimeType: "application/pdf"},
	})
	if len(out) != 2 {
		t.Fatalf("want 2 attaches, got %d: %+v", len(out), out)
	}
	if out[0].Kind != "image" || out[1].Kind != "file" {
		t.Errorf("kinds not derived: %+v", out)
	}
}

// 面板发来的 JSON 必须能解出 attachments——这正是此前漏接的字段：
// 结构体里没有它时 json.Unmarshal 静默丢弃，模型永远收不到附件。
func TestAssistantChatInputParsesAttachments(t *testing.T) {
	raw := []byte(`{
		"prompt":"看看这张图",
		"messages":[{"role":"user","content":"你好"}],
		"attachments":[
			{"name":"a.png","url":"https://cdn.example.com/a.png","type":"image","mimeType":"image/png","size":1024}
		]
	}`)
	var in assistantChatInput
	if err := json.Unmarshal(raw, &in); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(in.Attachments) != 1 {
		t.Fatalf("attachments dropped: %+v", in)
	}
	a := in.Attachments[0]
	if a.URL != "https://cdn.example.com/a.png" || a.MimeType != "image/png" || a.Name != "a.png" {
		t.Errorf("attachment fields not mapped: %+v", a)
	}
	if len(in.Messages) != 1 || in.Prompt != "看看这张图" {
		t.Errorf("prompt/messages regressed: %+v", in)
	}
}

// 图片必须以 image_url part 真正进入 user 消息（不再只是躺在请求体里被丢掉）。
func TestUserMessageCarriesImageParts(t *testing.T) {
	msg := relaychat.UserWithAttachments("看看这张图", []string{"https://cdn.example.com/a.png"}, nil)
	parts, ok := msg.Content.([]relaychat.Part)
	if !ok {
		t.Fatalf("want multimodal []Part, got %T", msg.Content)
	}
	var sawText, sawImage bool
	for _, p := range parts {
		if p.Type == "text" && strings.Contains(p.Text, "看看这张图") {
			sawText = true
		}
		if p.Type == "image_url" && p.ImageURL != nil && p.ImageURL.URL == "https://cdn.example.com/a.png" {
			sawImage = true
		}
	}
	if !sawText || !sawImage {
		t.Errorf("text=%v image=%v, parts=%+v", sawText, sawImage, parts)
	}
}

// 无附件时退化成纯字符串 content，保持线上请求体最小——回归保护。
func TestUserMessageStaysPlainWithoutAttachments(t *testing.T) {
	msg := relaychat.UserWithAttachments("只有文字", nil, nil)
	if _, ok := msg.Content.(string); !ok {
		t.Errorf("want plain string content, got %T", msg.Content)
	}
}

// writeLog 判失败的口径必须与 runTask 落库任务状态时一致：纯文本产出
// （assistant_chat / 文本节点）没有 ResultURL,回复在 Meta["text"]。
// 两处分叉时,成功的文本生成会被记成 success=0 + "generation failed",
// 用户在画布历史面板里看到红叉。这里用同一个判据函数钉住两端。
func TestLogFailureVerdictMatchesTaskVerdict(t *testing.T) {
	// 与 service.go 中 runTask / writeLog 共用的那个布尔表达式同形。
	failed := func(genErr error, res GenerateResult) bool {
		return genErr != nil || (res.ResultURL == "" && !resultHasText(res))
	}
	cases := []struct {
		name string
		err  error
		res  GenerateResult
		want bool
	}{
		{"有图片 URL → 成功", nil, GenerateResult{ResultURL: "https://x/a.png"}, false},
		{"纯文本回复 → 成功", nil, GenerateResult{Meta: map[string]any{"text": "这是回复"}}, false},
		{"空文本 + 无 URL → 失败", nil, GenerateResult{Meta: map[string]any{"text": "  "}}, true},
		{"无 meta 无 URL → 失败", nil, GenerateResult{}, true},
		{"有错误即失败", errStr("boom"), GenerateResult{ResultURL: "https://x/a.png"}, true},
	}
	for _, c := range cases {
		if got := failed(c.err, c.res); got != c.want {
			t.Errorf("%s: got failed=%v, want %v", c.name, got, c.want)
		}
	}
}

func TestTaskTextHandlersAreNotMirroredIntoModelCallLog(t *testing.T) {
	cases := []struct {
		handler string
		want    bool
	}{
		{assistantChatHandler, true},
		{skillTextCompletionHandler, true},
		{"text_to_image", false},
		{"image_to_video", false},
	}
	for _, c := range cases {
		if got := handlerLogsModelCallDirectly(c.handler); got != c.want {
			t.Errorf("handler %q: direct log = %v, want %v", c.handler, got, c.want)
		}
	}
}
