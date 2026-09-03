package social

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"
)

func TestRelayDownloaderPlatformsAreNormalizedAndCached(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1/tools/video-downloader/platforms" || r.Header.Get("Authorization") != "Bearer relay-key" {
			t.Errorf("unexpected request: %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true,"platforms":["YouTube","youtube"," bilibili ",""],"max_file_bytes":536870912,"token_ttl_seconds":600}`))
	}))
	defer server.Close()
	client := newRelayVideoDownloader(server.URL, "relay-key")
	first, err := client.platforms(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := client.platforms(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !first.Enabled || first.MaxFileBytes != 536870912 || first.TokenTTLSeconds != int(videoDownloadTicketMax/time.Second) || strings.Join(first.Platforms, ",") != "youtube,bilibili" {
		t.Fatalf("unexpected capabilities: %+v", first)
	}
	if strings.Join(second.Platforms, ",") != "youtube,bilibili" || calls.Load() != 1 {
		t.Fatalf("capability cache failed: second=%+v calls=%d", second, calls.Load())
	}
}

func TestRelayDownloaderResolveUsesDocumentedContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/tools/video-downloader/resolve" || r.Method != http.MethodPost {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer relay-key" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["url"] != "https://www.bilibili.com/video/BV1xx" || body["quality"] != "compat" {
			t.Errorf("resolve body = %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"temporary-token","platform":"bilibili","title":"Public video","duration_seconds":42,"width":1920,"height":1080,"estimated_bytes":18874368,"quality":"compat","expires_at":` + strconv.FormatInt(time.Now().Add(10*time.Minute).Unix(), 10) + `}`))
	}))
	defer server.Close()
	client := newRelayVideoDownloader(server.URL, "relay-key")
	resolved, err := client.resolve(context.Background(), "https://www.bilibili.com/video/BV1xx", "compat")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ID != "temporary-token" || resolved.Platform != "bilibili" || resolved.Width != 1920 || resolved.EstimatedBytes != 18874368 {
		t.Fatalf("unexpected resolved video: %+v", resolved)
	}
}

