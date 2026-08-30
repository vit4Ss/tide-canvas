package file

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
	"tidecanvas/internal/pkg/token"
)

type ownedURLReaderStub struct {
	body string
	err  error
	url  string
}

func (s *ownedURLReaderStub) OpenURL(_ context.Context, raw string) (io.ReadCloser, error) {
	s.url = raw
	if s.err != nil {
		return nil, s.err
	}
	return io.NopCloser(strings.NewReader(s.body)), nil
}

// 下载名补扩展名：按「结尾是否已是 URL 的扩展名」判定——模型名带版本点号
// （qwen-image-3.0-pro / Hunyuan 3D 3.1）时旧的「无点才补」会吞掉扩展名。
func TestDownloadFilename(t *testing.T) {
	cases := []struct {
		name    string
		urlPath string
		want    string
	}{
		// 版本点号不再抑制补扩展名（本次修复的主场景）
		{"qwen-image-3.0-pro", "/gen/abc.png", "qwen-image-3.0-pro.png"},
		{"Hunyuan 3D 3.1 (Tencent MaaS)", "/models/dog.glb", "Hunyuan 3D 3.1 (Tencent MaaS).glb"},
		// 已带同扩展名（含大小写差异）不重复追加
		{"photo.png", "/gen/abc.png", "photo.png"},
		{"photo.PNG", "/gen/abc.png", "photo.PNG"},
		// 前端已拼好扩展名的 3D 下载名，服务端不再二次追加
		{"Hunyuan 3D 3.1 (Tencent MaaS).glb", "/models/dog.glb", "Hunyuan 3D 3.1 (Tencent MaaS).glb"},
		// URL 无扩展名时保持原名
		{"qwen-image-3.0-pro", "/gen/abc", "qwen-image-3.0-pro"},
		// 空名回退 download（原有行为）
		{"", "/gen/abc.mp4", "download.mp4"},
		{"", "/gen/abc", "download"},
		// 扩展名不同则按实际字节的格式追加
		{"song.mp3", "/gen/track.wav", "song.mp3.wav"},
	}
	for _, tc := range cases {
		if got := downloadFilename(tc.name, tc.urlPath); got != tc.want {
			t.Errorf("downloadFilename(%q, %q) = %q, want %q", tc.name, tc.urlPath, got, tc.want)
		}
	}
}

func TestDownloadTicketRejectsMissingOwnedStorageObject(t *testing.T) {
	ginn := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(ginn) })

	dir := t.TempDir()
	store, err := storage.NewLocalStorage(config.StorageConfig{
		LocalDir:  dir,
		PublicURL: "https://cdn.example.test/canvas/uploads",
	})
	if err != nil {
		t.Fatalf("new local storage: %v", err)
	}
	raw, err := store.Save(context.Background(), "gen/missing.mp3", strings.NewReader("audio"), "audio/mpeg")
	if err != nil {
		t.Fatalf("save fixture: %v", err)
	}
	db, err := gorm.Open(sqlite.Open("file:download_ticket_missing_object?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.File{}, &model.SkillRun{}, &model.SkillRunArtifact{}, &model.CommunityPost{}, &model.BlogPost{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	const ownerID idgen.ID = 8351
	if err := db.Create(&model.User{ID: ownerID, Username: "missing-owner", Email: "missing-owner@example.test", Status: 1}).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if err := db.Create(&model.AiTask{ID: 8352, UserID: ownerID, Status: 1, ResultUrl: raw, CreateTime: time.Now()}).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	token.Init(config.JWTConfig{Secret: "download-native-test-secret", Issuer: "download-native-test"}, nil)
	h := &handler{svc: &service{repo: newRepo(db), store: store}}
	requestBody, _ := json.Marshal(downloadTicketDTO{URL: raw, Name: "missing.mp3"})
	issue := func() *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/files/download-ticket", bytes.NewReader(requestBody))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set(middleware.CtxUserID, ownerID)
		h.issueDownloadTicket(c)
		return recorder
	}

	available := issue()
	if available.Code != http.StatusOK || !strings.Contains(available.Body.String(), `"native":true`) {
		t.Fatalf("available object ticket = %d %s, want native download", available.Code, available.Body.String())
	}
	if err := os.Remove(filepath.Join(dir, "gen", "missing.mp3")); err != nil {
		t.Fatalf("remove fixture: %v", err)
	}
	missing := issue()
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing object ticket status = %d, body = %s", missing.Code, missing.Body.String())
	}
}

