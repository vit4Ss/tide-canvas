package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlog "gorm.io/gorm/logger"

	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/token"
	"tidecanvas/internal/pkg/userkey"
)

func TestOwnerKeyLifecycleAndAuthenticationBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:integration-keys?mode=memory&cache=shared"), &gorm.Config{Logger: gormlog.Default.LogMode(gormlog.Silent), SkipDefaultTransaction: true, PrepareStmt: true})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	defer pool.Close()
	if err := db.AutoMigrate(&model.User{}, &model.UserAPIKey{}); err != nil {
		t.Fatal(err)
	}
	keys, err := userkey.New(db, "test-only-secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := keys.Install(); err != nil {
		t.Fatal(err)
	}
	u := model.User{ID: idgen.Next(), Username: "owner", Email: "owner@example.test", Status: 1, Role: 9, Points: 57}
	other := model.User{ID: idgen.Next(), Username: "other", Email: "other@example.test", Status: 1}
	if err := db.Create(&[]model.User{u, other}).Error; err != nil {
		t.Fatal(err)
	}
	token.Init(config.JWTConfig{Secret: "jwt-test-only"}, nil)
	jwt, _, _, err := token.Issue(u.ID, u.Role)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	api := r.Group("/api")
	Register(api, &app.Deps{DB: db, UserKeys: keys})
	api.GET("/integrations/test-role", middleware.UserAPIKeyAuth(keys), func(c *gin.Context) { c.JSON(200, gin.H{"role": middleware.CurrentRole(c)}) })
	request := func(method, path, credential, body string) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var payload map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return w, payload
	}
	_, unauthorized := request("GET", "/api/auth/api-key", "", "")
	if unauthorized["code"] != float64(401) {
		t.Fatal("anonymous key access allowed")
	}
	w, metadata := request("GET", "/api/auth/api-key", jwt, "")
	if metadata["success"] != true || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("metadata failed or was cacheable")
	}
	data := metadata["data"].(map[string]any)
	if len(data) != 6 || data["key"] != nil || data["ciphertext"] != nil || data["keyHash"] != nil {
		t.Fatal("metadata exposed secret fields")
	}
	_, revealed := request("POST", "/api/auth/api-key/reveal", jwt, fmt.Sprintf(`{"revision":1,"userId":"%s"}`, other.ID))
	value := revealed["data"].(map[string]any)["key"].(string)
	for _, operation := range []struct{ method, path, body string }{
		{"GET", "/api/auth/api-key", ""},
		{"POST", "/api/auth/api-key/reveal", `{"revision":1}`},
		{"POST", "/api/auth/api-key/rotate", `{"revision":1}`},
		{"PUT", "/api/auth/api-key/status", `{"revision":1,"enabled":false}`},
	} {
		_, mismatch := request(operation.method, operation.path+"?accountId="+other.ID.String(), jwt, operation.body)
		if mismatch["code"] != float64(409) || mismatch["data"] != nil {
			t.Fatal("account-change fence allowed a mismatched request")
		}
	}
	w, identity := request("GET", "/api/integrations/identity", value, "")
	if w.Code != http.StatusOK || identity["userId"] != u.ID.String() || identity["points"] != float64(57) {
		t.Fatal("key mapped to wrong user")
	}
	_, keyCannotManage := request("GET", "/api/auth/api-key", value, "")
	if keyCannotManage["code"] != float64(401) {
		t.Fatal("API key was accepted as a login session")
	}
	w, _ = request("GET", "/api/integrations/identity", jwt, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatal("login token was accepted as an integration key")
	}
	_, role := request("GET", "/api/integrations/test-role", value, "")
	if role["role"] != float64(0) {
		t.Fatal("API key inherited administrator privileges")
	}
	_, rotated := request("POST", "/api/auth/api-key/rotate", jwt, `{"revision":1}`)
	if rotated["success"] != true {
		t.Fatal("rotation failed")
	}
	w, _ = request("GET", "/api/integrations/identity", value, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatal("old key survived rotation")
	}
	_, stale := request("POST", "/api/auth/api-key/rotate", jwt, `{"revision":1}`)
	if stale["code"] != float64(409) {
		t.Fatal("retried rotation changed the key a second time")
	}
	_, revealed = request("POST", "/api/auth/api-key/reveal", jwt, `{"revision":2}`)
	value = revealed["data"].(map[string]any)["key"].(string)
	_, disabled := request("PUT", "/api/auth/api-key/status", jwt, `{"revision":2,"enabled":false}`)
	if disabled["success"] != true {
		t.Fatal("disable failed")
	}
	w, _ = request("GET", "/api/integrations/identity", value, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatal("disabled key was accepted")
	}
	_, _ = request("PUT", "/api/auth/api-key/status", jwt, `{"revision":3,"enabled":true}`)
	db.Model(&u).Update("status", 0)
	_, disabledOwner := request("POST", "/api/auth/api-key/reveal", jwt, `{"revision":4}`)
	if disabledOwner["code"] != float64(403) {
		t.Fatal("disabled account could reveal a key")
	}
	w, _ = request("GET", "/api/integrations/identity", value, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatal("disabled account authenticated with a key")
	}
	// Errors in the credential store must fail closed, never fall back to a
	// shared upstream credential or an anonymous account.
	db.Migrator().DropTable(&model.UserAPIKey{})
	w, _ = request("GET", "/api/integrations/identity", value, "")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatal("store failure did not fail closed")
	}
}
