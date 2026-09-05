package social

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
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
	db, err := gorm.Open(sqlite.Open("file:video-download-flow?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SocialActivityRecord{}); err != nil {
		t.Fatal(err)
	}
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
	h := &handler{db: db, downloader: newRelayVideoDownloader(upstream.URL, "relay-key")}
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
	if resolved.Data.RecordID == 0 {
		t.Fatal("resolve response did not include an activity record id")
	}
	var activity model.SocialActivityRecord
	// Reproduce the screenshot: repeatedly preview three qualities. None of
	// these requests is an actual download, so the history must remain empty.
	for _, quality := range []string{"quality", "speed", "compat", "quality", "compat"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/resolve", strings.NewReader(`{"url":"https://www.youtube.com/watch?v=abc12345678","quality":"`+quality+`"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		var preview response.Result[videoDownloadResolveVO]
		if err := json.Unmarshal(recorder.Body.Bytes(), &preview); err != nil || !preview.Success {
			t.Fatalf("quality preview failed: %s err=%v", recorder.Body.String(), err)
		}
	}
	var count int64
	if err := db.Model(&model.SocialActivityRecord{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("previews created %d download records, err=%v", count, err)
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
	if err := db.First(&activity, "id = ?", resolved.Data.RecordID).Error; err != nil || activity.Status != model.SocialActivitySucceeded || activity.DownloadedBytes != 11 {
		t.Fatalf("completed activity = %+v err=%v", activity, err)
	}
	if activity.UserID != 901 || activity.SourceURL != "https://www.youtube.com/watch?v=abc12345678" || activity.Quality != "compat" || activity.EstimatedBytes != 11 || activity.Title != "测试 / 视频" {
		t.Fatalf("download did not retain the signed preview metadata: %+v", activity)
	}

	tamperedQuery := localURL.Query()
	tamperedQuery.Set("name", "other.mp4")
	tamperedRecorder := httptest.NewRecorder()
	tamperedRequest := httptest.NewRequest(http.MethodGet, strings.Replace(localURL.Path, "/api/social-analysis/downloader", "", 1)+"?"+tamperedQuery.Encode(), nil)
	router.ServeHTTP(tamperedRecorder, tamperedRequest)
	if tamperedRecorder.Code != http.StatusUnauthorized || downloadCalls.Load() != 1 {
		t.Fatalf("tampered ticket status=%d downloadCalls=%d", tamperedRecorder.Code, downloadCalls.Load())
	}
	tamperedRecordQuery := localURL.Query()
	tamperedRecordQuery.Set("record", "999999")
	tamperedRecordRecorder := httptest.NewRecorder()
	tamperedRecordRequest := httptest.NewRequest(http.MethodGet, strings.Replace(localURL.Path, "/api/social-analysis/downloader", "", 1)+"?"+tamperedRecordQuery.Encode(), nil)
	router.ServeHTTP(tamperedRecordRecorder, tamperedRecordRequest)
	if tamperedRecordRecorder.Code != http.StatusUnauthorized || downloadCalls.Load() != 1 {
		t.Fatalf("tampered record binding status=%d downloadCalls=%d", tamperedRecordRecorder.Code, downloadCalls.Load())
	}
	for _, metadata := range []string{"", base64.RawURLEncoding.EncodeToString([]byte(`{"u":"https://www.youtube.com/watch?v=changed"}`))} {
		query := localURL.Query()
		query.Set("meta", metadata)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, strings.Replace(localURL.Path, "/api/social-analysis/downloader", "", 1)+"?"+query.Encode(), nil))
		if recorder.Code != http.StatusUnauthorized || downloadCalls.Load() != 1 {
			t.Fatalf("tampered/removed metadata was accepted: status=%d calls=%d", recorder.Code, downloadCalls.Load())
		}
	}
	// A repeated request of the same ticket must not create another history row.
	repeated := httptest.NewRecorder()
	router.ServeHTTP(repeated, httptest.NewRequest(http.MethodGet, strings.Replace(localURL.Path, "/api/social-analysis/downloader", "", 1)+"?"+localURL.RawQuery, nil))
	if repeated.Body.String() != "video-bytes" || downloadCalls.Load() != 2 {
		t.Fatalf("repeat download failed: %s", repeated.Body.String())
	}
	if err := db.Model(&model.SocialActivityRecord{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("repeat download duplicated history: count=%d err=%v", count, err)
	}
}

func TestDownloadHistoryRetainsFailuresAndSupportsLegacyTickets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token.Init(config.JWTConfig{Secret: "download-history-failures", Issuer: "download-history"}, nil)
	db := activityTestDB(t)
	owner := idgen.ID(801)
	legacy := model.SocialActivityRecord{ID: idgen.ID(802), UserID: owner, ActivityType: model.SocialActivityDownload, Status: model.SocialActivityReady, SourceURL: "https://youtu.be/old-video", Title: "旧版视频", Quality: "compat"}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	var unavailable atomic.Bool
	unavailable.Store(true)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if unavailable.Load() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"temporarily unavailable"}`))
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("video-bytes"))
	}))
	defer upstream.Close()
	h := &handler{db: db, downloader: newRelayVideoDownloader(upstream.URL, "relay-key")}
	router := gin.New()
	router.GET("/download/:token", videoDownloadTicketAuth(), h.downloadVideo)
	download := func(uid, recordID idgen.ID, metadata string) *httptest.ResponseRecorder {
		t.Helper()
		ticket, err := token.IssueDownloadTicket(uid, 0, relayVideoActivityResource("temporary-token", recordID, metadata), "video.mp4", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		query := url.Values{"ticket": {ticket}, "name": {"video.mp4"}, "record": {recordID.String()}}
		if metadata != "" {
			query.Set("meta", metadata)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/download/temporary-token?"+query.Encode(), nil))
		return recorder
	}
	// Even a valid legacy capability for another user cannot touch this record.
	if got := download(idgen.ID(999), legacy.ID, ""); got.Code != http.StatusNotFound || calls.Load() != 0 {
		t.Fatalf("foreign record was accepted: %d %s", got.Code, got.Body.String())
	}
	download(owner, legacy.ID, "")
	var saved model.SocialActivityRecord
	if err := db.First(&saved, "id = ?", legacy.ID).Error; err != nil || saved.Status != model.SocialActivityFailed || saved.ErrorMessage == "" {
		t.Fatalf("legacy download failure not recorded: %+v err=%v", saved, err)
	}
	preview := videoDownloadActivity{SourceURL: "https://www.youtube.com/watch?v=new-video", Platform: "youtube", Title: "新视频", Quality: "speed", Width: 640, Height: 480, EstimatedBytes: 11, ExpiresAt: time.Now().Add(time.Minute).Unix()}
	encoded, _ := json.Marshal(preview)
	metadata := base64.RawURLEncoding.EncodeToString(encoded)
	newID := idgen.ID(803)
	download(owner, newID, metadata)
	saved = model.SocialActivityRecord{}
	if err := db.First(&saved, "id = ?", newID).Error; err != nil || saved.Status != model.SocialActivityFailed || saved.Title != preview.Title || saved.Quality != preview.Quality || saved.UserID != owner {
		t.Fatalf("new download failure lost metadata: %+v err=%v", saved, err)
	}
	unavailable.Store(false)
	if got := download(owner, newID, metadata); got.Body.String() != "video-bytes" {
		t.Fatalf("retry failed: %s", got.Body.String())
	}
	unavailable.Store(true)
	download(owner, newID, metadata)
	saved = model.SocialActivityRecord{}
	if err := db.First(&saved, "id = ?", newID).Error; err != nil || saved.Status != model.SocialActivitySucceeded || saved.DownloadedBytes != 11 {
		t.Fatalf("failed replay downgraded completed download: %+v err=%v", saved, err)
	}
	var count int64
	if err := db.Model(&model.SocialActivityRecord{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("retries created additional history: %d err=%v", count, err)
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

// 用户实测:B 站链接点「解析视频」只回一句「请联系客服」。根因是凡是不落在
// 400/404/429 的上游失败都被扔进 500,而 response.Fail 对 500 会强制抹成统一
// 话术——传进去的 upstream.message 是死代码。下面逐种失败核对用户看到的话。
func TestRelayDownloaderFailuresStayActionableForUsers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name     string
		err      *relayDownloaderError
		wantCode int
		contains string
	}{
		{
			name:     "upstream 5xx invites a retry instead of a support ticket",
			err:      &relayDownloaderError{status: http.StatusBadGateway, code: "upstream_error", message: "extractor crashed"},
			wantCode: response.CodeToolDisabled,
			contains: "请稍后重试",
		},
		{
			name:     "relay auth failure points at the administrator",
			err:      &relayDownloaderError{status: http.StatusUnauthorized, code: "unauthorized", message: "bad key"},
			wantCode: response.CodeToolDisabled,
			contains: "Relay API Key",
		},
		{
			name:     "other 4xx keeps the upstream reason",
			err:      &relayDownloaderError{status: http.StatusUnprocessableEntity, code: "unsupported", message: "unsupported url scheme"},
			wantCode: response.CodeBadRequest,
			contains: "unsupported url scheme",
		},
		{
			name:     "oversized video states the actual size",
			err:      &relayDownloaderError{status: http.StatusBadRequest, code: "too_large", message: "视频体积约 3.0 GB，超过本站 2.0 GB 的下载上限"},
			wantCode: response.CodeBadRequest,
			contains: "超过本站",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			writeRelayDownloaderError(c, tc.err)
			body := recorder.Body.String()
			if strings.Contains(body, "请联系客服") {
				t.Fatalf("user was told to contact support instead of what to do: %s", body)
			}
			if !strings.Contains(body, tc.contains) {
				t.Fatalf("missing %q in %s", tc.contains, body)
			}
			if !strings.Contains(body, fmt.Sprintf(`"code":%d`, tc.wantCode)) {
				t.Fatalf("want business code %d, got %s", tc.wantCode, body)
			}
		})
	}
}

// resolve 的严格校验此前一律抛裸 error,同样落进 500 的统一话术。
func TestRelayResolveRejectionsCarryReadableReasons(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name     string
		payload  string
		contains string
	}{
		{"unusable token", `{"id":"has spaces","platform":"bilibili","expires_at":9999999999}`, "下载凭证"},
		{"undecodable payload", `not json at all`, "无法识别"},
		{"out-of-range metadata", `{"id":"ok-token","platform":"","expires_at":9999999999}`, "解析结果异常"},
		{"oversized estimate", `{"id":"ok-token","platform":"bilibili","estimated_bytes":9999999999999,"expires_at":9999999999}`, "下载上限"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.payload))
			}))
			defer upstream.Close()
			downloader := newRelayVideoDownloader(upstream.URL, "relay-key")
			_, err := downloader.resolve(context.Background(), "https://www.bilibili.com/video/BV1xx", "compat")
			if err == nil {
				t.Fatal("expected the strict validation to reject this payload")
			}
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			writeRelayDownloaderError(c, err)
			body := recorder.Body.String()
			if strings.Contains(body, "请联系客服") {
				t.Fatalf("opaque support message survived: %s", body)
			}
			if !strings.Contains(body, tc.contains) {
				t.Fatalf("missing %q in %s", tc.contains, body)
			}
		})
	}
}

// authored 标记本身也要有测试兜住:漏标的话自撰文案会被通用话术静默盖掉,
// 而这正是本轮修复要根除的「文案是死代码」问题。
func TestAuthoredMessagesSurviveTheStatusDispatch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	writeRelayDownloaderError(c, &relayDownloaderError{
		status: http.StatusBadGateway, code: "invalid_token",
		message: "视频解析服务返回了无法使用的下载凭证，请稍后重试或更换链接", authored: true,
	})
	if !strings.Contains(recorder.Body.String(), "下载凭证") {
		t.Fatalf("authored copy was overwritten: %s", recorder.Body.String())
	}
	// 未标记 authored 的上游原文不得直接透出,改用我们的通用话术。
	recorder = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(recorder)
	writeRelayDownloaderError(c, &relayDownloaderError{
		status: http.StatusBadGateway, code: "upstream_error", message: "panic in extractor goroutine 42",
	})
	body := recorder.Body.String()
	if strings.Contains(body, "goroutine") || !strings.Contains(body, "请稍后重试") {
		t.Fatalf("raw upstream 5xx text leaked or hint missing: %s", body)
	}
}

// 封面不在文档化契约里,但拿到就能让用户在下载前确认画面。取值必须容忍键名差异,
// 同时挡住任何不能安全进 <img> 的地址。
func TestResolveTakesCoverFromCommonKeysAndRejectsUnsafeOnes(t *testing.T) {
	cases := []struct {
		name  string
		extra string
		want  string
	}{
		{"documented absence stays empty", ``, ""},
		{"cover", `,"cover":"https://img.example/a.jpg"`, "https://img.example/a.jpg"},
		{"snake case cover_url", `,"cover_url":"https://img.example/b.jpg"`, "https://img.example/b.jpg"},
		{"thumbnail", `,"thumbnail":"https://img.example/c.jpg"`, "https://img.example/c.jpg"},
		{"poster", `,"poster":"https://img.example/d.jpg"`, "https://img.example/d.jpg"},
		{"http is refused", `,"cover":"http://img.example/e.jpg"`, ""},
		{"credentials are refused", `,"cover":"https://user:pw@img.example/f.jpg"`, ""},
		{"custom port is refused", `,"cover":"https://img.example:8443/g.jpg"`, ""},
		{"javascript scheme is refused", `,"cover":"javascript:alert(1)"`, ""},
		{"first usable candidate wins", `,"cover":"http://bad/x.jpg","thumbnail":"https://img.example/h.jpg"`, "https://img.example/h.jpg"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"tok","platform":"bilibili","title":"v","duration_seconds":10,"width":1280,"height":720,"estimated_bytes":1024,"quality":"compat","expires_at":` +
					strconv.FormatInt(time.Now().Add(10*time.Minute).Unix(), 10) + tc.extra + `}`))
			}))
			defer server.Close()
			resolved, err := newRelayVideoDownloader(server.URL, "relay-key").
				resolve(context.Background(), "https://www.bilibili.com/video/BV1xx", "compat")
			if err != nil {
				t.Fatal(err)
			}
			if resolved.CoverURL != tc.want {
				t.Fatalf("cover = %q, want %q", resolved.CoverURL, tc.want)
			}
		})
	}
}
