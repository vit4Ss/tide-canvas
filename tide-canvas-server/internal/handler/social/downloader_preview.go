package social

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/token"
	"tidecanvas/internal/pkg/videodownload"
)

type videoPreviewer interface {
	preview(context.Context, string, string, string) (*http.Response, error)
}

func videoPreviewResource(platform, source string) string {
	return "social-video-preview:" + platform + ":" + source
}

func issueVideoPreviewURL(uid idgen.ID, role int, platform, source string, ttl time.Duration) (string, error) {
	ticket, err := token.IssueDownloadTicket(uid, role, videoPreviewResource(platform, source), "preview.mp4", ttl)
	if err != nil {
		return "", err
	}
	target := "/api/social-analysis/downloader/preview?" + url.Values{"ticket": {ticket}, "platform": {platform}, "url": {source}}.Encode()
	if len(target) > 7500 {
		return "", nil
	}
	return target, nil
}

func (h *handler) previewVideo(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	source, platform, ticket := c.Query("url"), c.Query("platform"), c.Query("ticket")
	if len(source) > 8192 || len(platform) > 32 || len(ticket) > 4096 || ticket == "" {
		c.AbortWithStatus(401)
		return
	}
	if _, err := token.ParseDownloadTicket(ticket, videoPreviewResource(platform, source), "preview.mp4"); err != nil {
		c.AbortWithStatus(401)
		return
	}
	controller := http.NewResponseController(c.Writer)
	_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Minute))
	defer controller.SetWriteDeadline(time.Time{})
	previewer, ok := h.downloader.(videoPreviewer)
	if !ok {
		c.AbortWithStatus(503)
		return
	}
	resp, err := previewer.preview(c.Request.Context(), platform, source, c.GetHeader("Range"))
	if err != nil {
		status := http.StatusBadGateway
		var problem *videodownload.Error
		if errors.As(err, &problem) {
			status = problem.Status
		}
		c.AbortWithStatus(status)
		return
	}
	defer resp.Body.Close()
	// Only relay media headers, never cookies or upstream authentication fields.
	for _, name := range []string{"Content-Type", "Content-Range", "Accept-Ranges"} {
		if value := resp.Header.Get(name); value != "" {
			c.Header(name, value)
		}
	}
	if resp.ContentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	c.Header("Content-Disposition", `inline; filename="preview.mp4"`)
	c.Status(resp.StatusCode)
	_, _ = io.Copy(c.Writer, resp.Body)
}
