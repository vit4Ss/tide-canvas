package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/token"
)

func TestMCPConfigRequiresAdminConfigPermissionAndRejectsStaleWrites(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	defer pool.Close()
	if err := db.AutoMigrate(&model.MCPSettings{}, &model.User{}, &model.SysRole{}); err != nil {
		t.Fatal(err)
	}
	for _, u := range []model.User{{ID: 83001, Username: "mcp-admin", Email: "mcp-admin@test", Role: 9, Status: 1}, {ID: 83002, Username: "mcp-user", Email: "mcp-user@test", Status: 1}} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
	}
	token.Init(config.JWTConfig{Secret: "mcp-admin-test-secret", Issuer: "test"}, nil)
	adminKey, _, _, err := token.Issue(83001, 9)
	if err != nil {
		t.Fatal(err)
	}
	userKey, _, _, err := token.Issue(83002, 0)
	if err != nil {
		t.Fatal(err)
	}
	d := &app.Deps{DB: db}
	r := gin.New()
	RegisterMCP(r.Group("/api/admin", middleware.JWTAuth(d), middleware.AdminAccess(d), middleware.AdminPerm("admin.config")), d)
	request := func(method, key, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/admin/mcp", strings.NewReader(body))
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	if request("GET", "", "").Code != 401 || request("GET", userKey, "").Code != 403 || request("GET", "tc_sk_not_a_login_token", "").Code != 401 {
		t.Fatal("unauthorized config access")
	}
	if out := request("GET", adminKey, ""); out.Code != 200 || !strings.Contains(out.Body.String(), `"enabled":true`) {
		t.Fatalf("read=%s", out.Body.String())
	}
	body := `{"revision":0,"enabled":false,"imageEnabled":true,"videoEnabled":false,"audioEnabled":true,"publicUrl":"https://mcp.test/mcp","allowedOrigins":[],"pollIntervalSeconds":10}`
	if out := request("PUT", adminKey, body); out.Code != 200 || !strings.Contains(out.Body.String(), `"enabled":false`) {
		t.Fatalf("save=%s", out.Body.String())
	}
	if out := request("PUT", adminKey, body); out.Code != 409 {
		t.Fatalf("stale write=%s", out.Body.String())
	}
	for _, invalid := range []string{`{}`, body + `{}`, strings.Replace(body, `"revision":0`, `"revision":1,"unknown":true`, 1)} {
		if request("PUT", adminKey, invalid).Code != 400 {
			t.Fatalf("invalid payload accepted: %s", invalid)
		}
	}
	if err := db.Model(&model.User{}).Where("id = ?", 83001).Update("role", 0).Error; err != nil {
		t.Fatal(err)
	}
	if out := request("GET", adminKey, ""); out.Code != 403 {
		t.Fatalf("demoted administrator still accepted with old token: %d", out.Code)
	}
	if err := db.Model(&model.User{}).Where("id = ?", 83001).Updates(map[string]any{"role": 9, "status": 0}).Error; err != nil {
		t.Fatal(err)
	}
	if out := request("PUT", adminKey, strings.Replace(body, `"revision":0`, `"revision":1`, 1)); out.Code != 403 {
		t.Fatalf("disabled administrator still accepted: %d", out.Code)
	}
	role := model.SysRole{Name: "MCP config operator", Code: "mcp-test-operator", Status: 1, Permissions: `["admin.config"]`}
	if err := db.Create(&role).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", 83002).Update("role_id", role.ID).Error; err != nil {
		t.Fatal(err)
	}
	middleware.InvalidateAdminPermsCache()
	if out := request("GET", userKey, ""); out.Code != 200 {
		t.Fatalf("active delegated config permission was rejected: %d", out.Code)
	}
	if err := db.Model(&role).Update("permissions", `["admin.models"]`).Error; err != nil {
		t.Fatal(err)
	}
	// Do not invalidate the parent middleware cache: this verifies the MCP
	// guard rejects permission revocation even with a stale positive cache.
	if out := request("GET", userKey, ""); out.Code != 403 {
		t.Fatalf("revoked config permission was cached: %d", out.Code)
	}
	middleware.InvalidateAdminPermsCache()
}

func TestMCPProbeChecksServiceIdentityAndDoesNotFollowRedirects(t *testing.T) {
	var secretHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secretHeader = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "service": "flowlight-mcp", "version": "1.1.0", "adminConfig": true, "policyAvailable": true, "policyRevision": 3})
	}))
	defer server.Close()
	status := probeMCP(context.Background(), server.URL)
	if !status.Reachable || !status.AdminConfig || status.PolicyRevision != 3 || secretHeader != "" {
		t.Fatalf("status=%+v", status)
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, server.URL, 302) }))
	defer redirect.Close()
	if status := probeMCP(context.Background(), redirect.URL); status.Reachable {
		t.Fatal("probe followed redirect")
	}
	if status := probeMCP(context.Background(), "http://user:secret@localhost"); status.Reachable || strings.Contains(status.InternalURL, "secret") {
		t.Fatal("invalid probe URL leaked a credential")
	}
}