func TestVideoDownloadHTTPFlowIssuesBoundTicketAndStreamsAttachment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token.Init(config.JWTConfig{Secret: "video-download-test-secret", Issuer: "video-download-test"}, nil)
	var downloadCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer relay-key" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		switch {
		case r.URL.Path == "/v1/tools/video-downloader/platforms":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"enabled":true,"platforms":["youtube"],"max_file_bytes":536870912,"token_ttl_seconds":600}`))
		case r.URL.Path == "/v1/tools/video-downloader/resolve":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"temporary-token","platform":"youtube","title":"测试 / 视频","duration_seconds":42,"width":1280,"height":720,"estimated_bytes":11,"quality":"compat","expires_at":` + strconv.FormatInt(time.Now().Add(10*time.Minute).Unix(), 10) + `}`))
		case r.URL.Path == "/v1/tools/video-downloader/download/temporary-token":
			downloadCalls.Add(1)
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Length", "11")
			_, _ = w.Write([]byte("video-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	h := &handler{downloader: newRelayVideoDownloader(upstream.URL, "relay-key")}
	router := gin.New()
	router.POST("/resolve", func(c *gin.Context) {
		c.Set(middleware.CtxUserID, idgen.ID(901))
		c.Set(middleware.CtxRole, 0)
		c.Next()
	}, h.resolveVideoDownload)
	router.GET("/download/:token", videoDownloadTicketAuth(), h.downloadVideo)

	resolveRecorder := httptest.NewRecorder()
	resolveRequest := httptest.NewRequest(http.MethodPost, "/resolve", bytes.NewReader([]byte(`{"url":"https://www.youtube.com/watch?v=abc12345678","quality":"compat"}`)))
	resolveRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(resolveRecorder, resolveRequest)
	var resolved response.Result[videoDownloadResolveVO]
	if err := json.Unmarshal(resolveRecorder.Body.Bytes(), &resolved); err != nil {
		t.Fatal(err)
	}
	if !resolved.Success || resolved.Data.DownloadURL == "" || strings.Contains(resolved.Data.DownloadURL, "relay-key") {
		t.Fatalf("unexpected resolve response: %+v body=%s", resolved, resolveRecorder.Body.String())
	}
	if resolved.Data.ExpiresAt > time.Now().Add(videoDownloadTicketMax+time.Second).Unix() {
		t.Fatalf("client expiry exceeds local ticket lifetime: %d", resolved.Data.ExpiresAt)
	}

	localURL, err := url.Parse(resolved.Data.DownloadURL)
	if err != nil {
		t.Fatal(err)
	}
	downloadRecorder := httptest.NewRecorder()
	downloadRequest := httptest.NewRequest(http.MethodGet, strings.Replace(localURL.Path, "/api/social-analysis/downloader", "", 1)+"?"+localURL.RawQuery, nil)
	router.ServeHTTP(downloadRecorder, downloadRequest)
	if downloadRecorder.Code != http.StatusOK || downloadRecorder.Body.String() != "video-bytes" {
		t.Fatalf("download status=%d body=%q", downloadRecorder.Code, downloadRecorder.Body.String())
	}
	if !strings.HasPrefix(downloadRecorder.Header().Get("Content-Disposition"), "attachment;") || !strings.Contains(strings.ToLower(downloadRecorder.Header().Get("Content-Disposition")), "utf-8") {
		t.Fatalf("content disposition = %q", downloadRecorder.Header().Get("Content-Disposition"))
	}

	tamperedQuery := localURL.Query()
	tamperedQuery.Set("name", "other.mp4")
	tamperedRecorder := httptest.NewRecorder()
	tamperedRequest := httptest.NewRequest(http.MethodGet, strings.Replace(localURL.Path, "/api/social-analysis/downloader", "", 1)+"?"+tamperedQuery.Encode(), nil)
	router.ServeHTTP(tamperedRecorder, tamperedRequest)
	if tamperedRecorder.Code != http.StatusUnauthorized || downloadCalls.Load() != 1 {
		t.Fatalf("tampered ticket status=%d downloadCalls=%d", tamperedRecorder.Code, downloadCalls.Load())
	}
}

func TestPublicDownloadSourceAndFilenameValidation(t *testing.T) {
	for _, raw := range []string{
		"http://www.youtube.com/watch?v=abc",
		"https://www.youtube.com:8443/watch?v=abc",
		"https://user:pass@www.youtube.com/watch?v=abc",
		"https://www.youtube.com/watch?v=abc#fragment",
	} {
		if got := validPublicDownloadSource(raw); got != "" {
			t.Errorf("invalid source %q accepted as %q", raw, got)
		}
	}
	if got := validPublicDownloadSource("https://www.youtube.com/watch?v=abc"); got == "" {
		t.Fatal("valid public HTTPS URL was rejected")
	}
	if got := downloadVideoFileName("测试 / 视频.mov"); got != "测试 - 视频.mp4" {
		t.Fatalf("download filename = %q", got)
	}
}

func TestVideoDownloadRejectsJSONBodyReturnedWithHTTP200(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token.Init(config.JWTConfig{Secret: "video-download-json-secret", Issuer: "video-download-json"}, nil)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		_, _ = w.Write([]byte(`{"error":"video_download not found","code":"not_found"}`))
	}))
	defer upstream.Close()
	name := "video.mp4"
	ticket, err := token.IssueDownloadTicket(idgen.ID(902), 0, relayVideoTicketResource("temporary-token"), name, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	h := &handler{downloader: newRelayVideoDownloader(upstream.URL, "relay-key")}
	router := gin.New()
	router.GET("/download/:token", videoDownloadTicketAuth(), h.downloadVideo)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/download/temporary-token?name=video.mp4&ticket="+url.QueryEscape(ticket), nil)
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusInternalServerError || recorder.Header().Get("Content-Disposition") != "" || strings.Contains(recorder.Body.String(), "video-bytes") {
		t.Fatalf("JSON-as-video response status=%d disposition=%q body=%q", recorder.Code, recorder.Header().Get("Content-Disposition"), recorder.Body.String())
	}
}