func TestTextContainsExactURL(t *testing.T) {
	const target = "https://cdn.example.com/video.mp4"
	for _, content := range []string{
		`![video](https://cdn.example.com/video.mp4)`,
		`![video](https://cdn.example.com/video.mp4 "poster")`,
		`<video src="https://cdn.example.com/video.mp4">`,
	} {
		if !textContainsExactURL(content, target) {
			t.Fatalf("expected exact URL in %q to match", content)
		}
	}
	if textContainsExactURL(`![video](https://cdn.example.com/video.mp4?preview=1)`, target) {
		t.Fatal("must not authorize a URL prefix inside a different URL")
	}
}

func TestOpenOwnedStorageURLBypassesRemoteResolution(t *testing.T) {
	const raw = "https://test-cdn.example/uploads/panorama.png"
	store := &ownedURLReaderStub{body: "panorama-bytes"}
	body, handled, err := openOwnedStorageURL(context.Background(), store, raw)
	if err != nil {
		t.Fatalf("openOwnedStorageURL() error = %v", err)
	}
	if !handled {
		t.Fatal("openOwnedStorageURL() handled = false, want true")
	}
	defer body.Close()
	got, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read owned body: %v", err)
	}
	if string(got) != store.body {
		t.Fatalf("owned body = %q, want %q", got, store.body)
	}
	if store.url != raw {
		t.Fatalf("OpenURL raw = %q, want %q", store.url, raw)
	}
}

func TestOpenOwnedStorageURLFallsBackOnlyForUnsupportedURL(t *testing.T) {
	store := &ownedURLReaderStub{err: storage.ErrUnsupported}
	body, handled, err := openOwnedStorageURL(context.Background(), store, "https://third-party.example/image.png")
	if body != nil || handled || err != nil {
		t.Fatalf("unsupported result = (%v, %v, %v), want (nil, false, nil)", body, handled, err)
	}

	readErr := errors.New("oss unavailable")
	store.err = readErr
	body, handled, err = openOwnedStorageURL(context.Background(), store, "https://test-cdn.example/image.png")
	if body != nil || !handled || !errors.Is(err, readErr) {
		t.Fatalf("owned read failure = (%v, %v, %v), want (nil, true, %v)", body, handled, err, readErr)
	}
}

func TestContentTypeForDownload(t *testing.T) {
	if got := contentTypeForDownload("/uploads/panorama.png"); got != "image/png" {
		t.Fatalf("PNG content type = %q, want image/png", got)
	}
	if got := contentTypeForDownload("/uploads/file.unknown-extension"); got != "application/octet-stream" {
		t.Fatalf("unknown content type = %q, want application/octet-stream", got)
	}
}

