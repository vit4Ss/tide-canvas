package social

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/token"
)

type stubPreviewDownloader struct {
	stubVideoDownloader
	calls int
}

func (s *stubPreviewDownloader) preview(_ context.Context, platform, source, byteRange string) (*http.Response, error) {
	s.calls++
	resp := videoResponse("video-range")
	resp.StatusCode = 206
	resp.Header.Set("Content-Range", "bytes 0-10/100")
	resp.Header.Set("Set-Cookie", "must-not-forward=1")
	return resp, nil
}

func TestPreviewTicketBoundToMediaAndSeparateFromDownload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token.Init(config.JWTConfig{Secret: "preview-test", Issuer: "test"}, nil)
	d := &stubPreviewDownloader{}
	d.onDownload = func(context.Context, string, string) (*http.Response, error) {
		t.Fatal("preview triggered attachment download")
		return nil, nil
	}
	h := &handler{downloader: d} // No database: preview must not create history.
	r := gin.New()
	r.GET("/api/social-analysis/downloader/preview", h.previewVideo)
	target, err := issueVideoPreviewURL(123, 1, "douyin", "https://v.douyinvod.com/a.mp4", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	request := func(raw string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", raw, nil)
		req.Header.Set("Range", "bytes=0-10")
		r.ServeHTTP(w, req)
		return w
	}
	w := request(target)
	if w.Code != 206 || w.Body.String() != "video-range" || w.Header().Get("Content-Range") != "bytes 0-10/100" || w.Header().Get("Set-Cookie") != "" || w.Header().Get("Content-Disposition") != `inline; filename="preview.mp4"` {
		t.Fatalf("bad preview response: %d %v", w.Code, w.Header())
	}
	for key, value := range map[string]string{"url": "https://v.douyinvod.com/other.mp4", "platform": "youtube", "ticket": "invalid"} {
		u, _ := url.Parse(target)
		q := u.Query()
		q.Set(key, value)
		u.RawQuery = q.Encode()
		if w := request(u.String()); w.Code != 401 {
			t.Fatalf("tampered %s accepted", key)
		}
	}
	expired, _ := url.Parse(target)
	query := expired.Query()
	claims := &token.DownloadClaims{}
	if _, _, err := jwt.NewParser().ParseUnverified(query.Get("ticket"), claims); err != nil {
		t.Fatal(err)
	}
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
	expiredTicket, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("preview-test"))
	if err != nil {
		t.Fatal(err)
	}
	query.Set("ticket", expiredTicket)
	expired.RawQuery = query.Encode()
	if w := request(expired.String()); w.Code != 401 {
		t.Fatal("expired preview accepted")
	}
	if d.calls != 1 {
		t.Fatal("unauthorized preview reached upstream")
	}
}
