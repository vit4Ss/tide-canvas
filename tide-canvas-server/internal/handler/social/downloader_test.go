package social

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"
)

type stubVideoDownloader struct {
	disabled   bool
	maxBytes   int64
	onResolve  func(context.Context, string, string) (videoDownloadResolveVO, error)
	onDownload func(context.Context, string, string) (*http.Response, error)
}

func (d *stubVideoDownloader) platforms(context.Context) (downloaderCapabilitiesVO, error) {
	n := d.maxBytes
	if n == 0 {
		n = 512 << 20
	}
	return downloaderCapabilitiesVO{Enabled: !d.disabled, Platforms: []string{"youtube"}, MaxFileBytes: n, TokenTTLSeconds: 300}, nil
}
func (d *stubVideoDownloader) resolve(ctx context.Context, source, quality string) (videoDownloadResolveVO, error) {
	if d.onResolve != nil {
		return d.onResolve(ctx, source, quality)
	}
	return videoDownloadResolveVO{ID: "local-token", Platform: "youtube", Title: "测试 / 视频", DurationSeconds: 42, Width: 1280, Height: 720, EstimatedBytes: 11, Quality: quality, ExpiresAt: time.Now().Add(5 * time.Minute).Unix()}, nil
}
func (d *stubVideoDownloader) download(ctx context.Context, source, quality string) (*http.Response, error) {
	if d.onDownload != nil {
		return d.onDownload(ctx, source, quality)
	}
	return videoResponse("video-bytes"), nil
}
func videoResponse(body string) *http.Response {
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"video/mp4"}}, ContentLength: int64(len(body)), Body: io.NopCloser(strings.NewReader(body))}
}

type deadlineRecorder struct {
	*httptest.ResponseRecorder
	deadlines []time.Time
}

func (w *deadlineRecorder) SetWriteDeadline(value time.Time) error {
	w.deadlines = append(w.deadlines, value)
	return nil
}

func TestLocalAttachmentTransferHasBoundedDeadline(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := &deadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/download/test?name=video.mp4", nil)
	c.Set("socialDownloadActivity", videoDownloadActivity{SourceURL: "https://youtu.be/abcdefghijk", Quality: "compat"})
	db := activityTestDB(t)
	record := paidDownloadFixture(t, db, 1, 2)
	c.Set(middleware.CtxUserID, record.UserID)
	c.Set("socialDownloadRecordID", record.ID)
	h := &handler{db: db, downloader: &stubVideoDownloader{}}
	h.downloadVideo(c)
	if w.Code != 200 || w.Body.String() != "video-bytes" || len(w.deadlines) != 2 || w.deadlines[0].IsZero() || !w.deadlines[1].IsZero() {
		t.Fatalf("attachment/deadline failed: status=%d deadlines=%v body=%q", w.Code, w.deadlines, w.Body.String())
	}
}

func TestConcurrentDownloadTicketDoesNotDuplicateWorkOrFailHistory(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token.Init(config.JWTConfig{Secret: "duplicate-download-test", Issuer: "test"}, nil)
	db := activityTestDB(t)
	record := paidDownloadFixture(t, db, 851, 852)
	started, release := make(chan struct{}), make(chan struct{})
	var startOnce, releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var calls atomic.Int32
	h := &handler{db: db, downloader: &stubVideoDownloader{onDownload: func(ctx context.Context, _, _ string) (*http.Response, error) {
		calls.Add(1)
		startOnce.Do(func() { close(started) })
		select {
		case <-release:
			return videoResponse("complete video"), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}}}
	ticket, err := token.IssueDownloadTicket(record.UserID, 0, videoActivityResource("same-ticket", record.ID, ""), "video.mp4", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/download/:token", videoDownloadTicketAuth(), h.downloadVideo)
	target := "/download/same-ticket?" + url.Values{"ticket": {ticket}, "record": {record.ID.String()}, "name": {"video.mp4"}}.Encode()
	request := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", target, nil))
		return w
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- request() }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("first download did not start")
	}
	duplicate := request()
	var result response.Result[any]
	if json.Unmarshal(duplicate.Body.Bytes(), &result) != nil || result.Code != response.CodeRateLimited || calls.Load() != 1 {
		t.Fatalf("duplicate was not rejected: %s calls=%d", duplicate.Body, calls.Load())
	}
	if err := db.First(&record, record.ID).Error; err != nil || record.Status != model.SocialActivityDownloading {
		t.Fatalf("duplicate changed active history: %+v %v", record, err)
	}
	releaseOnce.Do(func() { close(release) })
	if completed := <-done; completed.Code != 200 || completed.Body.String() != "complete video" {
		t.Fatalf("first download failed: %s", completed.Body)
	}
	if retried := request(); strings.Contains(retried.Body.String(), "complete video") || calls.Load() != 1 {
		t.Fatal("completed paid ticket allowed a second server transfer")
	}
	if err := db.First(&record, record.ID).Error; err != nil || record.Status != model.SocialActivitySucceeded {
		t.Fatalf("completed history is incorrect: %+v %v", record, err)
	}
}

