package chatattach

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestImageURLs(t *testing.T) {
	got := ImageURLs([]Attach{
		{URL: "https://cdn.example.com/a.png", Kind: "image"},
		{URL: "https://cdn.example.com/b.png", Kind: ""}, // 空 kind 视为图片
		{URL: "data:image/png;base64,AAA", Kind: "image"},
		{URL: "/uploads/rel.png", Kind: "image"}, // 相对路径上游取不到
		{URL: "https://cdn.example.com/c.mp4", Kind: "video"},
		{URL: "https://cdn.example.com/d.pdf", Kind: "file"},
	})
	want := []string{
		"https://cdn.example.com/a.png",
		"https://cdn.example.com/b.png",
		"data:image/png;base64,AAA",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] got %q, want %q", i, got[i], want[i])
		}
	}
}

// SSRF 白名单：只放行本站存储 host 与 *.aliyuncs.com。
// 附件 URL 是客户端提交的任意字符串，这条守住内网探测。
func TestHostAllowed(t *testing.T) {
	e := Extractor{Hosts: []string{"cdn.example.com"}}
	cases := []struct {
		raw  string
		want bool
	}{
		{"https://cdn.example.com/a.pdf", true},
		{"https://CDN.EXAMPLE.COM/a.pdf", true}, // host 比较大小写不敏感
		{"https://bucket.oss-cn-hangzhou.aliyuncs.com/a.pdf", false},
		{"http://169.254.169.254/latest/meta-data/", false}, // 云元数据
		{"http://localhost:8080/admin", false},
		{"http://127.0.0.1/", false},
		{"https://evil.com/a.pdf", false},
		{"https://cdn.example.com.evil.com/a.pdf", false}, // 后缀伪装
		{"https://notaliyuncs.com/a.pdf", false},
		{"::::not a url", false},
	}
	for _, c := range cases {
		if got := e.hostAllowed(c.raw); got != c.want {
			t.Errorf("%s: got %v, want %v", c.raw, got, c.want)
		}
	}
}

// Hosts 未配置时不得放行任意 host（只剩 aliyuncs 白名单）。
func TestHostAllowedEmptyHosts(t *testing.T) {
	e := Extractor{}
	if e.hostAllowed("https://cdn.example.com/a.pdf") {
		t.Error("empty Hosts must not allow arbitrary hosts")
	}
	if e.hostAllowed("https://b.aliyuncs.com/a.pdf") {
		t.Error("an arbitrary aliyuncs bucket must not be allowed")
	}
}

func TestFileName(t *testing.T) {
	cases := map[string]string{
		"https://cdn.example.com/dir/report.pdf": "report.pdf",
		"https://cdn.example.com/%E6%8A%A5.pdf":  "报.pdf", // 百分号编码还原
		"https://cdn.example.com/":               "附件",
		"https://cdn.example.com":                "附件",
	}
	for raw, want := range cases {
		if got := FileName(raw); got != want {
			t.Errorf("%s: got %q, want %q", raw, got, want)
		}
	}
}

// Office 扩展名必须走显式表：容器里 mime.TypeByExtension 常缺 .xls/.doc，
// 落到 octet-stream 后上游模型会拒绝解析。
func TestMimeOf(t *testing.T) {
	cases := map[string]string{
		"a.xls":     "application/vnd.ms-excel",
		"a.docx":    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"a.pdf":     "application/pdf",
		"a.unknown": "application/octet-stream",
	}
	for name, want := range cases {
		if got := mimeOf(name); got != want {
			t.Errorf("%s: got %q, want %q", name, got, want)
		}
	}
	// 有 charset 的类型要剥掉后缀——data URI 里不能带 "; charset="
	if got := mimeOf("a.txt"); strings.Contains(got, ";") {
		t.Errorf("mime must not carry charset: %q", got)
	}
}

// 视频/音频不进模型，但要留下说明，避免模型误答「请上传文件」。
func TestFilePartsNotesMediaWithoutFetching(t *testing.T) {
	e := Extractor{Hosts: []string{"cdn.example.com"}}
	files, note := e.FileParts(context.Background(), []Attach{
		{URL: "https://cdn.example.com/clip.mp4", Kind: "video"},
		{URL: "https://cdn.example.com/song.mp3", Kind: "audio"},
		{URL: "https://cdn.example.com/pic.png", Kind: "image"}, // 图片走多模态，不在此处
	})
	if len(files) != 0 {
		t.Errorf("media must not be fetched as file parts: %+v", files)
	}
	if !strings.Contains(note, "clip.mp4") || !strings.Contains(note, "无法观看") {
		t.Errorf("video note missing: %q", note)
	}
	if !strings.Contains(note, "song.mp3") || !strings.Contains(note, "无法收听") {
		t.Errorf("audio note missing: %q", note)
	}
}

// 白名单外的文档不抓取，但要注明原因，不静默丢弃。
func TestFilePartsRejectsForeignHost(t *testing.T) {
	e := Extractor{Hosts: []string{"cdn.example.com"}}
	files, note := e.FileParts(context.Background(), []Attach{
		{URL: "https://evil.com/secret.pdf", Kind: "file"},
	})
	if len(files) != 0 {
		t.Fatalf("must not fetch off-allowlist host: %+v", files)
	}
	if !strings.Contains(note, "不在本站存储") {
		t.Errorf("note should explain the skip: %q", note)
	}
}

// 白名单内的文档抓下来转成 base64 data URI 并带上说明。
func TestFilePartsForwardsAllowedDoc(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("hello-doc"))
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)

	e := Extractor{Hosts: []string{u.Host}, httpClient: srv.Client()}
	files, note := e.FileParts(context.Background(), []Attach{
		{URL: srv.URL + "/report.pdf", Kind: "file"},
	})
	if len(files) != 1 {
		t.Fatalf("want 1 forwarded file, got %d (note=%q)", len(files), note)
	}
	if files[0].Filename != "report.pdf" {
		t.Errorf("filename: %q", files[0].Filename)
	}
	// "hello-doc" base64 => aGVsbG8tZG9j
	if !strings.HasPrefix(files[0].DataURI, "data:application/pdf;base64,") ||
		!strings.HasSuffix(files[0].DataURI, "aGVsbG8tZG9j") {
		t.Errorf("data uri malformed: %q", files[0].DataURI)
	}
	if !strings.Contains(note, "report.pdf") {
		t.Errorf("note should list the forwarded file: %q", note)
	}
}

// 无附件时 note 为空——不能凭空往用户正文里拼一段括号说明。
func TestFilePartsEmpty(t *testing.T) {
	files, note := Extractor{Hosts: []string{"cdn.example.com"}}.FileParts(context.Background(), nil)
	if len(files) != 0 || note != "" {
		t.Errorf("want empty, got files=%+v note=%q", files, note)
	}
}
