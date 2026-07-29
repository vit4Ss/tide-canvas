// Package chatattach 把「随消息上传的附件」转成 relay /v1/chat/completions 的
// content part：图片走 image_url，文档读成 base64 data URI 走 file part
// （PDF/docx/xlsx 等都由上游模型自行理解，服务端不做本地解析）。
//
// 由生成页对话（handler/chat）与画布 AI 助手（handler/ai 的 assistant_chat）
// 共用——两边必须是同一份 SSRF 白名单与同一套体积上限，分头抄一份的话，
// 白名单改一处漏一处就是漏洞。
//
// 约束：
//   - 只抓本站存储的 URL（storage.publicURL 同 host 或 *.aliyuncs.com）——
//     附件是客户端提交的任意字符串，放开抓取就是 SSRF。
//   - base64 会膨胀 4/3，单文件原始体积限 15MB、多文件合计限 20MB，超限的
//     文件不转发、注入一条文字说明让模型得体回应。
//   - 读取失败（下载错误/不在白名单）同样注入说明，不静默丢弃。
package chatattach

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"tidecanvas/internal/pkg/relaychat"
)

const (
	fetchTimeout   = 20 * time.Second
	filePerBytes   = 15 << 20 // 单文件原始体积上限
	fileTotalBytes = 20 << 20 // 多文件合计上限
)

var httpClient = &http.Client{Timeout: fetchTimeout}

// Attach 是一条待转发的附件。Kind 为 image | video | audio | file，空视为 image。
// URL 不约束成严格的 URL 形态：存储可能返回绝对 OSS URL 或 publicURL 相对路径，
// 畸形项只是不下发给模型，而不是让整条消息失败。
type Attach struct {
	URL  string
	Kind string
}

// ImageURLs 挑出可直接给模型的图片 URL。只有绝对 URL（或 data:）能被上游取到，
// 相对路径跳过。
func ImageURLs(atts []Attach) []string {
	urls := make([]string, 0, len(atts))
	for _, a := range atts {
		kind := strings.TrimSpace(a.Kind)
		u := strings.TrimSpace(a.URL)
		if (kind == "" || kind == "image") &&
			(strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "data:")) {
			urls = append(urls, u)
		}
	}
	return urls
}

// Extractor 持有抓取白名单所需的配置。SelfHost 是启动时 storage.publicURL 的
// host；运行期在后台改了 publicURL 需重启才对文档转发生效。
type Extractor struct {
	SelfHost string
}

// FileParts 把文档附件转成 relay file part 列表；同时汇总一段附件说明（note）
// 供调用方拼进当前轮 user 消息：
//   - 成功转发的文件列出文件名——若上游解析不了该格式（如老版二进制 .xls
//     曾出现空回复），模型至少知道文件确实送到了，能如实说明而不是「没收到」；
//   - 视频/音频附件不进模型（文本模型无法观看/收听），显式告知模型，
//     避免它误答「请上传文件」；
//   - 读取失败/超限的文件同样注明原因。
func (e Extractor) FileParts(ctx context.Context, atts []Attach) (files []relaychat.FileAttachment, note string) {
	var forwarded, notes []string
	total := 0
	for _, a := range atts {
		kind := strings.TrimSpace(a.Kind)
		u := strings.TrimSpace(a.URL)
		name := FileName(u)
		switch kind {
		case "video":
			notes = append(notes, fmt.Sprintf("用户还上传了视频「%s」，当前文本对话无法观看视频内容，请如实告知", name))
			continue
		case "audio":
			notes = append(notes, fmt.Sprintf("用户还上传了音频「%s」，当前文本对话无法收听音频内容，请如实告知", name))
			continue
		case "file":
			// 下面处理
		default:
			continue // image 走多模态；空 kind 视为图片
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			continue
		}
		if !e.hostAllowed(u) {
			notes = append(notes, fmt.Sprintf("「%s」不在本站存储，未能读取", name))
			continue
		}
		data, err := fetch(ctx, u)
		if err != nil {
			notes = append(notes, fmt.Sprintf("「%s」读取失败，未能附上内容", name))
			continue
		}
		if total+len(data) > fileTotalBytes {
			notes = append(notes, fmt.Sprintf("「%s」因附件合计体积超限未附上", name))
			continue
		}
		total += len(data)
		forwarded = append(forwarded, name)
		files = append(files, relaychat.FileAttachment{
			Filename: name,
			DataURI:  "data:" + mimeOf(name) + ";base64," + base64.StdEncoding.EncodeToString(data),
		})
	}
	var parts []string
	if len(forwarded) > 0 {
		parts = append(parts, "本条消息附带文件："+strings.Join(forwarded, "、")+"，内容已作为附件一并提供，请直接读取分析；若某个文件无法解析，请明确说明原因")
	}
	parts = append(parts, notes...)
	if len(parts) > 0 {
		note = "（" + strings.Join(parts, "；") + "）"
	}
	return files, note
}

// hostAllowed 限定服务端抓取范围：本站存储 host 或阿里云 OSS 域名。
func (e Extractor) hostAllowed(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return false
	}
	if strings.HasSuffix(host, ".aliyuncs.com") {
		return true
	}
	return e.SelfHost != "" && strings.EqualFold(u.Host, e.SelfHost)
}

// FileName 从 URL 取出展示用文件名（取不到时回退「附件」）。
func FileName(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "附件"
	}
	base := path.Base(u.Path)
	if unescaped, e := url.PathUnescape(base); e == nil && unescaped != "" {
		base = unescaped
	}
	if base == "" || base == "." || base == "/" {
		return "附件"
	}
	return base
}

// mimeByExt 是常见文档格式的显式 MIME 表。不能只依赖 mime.TypeByExtension：
// 它的内置表不含 .xls/.doc/.ppt 等 Office 扩展名（依赖操作系统 MIME 注册，
// 容器里常缺失），落到 application/octet-stream 后上游模型将无法识别文件类型
// 而拒绝解析——同一个 .xls 用 vnd.ms-excel 直发上游可成功、octet-stream 失败。
var mimeByExt = map[string]string{
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".pdf":  "application/pdf",
	".csv":  "text/csv",
	".tsv":  "text/tab-separated-values",
	".txt":  "text/plain",
	".md":   "text/markdown",
	".json": "application/json",
	".xml":  "application/xml",
	".html": "text/html",
	".htm":  "text/html",
	".rtf":  "application/rtf",
	".zip":  "application/zip",
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".m4a":  "audio/mp4",
	".mp4":  "video/mp4",
	".mov":  "video/quicktime",
	".webm": "video/webm",
}

func mimeOf(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if ct, ok := mimeByExt[ext]; ok {
		return ct
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		// data URI 里不带 "; charset=" 后缀
		if i := strings.IndexByte(ct, ';'); i > 0 {
			return strings.TrimSpace(ct[:i])
		}
		return ct
	}
	return "application/octet-stream"
}

func fetch(ctx context.Context, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("chatattach: status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, filePerBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > filePerBytes {
		return nil, fmt.Errorf("chatattach: file too large")
	}
	return data, nil
}
