package chat

// 文档附件转发：把随消息上传的文档（kind=="file"）读成 base64 data URI，
// 以 relay /v1/chat/completions 的 "file" content part 原样转发给上游模型
// （PDF/docx/xlsx 等都由上游模型自行理解，服务端不做本地解析）。
//
// 约束：
//   - 只抓本站存储的 URL（storage.publicURL 同 host 或 *.aliyuncs.com）——
//     attachments 是客户端提交的任意字符串，放开抓取就是 SSRF。
//   - base64 会膨胀 4/3，单文件原始体积限 15MB、多文件合计限 20MB，超限的
//     文件不转发、注入一条文字说明让模型得体回应。
//   - 读取失败（下载错误/不在白名单）同样注入说明，不静默丢弃。

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
	docFetchTimeout   = 20 * time.Second
	docFilePerBytes   = 15 << 20 // 单文件原始体积上限
	docFileTotalBytes = 20 << 20 // 多文件合计上限
)

var docHTTPClient = &http.Client{Timeout: docFetchTimeout}

// docFileParts 把文档附件转成 relay file part 列表；同时汇总一段附件说明
// （note）拼进当前轮 user 消息：
//   - 成功转发的文件列出文件名——若上游解析不了该格式（如老版二进制 .xls
//     曾出现空回复），模型至少知道文件确实送到了，能如实说明而不是「没收到」；
//   - 视频/音频附件不进模型（文本模型无法观看/收听），显式告知模型，
//     避免它误答「请上传文件」；
//   - 读取失败/超限的文件同样注明原因。
func (s *service) docFileParts(ctx context.Context, atts []MessageAttach) (files []relaychat.FileAttachment, note string) {
	var forwarded, notes []string
	total := 0
	for _, a := range atts {
		kind := strings.TrimSpace(a.Kind)
		u := strings.TrimSpace(a.URL)
		name := docFileName(u)
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
		if !s.docHostAllowed(u) {
			notes = append(notes, fmt.Sprintf("「%s」不在本站存储，未能读取", name))
			continue
		}
		data, err := docFetch(ctx, u)
		if err != nil {
			notes = append(notes, fmt.Sprintf("「%s」读取失败，未能附上内容", name))
			continue
		}
		if total+len(data) > docFileTotalBytes {
			notes = append(notes, fmt.Sprintf("「%s」因附件合计体积超限未附上", name))
			continue
		}
		total += len(data)
		forwarded = append(forwarded, name)
		files = append(files, relaychat.FileAttachment{
			Filename: name,
			DataURI:  "data:" + docMime(name) + ";base64," + base64.StdEncoding.EncodeToString(data),
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

// docHostAllowed 限定服务端抓取范围：本站存储 host（启动时的 storage.publicURL）
// 或阿里云 OSS 域名。publicURL 运行期可在后台改，改后需重启才对文档转发生效。
func (s *service) docHostAllowed(raw string) bool {
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
	return s.docSelfHost != "" && strings.EqualFold(u.Host, s.docSelfHost)
}

func docFileName(raw string) string {
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

// docMimeByExt 是常见文档格式的显式 MIME 表。不能只依赖 mime.TypeByExtension：
// 它的内置表不含 .xls/.doc/.ppt 等 Office 扩展名（依赖操作系统 MIME 注册，
// 容器里常缺失），落到 application/octet-stream 后上游模型将无法识别文件类型
// 而拒绝解析——同一个 .xls 用 vnd.ms-excel 直发上游可成功、octet-stream 失败。
var docMimeByExt = map[string]string{
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

func docMime(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if ct, ok := docMimeByExt[ext]; ok {
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

func docFetch(ctx context.Context, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := docHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("docextract: status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, docFilePerBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > docFilePerBytes {
		return nil, fmt.Errorf("docextract: file too large")
	}
	return data, nil
}