func TestStreamDownloadUsesUtf8SafeAttachmentName(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	streamDownload(c, strings.NewReader("audio"), "audio/mpeg", "西瓜汽水\r\n.mp3", 5)
	disposition := recorder.Header().Get("Content-Disposition")
	if !strings.HasPrefix(disposition, "attachment;") || strings.ContainsAny(disposition, "\r\n") {
		t.Fatalf("unsafe disposition: %q", disposition)
	}
	if !strings.Contains(strings.ToLower(disposition), "utf-8") {
		t.Fatalf("UTF-8 filename was not encoded: %q", disposition)
	}
	if recorder.Body.String() != "audio" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

// Suno 的第二首歌通常只存在 ai_tasks.result_meta.tracks，不一定等于
// result_url。下载代理必须按精确 JSON 字符串授权该 URL，同时拒绝其他用户。
func TestOwnsDownloadURLAllowsOwnedSecondaryAudioTrack(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:download_secondary_audio?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.File{}, &model.SkillRun{}, &model.SkillRunArtifact{}, &model.CommunityPost{}, &model.BlogPost{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const ownerID idgen.ID = 8301
	const strangerID idgen.ID = 8302
	const trackURL = "https://cdn.example.com/canvas/uploads/gen/song-2.mp3?sign=abc"
	for _, id := range []idgen.ID{ownerID, strangerID} {
		if err := db.Create(&model.User{
			ID: id, Username: "user-" + id.String(), Email: "user-" + id.String() + "@example.test", Status: 1,
		}).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	if err := db.Create(&model.AiTask{
		ID:         8303,
		UserID:     ownerID,
		Status:     1,
		ResultUrl:  "https://cdn.example.com/canvas/uploads/gen/song-1.mp3",
		ResultMeta: `{"tracks":[{"url":"` + trackURL + `","title":"同名歌曲"}]}`,
		CreateTime: time.Now(),
	}).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	svc := &service{repo: newRepo(db)}
	owned, err := svc.ownsDownloadURL(context.Background(), ownerID, trackURL)
	if err != nil || !owned {
		t.Fatalf("owner result = (%v, %v), want (true, nil)", owned, err)
	}
	owned, err = svc.ownsDownloadURL(context.Background(), strangerID, trackURL)
	if err != nil || owned {
		t.Fatalf("stranger result = (%v, %v), want (false, nil)", owned, err)
	}
}

func TestDownloadTicketEndpointProducesNativeURLWithoutAuthorizationHeader(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:download_ticket_endpoint?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.File{}, &model.SkillRun{}, &model.SkillRunArtifact{}, &model.CommunityPost{}, &model.BlogPost{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const ownerID idgen.ID = 8401
	const raw = "https://cdn.example.com/canvas/uploads/gen/song.mp3?sign=abc"
	const name = "同名歌曲-1.mp3"
	if err := db.Create(&model.User{ID: ownerID, Username: "ticket-owner", Email: "ticket@example.test", Status: 1}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := db.Create(&model.AiTask{ID: 8402, UserID: ownerID, Status: 1, ResultUrl: raw, CreateTime: time.Now()}).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}
	token.Init(config.JWTConfig{Secret: "download-endpoint-test-secret", Issuer: "download-endpoint-test"}, nil)
	h := &handler{svc: &service{repo: newRepo(db)}}

	requestBody, _ := json.Marshal(downloadTicketDTO{URL: raw, Name: name})
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/files/download-ticket", bytes.NewReader(requestBody))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(middleware.CtxUserID, ownerID)
	c.Set(middleware.CtxRole, 0)
	h.issueDownloadTicket(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("ticket status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || !envelope.Success {
		t.Fatalf("ticket response = %s, error = %v", recorder.Body.String(), err)
	}
	ticketURL, err := url.Parse(envelope.Data.URL)
	if err != nil {
		t.Fatalf("parse ticket URL: %v", err)
	}
	if ticketURL.Query().Get("url") != raw || ticketURL.Query().Get("name") != name {
		t.Fatalf("ticket URL does not preserve file binding: %s", envelope.Data.URL)
	}

	// Native navigation has no Authorization header; the ticket middleware must
	// still recover the exact user identity for download()'s ownership recheck.
	router := gin.New()
	router.GET("/api/files/download", downloadTicketOrJWT(nil), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"userId": middleware.CurrentUserID(c).String()})
	})
	nativeRecorder := httptest.NewRecorder()
	nativeRequest := httptest.NewRequest(http.MethodGet, envelope.Data.URL, nil)
	router.ServeHTTP(nativeRecorder, nativeRequest)
	if nativeRecorder.Code != http.StatusOK || !strings.Contains(nativeRecorder.Body.String(), ownerID.String()) {
		t.Fatalf("native ticket response = %d %s", nativeRecorder.Code, nativeRecorder.Body.String())
	}
}

func TestRegisterDownloadRoutesDoNotConflict(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:download_routes?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	router := gin.New()
	api := router.Group("/api")
	Register(api, &app.Deps{DB: db})
	routes := map[string]bool{}
	for _, route := range router.Routes() {
		routes[route.Method+" "+route.Path] = true
	}
	for _, want := range []string{
		"GET /api/files/download",
		"POST /api/files/download-ticket",
		"POST /api/files/upload",
	} {
		if !routes[want] {
			t.Fatalf("missing route %s: %+v", want, router.Routes())
		}
	}
}
