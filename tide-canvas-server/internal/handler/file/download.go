package file

import (
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
)

// filenameSanitizer strips characters that would break a Content-Disposition header.
var filenameSanitizer = strings.NewReplacer("\"", "", "\\", "", "\r", "", "\n", "", "/", "_")

// downloadFilename derives the attachment filename: append the URL path's
// extension unless the name already ends with it. 判定不能用「名字里有没有点」：
// 模型名普遍带版本点号（qwen-image-3.0-pro / Hunyuan 3D 3.1），旧判定会吞掉
// 扩展名，存下来的文件（尤其 .glb）本地打不开。
func downloadFilename(name, urlPath string) string {
	if name == "" {
		name = "download"
	}
	if ext := path.Ext(urlPath); ext != "" && !strings.EqualFold(path.Ext(name), ext) {
		name += ext
	}
	return name
}

// download GET /api/files/download?url=...&name=...
//
// Server-side fetch-and-stream proxy: the browser hits this to download a
// (possibly cross-origin) asset — e.g. an AI result or a panorama texture — as
// an attachment, without tripping CORS. Used across the canvas nodes
// (image/video/panorama/scene-3d) and lib/image-slice.ts.
//
// The route is authenticated and accepts only a URL already owned by the
// caller (File, AiTask result or SkillRun artifact), an authorized administrator,
// or a published community/blog entry. The shared remote client validates
// redirects and every dialed IP, blocking private-network SSRF.
func (h *handler) download(c *gin.Context) {
	raw := strings.TrimSpace(c.Query("url"))
	if raw == "" {
		response.Fail(c, response.CodeBadRequest, "missing url")
		return
	}
	u, err := url.ParseRequestURI(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		response.Fail(c, response.CodeBadRequest, "invalid url")
		return
	}
	owned, err := h.svc.ownsDownloadURL(c.Request.Context(), middleware.CurrentUserID(c), raw)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to verify remote file")
		return
	}
	if !owned {
		response.Fail(c, response.CodeForbidden, "not allowed to download this url")
		return
	}
	localOwned := false
	if h.svc.store != nil && h.svc.store.Type() == "local" {
		_, localOwned = h.svc.store.OwnsURL(raw)
	}
	if !localOwned {
		if _, err := validateRemoteAssetURL(raw); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid url")
			return
		}
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, raw, nil)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid url")
		return
	}
	client := h.svc.httpcli
	if localOwned {
		// Local development stores are commonly served from 127.0.0.1:8080.
		// This exception is safe only after the exact URL ownership check above,
		// and redirects are refused so it cannot escape the static namespace.
		client = &http.Client{
			Timeout: saveFromURLTimeout,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to fetch remote file")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		response.Fail(c, response.CodeServerError, "remote returned status "+strconv.Itoa(resp.StatusCode))
		return
	}
	if resp.ContentLength > maxFileSize {
		response.Fail(c, response.CodeBadRequest, "remote file exceeds size limit")
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	name := downloadFilename(c.Query("name"), u.Path)

	c.Header("Content-Type", ct)
	c.Header("Content-Disposition", "attachment; filename=\""+filenameSanitizer.Replace(name)+"\"")
	if cl := resp.Header.Get("Content-Length"); cl != "" && resp.ContentLength >= 0 {
		c.Header("Content-Length", cl)
	}
	c.Status(http.StatusOK)
	// Unknown/chunked bodies are still hard-capped; a dishonest origin cannot
	// turn this endpoint into an unbounded bandwidth relay.
	_, _ = io.Copy(c.Writer, io.LimitReader(resp.Body, maxFileSize+1))
}
