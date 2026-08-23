package eventlog

import (
	"strings"
	"testing"
)

// data URI 载荷被替换为占位,文件名与 JSON 结构完整保留。
func TestSanitizeDataURIs(t *testing.T) {
	huge := "data:application/pdf;base64," + strings.Repeat("A", 5000)
	body := `[{"role":"user","content":[{"type":"text","text":"看下这个"},` +
		`{"type":"file","file":{"filename":"报告.pdf","file_data":"` + huge + `"}}]}]`
	got := SanitizeDataURIs(body)
	if strings.Contains(got, huge) {
		t.Error("base64 payload must be scrubbed")
	}
	if !strings.Contains(got, "base64 omitted") {
		t.Errorf("placeholder missing: %s", got)
	}
	if !strings.Contains(got, "报告.pdf") || !strings.Contains(got, "看下这个") {
		t.Errorf("filename/text must survive: %s", got)
	}
	// 净化后仍是合法 JSON(截断前就完整,不依赖容错解析)
	if !strings.HasPrefix(got, "[{") || !strings.HasSuffix(got, "}]") {
		t.Errorf("structure broken: %s", got)
	}
}

func TestSanitizeInputAudioBase64(t *testing.T) {
	payload := strings.Repeat("A", 5000)
	body := `[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"` + payload + `","format":"mp3"}}]}]`
	got := SanitizeDataURIs(body)
	if strings.Contains(got, payload) || !strings.Contains(got, "base64 omitted") {
		t.Fatalf("raw input_audio payload was not scrubbed: %s", got)
	}
	if !strings.Contains(got, `"format":"mp3"`) {
		t.Fatalf("audio metadata was lost: %s", got)
	}
}

// 无 data URI / 非 JSON 输入原样返回。
func TestSanitizeDataURIsPassthrough(t *testing.T) {
	plain := `{"prompt":"没有附件"}`
	if got := SanitizeDataURIs(plain); got != plain {
		t.Errorf("plain body must pass through: %s", got)
	}
	notJSON := "not-json data: but broken"
	if got := SanitizeDataURIs(notJSON); got != notJSON {
		t.Errorf("broken body must pass through: %s", got)
	}
}
