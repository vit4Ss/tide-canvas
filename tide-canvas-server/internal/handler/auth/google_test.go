package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/googleauth"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/token"
)

func TestGoogleRequestBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newHandler(&service{google: config.GoogleConfig{ClientID: "fixture.apps.googleusercontent.com", AllowedOrigins: "http://localhost:3100, https://framelyn.example"}, rdb: redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})})
	defer h.svc.rdb.Close()
	for _, origin := range []string{"", "null", "https://framelyn.example.evil", "https://framelyn.example/path", "https://user@framelyn.example", "https://framelyn.example?test=1"} {
		if googleOriginAllowed(origin, h.svc.google.AllowedOrigins) {
			t.Fatalf("unsafe origin accepted: %s", origin)
		}
	}
	if !googleOriginAllowed("http://localhost:3100", h.svc.google.AllowedOrigins) {
		t.Fatal("development origin rejected")
	}
	router := gin.New()
	router.POST("/google", h.googleLogin)
	for _, tc := range []struct {
		origin, contentType, body string
		status                    int
	}{
		{"https://evil.example", "application/json", `{"credential":"fixture"}`, 403},
		{"http://localhost:3100", "application/x-www-form-urlencoded", "credential=fixture", 400},
		{"http://localhost:3100", "application/json", `{}`, 400},
		{"http://localhost:3100", "application/json", `{"credential":"fixture"}`, 400},
	} {
		req := httptest.NewRequest(http.MethodPost, "/google", strings.NewReader(tc.body))
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Content-Type", tc.contentType)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("request boundary: got %d want %d", res.Code, tc.status)
		}
	}
	if googleNonceKey(strings.Repeat("a", 43)) == googleNonceKey(strings.Repeat("b", 43)) {
		t.Fatal("nonce keys collide")
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "https://framelyn.example/api/auth/google", nil)
	setGoogleCookie(c, strings.Repeat("a", 43), strings.Repeat("a", 43), 300)
	if cookie := c.Writer.Header().Get("Set-Cookie"); !strings.Contains(cookie, "HttpOnly") || !strings.Contains(cookie, "Secure") || !strings.Contains(cookie, "SameSite=Strict") {
		t.Fatalf("cookie protections: %s", cookie)
	}
}

func googleTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite integration requires CGO; run this test on the deployment build environment")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.UserIdentity{}, &model.SysConfig{}, &model.SysRole{}, &model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestGoogleAccountLifecycle(t *testing.T) {
	db := googleTestDB(t)
	s := newService(db, nil, config.EmailConfig{})
	identity := &googleauth.Identity{RegisteredClaims: jwt.RegisteredClaims{Subject: "stable-subject"}, Email: "creator@gmail.com", EmailVerified: true, Name: "Creator"}
	first, err := s.resolveGoogleUser(context.Background(), identity, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	identity.Email = "changed@example.com"
	again, err := s.resolveGoogleUser(context.Background(), identity, 0, false)
	if err != nil || first.ID != again.ID || again.Email != "creator@gmail.com" {
		t.Fatalf("stable identity: %v", err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", first.ID).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.resolveGoogleUser(context.Background(), identity, 0, false); !errors.Is(err, errAccountDisabled) {
		t.Fatalf("disabled account: %v", err)
	}
	if err := db.Delete(first).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.resolveGoogleUser(context.Background(), identity, 0, false); !errors.Is(err, errAccountDisabled) {
		t.Fatalf("deleted account resurrected: %v", err)
	}
}

func TestGoogleAccountLinkingAndRegistrationGate(t *testing.T) {
	db := googleTestDB(t)
	s := newService(db, nil, config.EmailConfig{})
	u := &model.User{ID: idgen.Next(), Username: "existing", Email: "existing@example.com", Status: 1, Points: 42}
	if err := db.Create(u).Error; err != nil {
		t.Fatal(err)
	}
	identity := &googleauth.Identity{RegisteredClaims: jwt.RegisteredClaims{Subject: "new-subject"}, Email: u.Email, EmailVerified: true}
	if _, err := s.resolveGoogleUser(context.Background(), identity, 0, false); !errors.Is(err, errGoogleLinked) {
		t.Fatalf("silent email merge: %v", err)
	}
	if _, err := s.resolveGoogleUser(context.Background(), identity, u.ID+1, false); !errors.Is(err, errGoogleAccountChanged) {
		t.Fatalf("wrong owner proof: %v", err)
	}
	linked, err := s.resolveGoogleUser(context.Background(), identity, u.ID, false)
	if err != nil || linked.ID != u.ID || linked.Points != 42 {
		t.Fatalf("verified link: %v", err)
	}
	identity.Subject = "different-subject"
	if _, err := s.resolveGoogleUser(context.Background(), identity, u.ID, false); !errors.Is(err, errGoogleLinked) {
		t.Fatalf("identity overwritten: %v", err)
	}
	if err := db.Create(&model.SysConfig{ConfigKey: model.ConfigKeyRegisterClosed, ConfigValue: "true"}).Error; err != nil {
		t.Fatal(err)
	}
	identity.Email = "new@example.com"
	if _, err := s.resolveGoogleUser(context.Background(), identity, 0, false); !errors.Is(err, errRegisterClosed) {
		t.Fatalf("registration gate bypassed: %v", err)
	}
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count != 1 {
		t.Fatalf("unexpected accounts: %d", count)
	}
	bytes, err := json.Marshal(linked)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), "password") {
		t.Fatal("password leaked")
	}
}

