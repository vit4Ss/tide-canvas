package file

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/userkey"
)

func TestOpenAPIFileRoundTripAndAdminKeyIsolation(t *testing.T) {
	svc, db, store, owner, _ := newDedupTestService(t)
	if err := db.AutoMigrate(&model.UserAPIKey{}, &model.AiTask{}, &model.SkillRun{}, &model.SkillRunArtifact{}, &model.CommunityPost{}, &model.BlogPost{}, &model.SysRole{}); err != nil {
		t.Fatal(err)
	}
	keys, err := userkey.New(db, "file-api-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	keyFor := func(id idgen.ID) string {
		row, err := keys.Ensure(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		key, err := keys.Reveal(context.Background(), id, row.Revision)
		if err != nil {
			t.Fatal(err)
		}
		return key
	}
	if err := db.Model(&model.User{}).Where("id = ?", owner.ID).Update("status", 1).Error; err != nil {
		t.Fatal(err)
	}
	ownerKey := keyFor(owner.ID)
	admin := model.User{ID: idgen.Next(), Username: "api-admin", Email: "api-admin@example.test", Role: 9, Status: 1, StorageQuota: 1 << 30}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	adminKey := keyFor(admin.ID)
	engine := gin.New()
	Register(engine.Group("/api"), &app.Deps{DB: db, Storage: store, UserKeys: keys})
	content := []byte("private file belonging to the API caller")
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "reference.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	upload := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/open/v1/files", bytes.NewReader(body.Bytes()))
		req.Header.Set("Content-Type", writer.FormDataContentType())
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		res := httptest.NewRecorder()
		engine.ServeHTTP(res, req)
		return res
	}
	if res := upload(""); res.Code != 401 {
		t.Fatalf("unauthenticated upload=%d", res.Code)
	}
	res := upload(ownerKey)
	var result response.Result[FileVO]
	if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil || !result.Success || result.Data.OwnerID != owner.ID {
		t.Fatalf("upload=%s err=%v", res.Body.String(), err)
	}
	download := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/open/v1/files/download?url="+url.QueryEscape(result.Data.FileURL)+"&name=reference.txt", nil)
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		res := httptest.NewRecorder()
		engine.ServeHTTP(res, req)
		return res
	}
	if res := download(ownerKey); res.Code != 200 || !bytes.Equal(res.Body.Bytes(), content) || !strings.Contains(res.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("download=%d %s", res.Code, res.Body.String())
	}
	if allowed, err := svc.ownsDownloadURL(context.Background(), admin.ID, result.Data.FileURL); err != nil || !allowed {
		t.Fatalf("ordinary admin inspection changed: %v %v", allowed, err)
	}
	if allowed, err := CanReadAssetURL(middleware.WithUserAPIKeyScope(context.Background()), db, store, admin.ID, result.Data.FileURL); err != nil || allowed {
		t.Fatalf("API worker inherited admin privilege: %v %v", allowed, err)
	}
	if res := download(adminKey); res.Code != 403 {
		t.Fatalf("admin API key could download another user's file: %d %s", res.Code, res.Body.String())
	}
	if res := download(""); res.Code != 401 {
		t.Fatalf("unauthenticated download=%d", res.Code)
	}
	row, _ := keys.Ensure(context.Background(), owner.ID)
	if _, err := keys.Change(context.Background(), owner.ID, row.Revision, false, false); err != nil {
		t.Fatal(err)
	}
	if res := download(ownerKey); res.Code != 401 {
		t.Fatal("disabled key could download")
	}
}
