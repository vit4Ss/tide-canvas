package relaychat

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestTextMsgWireShape confirms a text-only message serializes to a plain string
// content (backward compatible with the pre-multimodal wire contract).
func TestTextMsgWireShape(t *testing.T) {
	b, _ := json.Marshal(TextMsg("user", "你好"))
	got := string(b)
	want := `{"role":"user","content":"你好"}`
	if got != want {
		t.Fatalf("text msg wire shape mismatch:\n got=%s\nwant=%s", got, want)
	}
}

// TestUserMultimodalWireShape confirms an image-bearing user message serializes to
// the OpenAI vision content-array shape the relay expects.
func TestUserMultimodalWireShape(t *testing.T) {
	b, _ := json.Marshal(UserMultimodal("描述这张图", []string{"https://x/a.png", "https://x/b.png"}))
	got := string(b)
	want := `{"role":"user","content":[` +
		`{"type":"text","text":"描述这张图"},` +
		`{"type":"image_url","image_url":{"url":"https://x/a.png"}},` +
		`{"type":"image_url","image_url":{"url":"https://x/b.png"}}]}`
	if got != want {
		t.Fatalf("multimodal wire shape mismatch:\n got=%s\nwant=%s", got, want)
	}
}

// TestUserMultimodalNoImages degrades to a plain text message when no images.
func TestUserMultimodalNoImages(t *testing.T) {
	b, _ := json.Marshal(UserMultimodal("纯文本", nil))
	if string(b) != `{"role":"user","content":"纯文本"}` {
		t.Fatalf("no-image multimodal should be plain text, got=%s", b)
	}
}

// TestLastUserTargeting mirrors streamReply's logic: build a transcript as text
// messages, then replace the LAST user message with the multimodal variant. The
// system prompt and assistant turns must be untouched; only the final user turn
// carries the image.
func TestLastUserTargeting(t *testing.T) {
	msgs := []Msg{
		TextMsg("system", "persona"),
		TextMsg("user", "第一句"),
		TextMsg("assistant", "回复一"),
		TextMsg("user", "第二句带图"),
	}
	imageURLs := []string{"https://x/img.png"}
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			msgs[i] = UserMultimodal("第二句带图", imageURLs)
			break
		}
	}

	// system + first user + assistant stay string content.
	for _, idx := range []int{0, 1, 2} {
		if _, ok := msgs[idx].Content.(string); !ok {
			t.Fatalf("msg[%d] should keep string content, got %T", idx, msgs[idx].Content)
		}
	}
	// last user becomes a []Part with one image.
	parts, ok := msgs[3].Content.([]Part)
	if !ok {
		t.Fatalf("last user msg should be multimodal []Part, got %T", msgs[3].Content)
	}
	imgs := 0
	for _, p := range parts {
		if p.Type == "image_url" && p.ImageURL != nil && p.ImageURL.URL == "https://x/img.png" {
			imgs++
		}
	}
	if imgs != 1 {
		t.Fatalf("expected exactly 1 image_url part on the last user msg, got %d", imgs)
	}

	// whole request marshals to valid JSON containing exactly one image_url.
	payload, err := json.Marshal(chatRequest{Model: "gpt-5.5", Messages: msgs, Stream: true})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	// count image parts via the unique part-type marker (the literal "image_url"
	// also appears as the object key, so match the typed part instead).
	if n := strings.Count(string(payload), `{"type":"image_url"`); n != 1 {
		t.Fatalf("expected 1 image part in payload, got %d: %s", n, payload)
	}
}
