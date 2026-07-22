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

// docFileParts 把文档附件转成 relay file part 列表；无法转发的文件汇总成一段
// 文字说明（note），由调用方拼进当前轮 user 消息。
func (s *service) docFileParts(ctx context.Context, atts []MessageAttach) (files []relaychat.FileAttachment, note string) {
	var notes []string
	total := 0
	for _, a := range atts {
		if strings.TrimSpace(a.Kind) != "file" {
			continue
		}
		u := strings.TrimSpace(a.URL)
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			continue
		}
		name := docFileName(u)
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
		files = append(files, relaychat.FileAttachment{
			Filename: name,
			DataURI:  "data:" + docMime(name) + ";base64," + base64.StdEncoding.EncodeToString(data),
		})
	}
	if len(notes) > 0 {
		note = "（说明：" + strings.Join(notes, "；") + "）"
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

func docMime(name string) string {
	if ct := mime.TypeByExtension(strings.ToLower(path.Ext(name))); ct != "" {
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
