package file

import (
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/response"
)

// downloadClient fetches remote assets for the server-side download proxy.
var downloadClient = &http.Client{Timeout: 60 * time.Second}

// filenameSanitizer strips characters that would break a Content-Disposition header.
var filenameSanitizer = strings.NewReplacer("\"", "", "\\", "", "\r", "", "\n", "", "/", "_")

// download GET /api/files/download?url=...&name=...
//
// Server-side fetch-and-stream proxy: the browser hits this to download a
// (possibly cross-origin) asset — e.g. an AI result or a panorama texture — as
// an attachment, without tripping CORS. Used across the canvas nodes
// (image/video/panorama/scene-3d) and lib/image-slice.ts.
//
// Public on purpose: the canvas runs without login. NOTE: this is an outbound
// fetch of a client-supplied URL (SSRF surface) — restrict to allowed hosts /
// require auth before shipping to production.
func (h *handler) download(c *gin.Context) {
	raw := c.Query("url")
	if raw == "" {
		response.Fail(c, response.CodeBadRequest, "missing url")
		return
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		response.Fail(c, response.CodeBadRequest, "invalid url")
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, raw, nil)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid url")
		return
	}
	resp, err := downloadClient.Do(req)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to fetch remote file")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		response.Fail(c, response.CodeServerError, "remote returned status "+strconv.Itoa(resp.StatusCode))
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	name := c.Query("name")
	if name == "" {
		name = "download"
	}
	if !strings.Contains(name, ".") {
		if ext := path.Ext(u.Path); ext != "" {
			name += ext
		}
	}

	c.Header("Content-Type", ct)
	c.Header("Content-Disposition", "attachment; filename=\""+filenameSanitizer.Replace(name)+"\"")
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		c.Header("Content-Length", cl)
	}
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, resp.Body)
}