func TestLocalDownloadFailureAndOwnerIsolation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token.Init(config.JWTConfig{Secret: "local-download-test", Issuer: "test"}, nil)
	db := activityTestDB(t)
	legacy := paidDownloadFixture(t, db, 801, 802)
	calls := 0
	h := &handler{db: db, downloader: &stubVideoDownloader{onDownload: func(context.Context, string, string) (*http.Response, error) {
		calls++
		return nil, &videoDownloaderError{status: 504, message: "视频处理超时，请重试", authored: true}
	}}}
	router := gin.New()
	router.GET("/download/:token", videoDownloadTicketAuth(), h.downloadVideo)
	request := func(uid idgen.ID) *httptest.ResponseRecorder {
		ticket, err := token.IssueDownloadTicket(uid, 0, videoActivityResource("legacy-token", legacy.ID, ""), "video.mp4", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		query := url.Values{"ticket": {ticket}, "name": {"video.mp4"}, "record": {legacy.ID.String()}}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/download/legacy-token?"+query.Encode(), nil))
		return w
	}
	if got := request(999); got.Code != 404 || calls != 0 {
		t.Fatalf("foreign record accepted: %d %s", got.Code, got.Body)
	}
	got := request(802)
	if !strings.Contains(got.Body.String(), "超时") {
		t.Fatalf("unhelpful error: %s", got.Body)
	}
	var saved model.SocialActivityRecord
	if err := db.First(&saved, 801).Error; err != nil || saved.Status != model.SocialActivityFailed || !strings.Contains(saved.ErrorMessage, "超时") {
		t.Fatalf("failure not retained: %+v %v", saved, err)
	}
}

func TestLocalDownloadDisabledAndOversizeDoNotIssueTickets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, disabled := range []bool{true, false} {
		db := activityTestDB(t)
		fundSocialUser(t, db, 22, 10)
		h := &handler{db: db, downloader: &stubVideoDownloader{disabled: disabled, maxBytes: 10}}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/resolve", strings.NewReader(`{"url":"https://youtu.be/abcdefghijk","quality":"compat"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set(middleware.CtxUserID, idgen.ID(22))
		h.resolveVideoDownload(c)
		if strings.Contains(w.Body.String(), "downloadUrl") {
			t.Fatalf("unusable ticket issued: %s", w.Body)
		}
		if disabled && !strings.Contains(w.Body.String(), "未启用") {
			t.Fatal(w.Body)
		}
		if !disabled && !strings.Contains(w.Body.String(), "超过") {
			t.Fatal(w.Body)
		}
	}
}

func TestLocalDownloaderNeedsNoRelayConfiguration(t *testing.T) {
	d := newLocalVideoDownloader(config.VideoDownloaderConfig{Enabled: false})
	capabilities, err := d.platforms(context.Background())
	if err != nil || capabilities.Enabled || len(capabilities.Platforms) != 0 || capabilities.MaxFileBytes != 512<<20 {
		t.Fatalf("unexpected capabilities: %+v %v", capabilities, err)
	}
	_, err = d.resolve(context.Background(), "https://youtu.be/abcdefghijk", "compat")
	if err == nil {
		t.Fatal("disabled downloader resolved")
	}
}

