package admin

import (
	"strings"
	"testing"
)

var testHosts = []string{"cdn.example.com", "bucket.oss-cn-shanghai.aliyuncs.com"}

// chat 落库的是顶层 messages 数组,当前轮 user 挂 image_url + file 附件。
func TestParseRequestChatWithAttachments(t *testing.T) {
	body := `[
		{"role":"system","content":"你是助手"},
		{"role":"user","content":"之前的问题"},
		{"role":"user","content":[
			{"type":"text","text":"总结这两个附件"},
			{"type":"image_url","image_url":{"url":"https://cdn.example.com/canvas/uploads/pic.png"}},
			{"type":"file","file":{"filename":"报告.pdf","file_data":"data:…(base64 omitted, 12345 bytes)"}}
		]}
	]`
	got := parseRequestBody(body, testHosts)
	if got.Prompt != "总结这两个附件" {
		t.Errorf("prompt: %q", got.Prompt)
	}
	if len(got.Inputs) != 2 {
		t.Fatalf("inputs: %+v", got.Inputs)
	}
	if got.Inputs[0].Kind != "image" || got.Inputs[0].URL == "" {
		t.Errorf("image input: %+v", got.Inputs[0])
	}
	if got.Inputs[1].Kind != "file" || got.Inputs[1].Name != "报告.pdf" {
		t.Errorf("file input: %+v", got.Inputs[1])
	}
}

// 生成类请求:prompt 主字段、标量参数进网格、参考图进输入素材。
func TestParseRequestGeneration(t *testing.T) {
	body := `{
		"model":"seedance-2.0","prompt":"西部荒原,骑马的人","duration":12,"ratio":"16:9",
		"resolution":"720p","face_grid":false,"stream":true,"api_key":"sk-secret",
		"images":["https://bucket.oss-cn-shanghai.aliyuncs.com/canvas/uploads/ref.jpg"]
	}`
	got := parseRequestBody(body, testHosts)
	if got.Prompt != "西部荒原,骑马的人" {
		t.Errorf("prompt: %q", got.Prompt)
	}
	params := map[string]string{}
	for _, p := range got.Params {
		params[p.Key] = p.Value
	}
	if params["ratio"] != "16:9" || params["duration"] != "12" || params["resolution"] != "720p" || params["face_grid"] != "false" {
		t.Errorf("params: %+v", got.Params)
	}
	if _, denied := params["api_key"]; denied {
		t.Errorf("api_key must not leak into params")
	}
	if _, denied := params["prompt"]; denied {
		t.Errorf("prompt must not duplicate into params")
	}
	if len(got.Inputs) != 1 || got.Inputs[0].Kind != "image" {
		t.Errorf("inputs: %+v", got.Inputs)
	}
}

// eventlog 截断的请求体(非法 JSON)退回正则提取。
func TestParseRequestTruncated(t *testing.T) {
	body := `[{"role":"user","content":[{"type":"text","text":"分析这份文件"},` +
		`{"type":"file","file":{"filename":"数据表.xlsx","file_data":"data:application/vnd;base64,AAAA` +
		"…(truncated)"
	got := parseRequestBody(body, testHosts)
	if got.Prompt != "分析这份文件" {
		t.Errorf("prompt: %q", got.Prompt)
	}
	found := false
	for _, a := range got.Inputs {
		if a.Kind == "file" && a.Name == "数据表.xlsx" {
			found = true
		}
	}
	if !found {
		t.Errorf("truncated file attachment must survive: %+v", got.Inputs)
	}
}

// 文本场景的响应是裸文本回复,不是 JSON。
func TestParseResponsePlainReply(t *testing.T) {
	got := parseResponseBody("chat", "这是助手的回复内容。", testHosts)
	if got.Reply != "这是助手的回复内容。" {
		t.Errorf("reply: %q", got.Reply)
	}
	if len(got.Results) != 0 {
		t.Errorf("results should be empty: %+v", got.Results)
	}
}

// OpenAI 形态响应:choices[0].message.content → Reply。
func TestParseResponseChoicesReply(t *testing.T) {
	body := `{"choices":[{"message":{"role":"assistant","content":"优化后的提示词"}}],"usage":{}}`
	got := parseResponseBody("optimize", body, testHosts)
	if got.Reply != "优化后的提示词" {
		t.Errorf("reply: %q", got.Reply)
	}
}

// 生成类响应:任意嵌套里的媒体 URL → Results。
func TestParseResponseMediaURL(t *testing.T) {
	body := `{"data":[{"url":"https://cdn.example.com/canvas/uploads/out.mp4","b64":null}]}`
	got := parseResponseBody("video", body, testHosts)
	if len(got.Results) != 1 || got.Results[0].Kind != "video" {
		t.Errorf("results: %+v", got.Results)
	}
}

// 生成类响应截断行:正则兜底媒体 URL。
func TestParseResponseTruncatedMedia(t *testing.T) {
	body := `{"data":[{"url":"https://cdn.example.com/canvas/uploads/out.png","revised_prompt":"很长的描…(truncated)`
	got := parseResponseBody("image", body, testHosts)
	if len(got.Results) != 1 || !strings.HasSuffix(got.Results[0].URL, "out.png") {
		t.Errorf("results: %+v", got.Results)
	}
}
