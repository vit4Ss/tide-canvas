package file

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/storage"
	"tidecanvas/internal/pkg/token"
)

// filenameSanitizer strips characters that would break a Content-Disposition header.
var filenameSanitizer = strings.NewReplacer("\"", "", "\\", "", "\r", "", "\n", "", "/", "_")

// Generated 3D worlds can be substantially larger than the 100 MiB upload
// limit. Downloads stream without buffering, so allow the same 2 GiB ceiling
// used by generation-result archival while retaining a hard abuse cap.
const maxDownloadSize int64 = 2 << 30

const downloadTicketTTL = 2 * time.Minute

const (
	maxDownloadURLLength  = 8 << 10
	maxDownloadNameLength = 240
)

type downloadTicketDTO struct {
	URL  string `json:"url" binding:"required"`
	Name string `json:"name"`
}

// issueDownloadTicket verifies ownership under the caller's Bearer token, then
// returns a short-lived URL that the browser can navigate to natively. The
// ticket is cryptographically bound to the exact URL/name pair; download()
// rechecks ownership again when it is consumed.
func (h *handler) issueDownloadTicket(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	var dto downloadTicketDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request body")
		return
	}
	raw := strings.TrimSpace(dto.URL)
	name := strings.TrimSpace(dto.Name)
	if len(raw) > maxDownloadURLLength || len([]rune(name)) > maxDownloadNameLength {
		response.Fail(c, response.CodeBadRequest, "download url or name is too long")
		return
	}
	u, err := url.ParseRequestURI(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		response.Fail(c, response.CodeBadRequest, "invalid url")
		return
	}
	uid := middleware.CurrentUserID(c)
	owned, err := h.svc.ownsDownloadURL(c.Request.Context(), uid, raw)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to verify remote file")
		return
	}
	if !owned {
		response.Fail(c, response.CodeForbidden, "not allowed to download this url")
		return
	}
	nativeDownload := false
	// Native browser downloads cannot report a later streaming error back to
	// the page. For first-party objects, verify existence and size before issuing
	// the ticket so a broken URL cannot navigate the current page to an error
	// response instead of starting the download. External legacy URLs continue
	// through the remote fetcher's validation in download().
	if statter, ok := h.svc.store.(storage.OwnedURLStatter); ok {
		meta, statErr := statter.StatURL(c.Request.Context(), raw)
		switch {
		case errors.Is(statErr, storage.ErrUnsupported):
			// Not a first-party URL; download() performs the guarded remote fetch.
		case statErr != nil:
			response.Fail(c, response.CodeNotFound, "download file is unavailable")
			return
		case meta.Size > maxDownloadSize:
			response.Fail(c, response.CodeBadRequest, "remote file exceeds size limit")
			return
		default:
			nativeDownload = true
		}
	}
	ticket, err := token.IssueDownloadTicket(uid, middleware.CurrentRole(c), raw, name, downloadTicketTTL)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to issue download ticket")
		return
	}
	query := url.Values{}
	query.Set("url", raw)
	query.Set("name", name)
	query.Set("ticket", ticket)
	response.OK(c, gin.H{
		"url":    "/api/files/download?" + query.Encode(),
		"native": nativeDownload,
	})
}

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

// openOwnedStorageURL reads a first-party storage URL without routing it back
// through the public CDN. Besides avoiding an unnecessary network hop, this is
// required on developer machines whose proxy/VPN maps public hostnames into a
// synthetic address range (for example 198.18.0.0/15): the remote downloader
// must continue rejecting those addresses for SSRF safety, while the storage
// SDK can still read an object that belongs to this service.
//
// handled is false only when the configured storage does not recognize raw.
// A recognized URL whose object cannot be read is handled with an error so it
// cannot silently fall back to the less trusted public downloader.
func openOwnedStorageURL(ctx context.Context, candidate any, raw string) (body io.ReadCloser, handled bool, err error) {
	reader, ok := candidate.(storage.OwnedURLReader)
	if !ok {
		return nil, false, nil
	}
	body, err = reader.OpenURL(ctx, raw)
	if errors.Is(err, storage.ErrUnsupported) {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, err
	}
	return body, true, nil
}

func contentTypeForDownload(urlPath string) string {
	if contentType := mime.TypeByExtension(path.Ext(urlPath)); contentType != "" {
		return contentType
	}
	return "application/octet-stream"
}

func streamDownload(c *gin.Context, body io.Reader, contentType, name string, contentLength int64) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Type", contentType)
	safeName := filenameSanitizer.Replace(name)
	if safeName == "" {
		safeName = "download"
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": safeName})
	if disposition == "" {
		disposition = "attachment"
	}
	c.Header("Content-Disposition", disposition)
	if contentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(contentLength, 10))
	}
	c.Status(http.StatusOK)
	// Unknown/chunked bodies are still hard-capped; a dishonest origin cannot
	// turn this endpoint into an unbounded bandwidth relay.
	_, _ = io.Copy(c.Writer, io.LimitReader(body, maxDownloadSize+1))
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
	name := downloadFilename(c.Query("name"), u.Path)
	if body, handled, err := openOwnedStorageURL(c.Request.Context(), h.svc.store, raw); handled {
		if err != nil {
			response.Fail(c, response.CodeServerError, "failed to read stored file")
			return
		}
		defer body.Close()
		streamDownload(c, body, contentTypeForDownload(u.Path), name, -1)
		return
	}

	if _, err := validateRemoteAssetURL(raw); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid url")
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, raw, nil)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid url")
		return
	}
	resp, err := h.svc.httpcli.Do(req)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to fetch remote file")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		response.Fail(c, response.CodeServerError, "remote returned status "+strconv.Itoa(resp.StatusCode))
		return
	}
	if resp.ContentLength > maxDownloadSize {
		response.Fail(c, response.CodeBadRequest, "remote file exceeds size limit")
		return
	}

	streamDownload(c, resp.Body, resp.Header.Get("Content-Type"), name, resp.ContentLength)
}