func TestVideoDownloadTicketMiddlewareRejectsOversizedCapability(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/download/:token", videoDownloadTicketAuth(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/download/temporary-token?name=video.mp4&ticket="+strings.Repeat("x", 4097), nil)
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("oversized ticket status = %d", recorder.Code)
	}
}

func TestRelayDownloaderBadRequestIsFormattedForUsers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	writeRelayDownloaderError(c, &relayDownloaderError{
		status: http.StatusBadRequest, code: "bad_request",
		message: "video is not publicly accessible, has been deleted, region-restricted, or requires login",
	})
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "视频无法公开访问") {
		t.Fatalf("formatted error status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestRelayDownloaderRedirectNeverForwardsAuthorizationCrossOrigin(t *testing.T) {
	client := newRelayVideoDownloader("https://relay.example", "relay-key")
	previous, err := http.NewRequest(http.MethodGet, "https://relay.example/v1/tools/video-downloader/download/token", nil)
	if err != nil {
		t.Fatal(err)
	}
	redirected, err := http.NewRequest(http.MethodGet, "https://cdn.example/video.mp4", nil)
	if err != nil {
		t.Fatal(err)
	}
	redirected.Header.Set("Authorization", "Bearer relay-key")
	if err := client.downloadClient.CheckRedirect(redirected, []*http.Request{previous}); err != nil {
		t.Fatal(err)
	}
	if authorization := redirected.Header.Get("Authorization"); authorization != "" {
		t.Fatalf("cross-origin redirect leaked authorization: %q", authorization)
	}
}

func TestResolveVideoDownloadHonorsDisabledCapability(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var resolveCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/tools/video-downloader/platforms" {
			_, _ = w.Write([]byte(`{"enabled":false,"platforms":[],"max_file_bytes":536870912,"token_ttl_seconds":600}`))
			return
		}
		resolveCalls.Add(1)
		_, _ = w.Write([]byte(`{"id":"unexpected"}`))
	}))
	defer upstream.Close()
	h := &handler{downloader: newRelayVideoDownloader(upstream.URL, "relay-key")}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/resolve", bytes.NewReader([]byte(`{"url":"https://www.youtube.com/watch?v=abc12345678","quality":"compat"}`)))
	c.Request.Header.Set("Content-Type", "application/json")
	h.resolveVideoDownload(c)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"code":2005`) || resolveCalls.Load() != 0 {
		t.Fatalf("disabled capability status=%d calls=%d body=%s", recorder.Code, resolveCalls.Load(), recorder.Body.String())
	}
}

func TestResolveVideoDownloadRejectsMetadataOverCurrentLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/tools/video-downloader/platforms":
			_, _ = w.Write([]byte(`{"enabled":true,"platforms":["youtube"],"max_file_bytes":10,"token_ttl_seconds":600}`))
		case "/v1/tools/video-downloader/resolve":
			_, _ = w.Write([]byte(`{"id":"temporary-token","platform":"youtube","title":"oversized","duration_seconds":1,"width":1,"height":1,"estimated_bytes":11,"quality":"compat","expires_at":` + strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10) + `}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	h := &handler{downloader: newRelayVideoDownloader(upstream.URL, "relay-key")}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/resolve", bytes.NewReader([]byte(`{"url":"https://www.youtube.com/watch?v=abc12345678","quality":"compat"}`)))
	c.Request.Header.Set("Content-Type", "application/json")
	h.resolveVideoDownload(c)
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "超过当前单文件下载上限") || strings.Contains(recorder.Body.String(), "downloadUrl") {
		t.Fatalf("oversized metadata status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