type googleNonceHook struct {
	mu     sync.Mutex
	values map[string]string
}

func (h *googleNonceHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (h *googleNonceHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
func (h *googleNonceHook) ProcessHook(_ redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		h.mu.Lock()
		defer h.mu.Unlock()
		key := cmd.Args()[1].(string)
		switch cmd.Name() {
		case "set":
			h.values[key] = cmd.Args()[2].(string)
			cmd.(*redis.StatusCmd).SetVal("OK")
		case "get", "getdel":
			value, found := h.values[key]
			if !found {
				return redis.Nil
			}
			cmd.(*redis.StringCmd).SetVal(value)
			if cmd.Name() == "getdel" {
				delete(h.values, key)
			}
		default:
			return errors.New("unexpected Redis command in nonce test")
		}
		return nil
	}
}

func TestGoogleNonceSingleUse(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	defer client.Close()
	hook := &googleNonceHook{values: make(map[string]string)}
	client.AddHook(hook)
	s := &service{rdb: client, google: config.GoogleConfig{ClientID: "fixture.apps.googleusercontent.com", AllowedOrigins: "http://localhost:3100"}}
	h := newHandler(s)
	router := gin.New()
	router.POST("/challenge", h.googleChallenge)
	req := httptest.NewRequest("POST", "/challenge", strings.NewReader("{}"))
	req.Header.Set("Origin", "http://localhost:3100")
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatalf("challenge: %s", res.Body.String())
	}
	var body struct {
		Data struct {
			Nonce string `json:"nonce"`
		} `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	nonce := body.Data.Nonce
	if len(nonce) != 43 || res.Result().Cookies()[0].Value != nonce {
		t.Fatal("challenge is not bound to cookie")
	}
	if err := s.checkGoogleNonce(context.Background(), nonce, false); err != nil {
		t.Fatal(err)
	}
	var successful atomic.Int32
	var wait sync.WaitGroup
	for range 16 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if s.checkGoogleNonce(context.Background(), nonce, true) == nil {
				successful.Add(1)
			}
		}()
	}
	wait.Wait()
	if successful.Load() != 1 {
		t.Fatalf("nonce accepted %d times", successful.Load())
	}
	if err := s.checkGoogleNonce(context.Background(), nonce, false); !errors.Is(err, googleauth.ErrCredential) {
		t.Fatalf("replay accepted: %v", err)
	}
}

func TestGoogleNewEmailProofAndSignupReward(t *testing.T) {
	db := googleTestDB(t)
	s := newService(db, nil, config.EmailConfig{})
	if err := db.Create(&model.SysConfig{ConfigKey: "points.signupBonus", ConfigValue: "7"}).Error; err != nil {
		t.Fatal(err)
	}
	identity := &googleauth.Identity{RegisteredClaims: jwt.RegisteredClaims{Subject: "new-mail-subject"}, Email: "creator@example.com", EmailVerified: true}
	if _, err := s.resolveGoogleUser(context.Background(), identity, 0, false); !errors.Is(err, errGoogleEmailProof) {
		t.Fatalf("third-party email trusted without proof: %v", err)
	}
	u, err := s.resolveGoogleUser(context.Background(), identity, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	if u.Points != 7 {
		t.Fatalf("signup reward: %d", u.Points)
	}
	again, err := s.resolveGoogleUser(context.Background(), identity, 0, false)
	if err != nil || again.Points != 7 || again.ID != u.ID {
		t.Fatalf("repeat login changed reward/account: %v", err)
	}
	var count int64
	db.Model(&model.PointRecord{}).Count(&count)
	if count != 1 {
		t.Fatalf("signup ledger entries: %d", count)
	}
	// One account cannot silently acquire a second Google subject.
	identity.Subject = "rollback-subject"
	identity.Email = "rollback@gmail.com"
	if err := db.Create(&model.UserIdentity{ID: idgen.Next(), Provider: "google", Subject: identity.Subject, UserID: u.ID}).Error; err == nil {
		t.Fatal("provider/user uniqueness missing")
	}
	// Failure after user creation must roll back the account and its reward.
	injected := errors.New("identity insert failed")
	if err := db.Callback().Create().Before("gorm:create").Register("google_test_fail_identity", func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "user_identity" {
			tx.AddError(injected)
		}
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.resolveGoogleUser(context.Background(), identity, 0, false); !errors.Is(err, injected) {
		t.Fatalf("insert failure: %v", err)
	}
	db.Model(&model.User{}).Count(&count)
	if count != 1 {
		t.Fatalf("failed transaction left %d accounts", count)
	}
	db.Model(&model.PointRecord{}).Count(&count)
	if count != 1 {
		t.Fatalf("failed transaction granted a reward")
	}
}

func TestGoogleVerifiedAccountCannotBecomeNewAccount(t *testing.T) {
	db := googleTestDB(t)
	s := newService(db, nil, config.EmailConfig{})
	u := model.User{ID: idgen.Next(), Username: "original", Email: "original@gmail.com", Status: 1, Points: 42}
	if err := db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	identity := &googleauth.Identity{RegisteredClaims: jwt.RegisteredClaims{Subject: "fresh-google-subject"}, Email: u.Email, EmailVerified: true}
	// The email proof was for u.ID, but an administrator changed that account.
	if err := db.Model(&u).Update("email", "changed@gmail.com").Error; err != nil {
		t.Fatal(err)
	}
	if newUser, err := s.resolveGoogleUser(context.Background(), identity, u.ID, false); err == nil {
		t.Fatalf("verification for account %s created account %s", u.ID, newUser.ID)
	}
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count != 1 {
		t.Fatalf("verification created an unexpected account: %d", count)
	}
}

func TestGoogleChallengesDoNotOverwriteOtherTabs(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	defer client.Close()
	client.AddHook(&googleNonceHook{values: make(map[string]string)})
	h := newHandler(&service{rdb: client, google: config.GoogleConfig{ClientID: "fixture.apps.googleusercontent.com", AllowedOrigins: "http://localhost:3100"}})
	router := gin.New()
	router.POST("/challenge", h.googleChallenge)
	var cookies []*http.Cookie
	for range 2 {
		req := httptest.NewRequest("POST", "/challenge", strings.NewReader("{}"))
		req.Header.Set("Origin", "http://localhost:3100")
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != 200 {
			t.Fatalf("challenge: %s", res.Body.String())
		}
		cookies = append(cookies, res.Result().Cookies()[0])
	}
	if cookies[0].Name == cookies[1].Name {
		t.Fatal("a second tab overwrites the first tab's challenge cookie")
	}
}

type fixtureGoogleVerifier struct{}

func (fixtureGoogleVerifier) Verify(_ context.Context, credential, audience, nonce string) (*googleauth.Identity, error) {
	if credential != "fixture-credential" || audience != "fixture.apps.googleusercontent.com" {
		return nil, googleauth.ErrCredential
	}
	return &googleauth.Identity{RegisteredClaims: jwt.RegisteredClaims{Subject: "fixture-http-subject"}, Email: "fixture@gmail.com", EmailVerified: true, Name: "Fixture", Nonce: nonce}, nil
}

func TestGoogleHTTPLoginAndReplay(t *testing.T) {
	db := googleTestDB(t)
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	defer client.Close()
	client.AddHook(&googleNonceHook{values: make(map[string]string)})
	s := newService(db, client, config.EmailConfig{})
	s.google = config.GoogleConfig{ClientID: "fixture.apps.googleusercontent.com", AllowedOrigins: "http://localhost:3100"}
	s.googleVerifier = fixtureGoogleVerifier{}
	token.Init(config.JWTConfig{Secret: "fixture-only-secret", AccessTTL: time.Hour, RefreshTTL: time.Hour, Issuer: "fixture"}, client)
	h := newHandler(s)
	router := gin.New()
	router.POST("/api/auth/google/challenge", h.googleChallenge)
	router.POST("/api/auth/google", h.googleLogin)
	post := func(path string, body map[string]any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", path, strings.NewReader(string(data)))
		req.Header.Set("Origin", "http://localhost:3100")
		req.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	a := post("/api/auth/google/challenge", map[string]any{})
	b := post("/api/auth/google/challenge", map[string]any{})
	cookies := []*http.Cookie{a.Result().Cookies()[0], b.Result().Cookies()[0]}
	firstNonce, secondNonce := cookies[0].Value, cookies[1].Value
	// A cookie belonging to another challenge cannot authorize this one.
	wrong := post("/api/auth/google", map[string]any{"credential": "fixture-credential", "nonce": firstNonce}, cookies[1])
	if wrong.Code != 400 {
		t.Fatalf("foreign challenge accepted: %s", wrong.Body.String())
	}
	first := post("/api/auth/google", map[string]any{"credential": "fixture-credential", "nonce": firstNonce}, cookies...)
	if first.Code != 200 {
		t.Fatalf("login: %s", first.Body.String())
	}
	var firstBody struct {
		Data LoginVO `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	if firstBody.Data.AccessToken == "" || firstBody.Data.RefreshToken == "" || firstBody.Data.UserInfo.ID == 0 {
		t.Fatal("session response missing")
	}
	if deleted := first.Result().Cookies()[0]; deleted.Name != cookies[0].Name || deleted.MaxAge != -1 {
		t.Fatal("login cleared another tab's challenge")
	}
	replay := post("/api/auth/google", map[string]any{"credential": "fixture-credential", "nonce": firstNonce}, cookies...)
	if replay.Code != 400 {
		t.Fatalf("replay accepted: %s", replay.Body.String())
	}
	second := post("/api/auth/google", map[string]any{"credential": "fixture-credential", "nonce": secondNonce}, cookies...)
	if second.Code != 200 {
		t.Fatalf("second tab: %s", second.Body.String())
	}
	var secondBody struct {
		Data LoginVO `json:"data"`
	}
	_ = json.Unmarshal(second.Body.Bytes(), &secondBody)
	if firstBody.Data.UserInfo.ID != secondBody.Data.UserInfo.ID {
		t.Fatal("repeat login created another user")
	}
}