func TestVideoDownloadMessagesAndFilename(t *testing.T) {
	for _, status := range []int{400, 413, 429, 502, 503, 504} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		writeVideoDownloaderError(c, &videoDownloaderError{status: status, message: "视频超过限制，请重试", authored: true})
		if strings.Contains(w.Body.String(), "请联系客服") || strings.Contains(w.Body.String(), "Relay") {
			t.Fatalf("lost actionable message: %s", w.Body)
		}
	}
	if name := downloadVideoFileName(`测试 / 视频`); name != "测试 - 视频.mp4" {
		t.Fatalf("filename %q", name)
	}
	for _, raw := range []string{"http://youtube.com/watch?v=a", "https://youtube.com:8443/watch?v=a", "https://user:password@youtube.com/watch?v=a", "https://youtube.com/watch?v=a#x"} {
		if validPublicDownloadSource(raw) != "" {
			t.Fatalf("unsafe source accepted: %s", raw)
		}
	}
	for _, raw := range []string{"http://example.com/image.png", "https://user:pass@example.com/image.png", "https://example.com:8443/image.png"} {
		if displayImageURL(raw) != "" {
			t.Fatalf("unsafe cover accepted: %s", raw)
		}
	}
}
func TestVideoDownloadHTTPFlowIssuesBoundTicketAndStreamsAttachment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token.Init(config.JWTConfig{Secret: "video-download-test-secret", Issuer: "video-download-test"}, nil)
	db := activityTestDB(t)
	fundSocialUser(t, db, 901, 1)
	var downloadCalls atomic.Int32
	backend := &stubVideoDownloader{onDownload: func(ctx context.Context, source, quality string) (*http.Response, error) {
		downloadCalls.Add(1)
		if source != "https://www.youtube.com/watch?v=abc12345678" || quality != "compat" {
			t.Errorf("wrong signed download parameters: %s %s", source, quality)
		}
		return videoResponse("video-bytes"), nil
	}}
	h := &handler{db: db, downloader: backend}
	router := gin.New()
	router.POST("/resolve", func(c *gin.Context) {
		c.Set(middleware.CtxUserID, idgen.ID(901))
		c.Set(middleware.CtxRole, 0)
		c.Next()
	}, h.resolveVideoDownload)
	router.GET("/download/:token", videoDownloadTicketAuth(), h.downloadVideo)

	resolveRecorder := httptest.NewRecorder()
	resolveRequest := httptest.NewRequest(http.MethodPost, "/resolve", bytes.NewReader([]byte(`{"url":"https://www.youtube.com/watch?v=abc12345678","quality":"compat","clientRequestId":"same-download"}`)))
	resolveRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(resolveRecorder, resolveRequest)
	var resolved response.Result[videoDownloadResolveVO]
	if err := json.Unmarshal(resolveRecorder.Body.Bytes(), &resolved); err != nil {
		t.Fatal(err)
	}
	if !resolved.Success || resolved.Data.DownloadURL == "" {
		t.Fatalf("unexpected resolve response: %+v body=%s", resolved, resolveRecorder.Body.String())
	}
	if resolved.Data.ExpiresAt > time.Now().Add(videoDownloadTicketMax+time.Second).Unix() {
		t.Fatalf("client expiry exceeds local ticket lifetime: %d", resolved.Data.ExpiresAt)
	}
	if resolved.Data.RecordID == 0 {
		t.Fatal("resolve response did not include an activity record id")
	}
	if socialBalance(t, db, 901) != 0 {
		t.Fatal("download did not reserve its price")
	}
	var activity model.SocialActivityRecord
	// Network retries reuse the same paid reservation and ticket.
	for range 5 {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/resolve", strings.NewReader(`{"url":"https://www.youtube.com/watch?v=abc12345678","quality":"compat","clientRequestId":"same-download"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		var replay response.Result[videoDownloadResolveVO]
		if err := json.Unmarshal(recorder.Body.Bytes(), &replay); err != nil || !replay.Success || replay.Data.RecordID != resolved.Data.RecordID {
			t.Fatalf("paid replay failed: %s", recorder.Body)
		}
	}
	var count int64
	if err := db.Model(&model.SocialActivityRecord{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("retries created %d download records, err=%v", count, err)
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
	if repeated.Body.String() == "video-bytes" || downloadCalls.Load() != 1 {
		t.Fatalf("repeat download failed: %s", repeated.Body.String())
	}
	if err := db.Model(&model.SocialActivityRecord{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("repeat download duplicated history: count=%d err=%v", count, err)
	}
}
