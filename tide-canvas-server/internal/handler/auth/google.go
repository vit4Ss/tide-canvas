package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/googleauth"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"
)

const googleNonceCookie = "framelyn_google_nonce"
const googleNonceTTL = 5 * time.Minute

type googleCredentialVerifier interface {
	Verify(context.Context, string, string, string) (*googleauth.Identity, error)
}

var errGoogleLinked = errors.New("account already linked to another Google identity")
var errGoogleEmailProof = errors.New("Google email requires fresh ownership verification")
var errGoogleAccountChanged = errors.New("account changed during Google email verification")

type googleLoginDTO struct {
	Credential string `json:"credential" binding:"required,max=16384"`
	Nonce      string `json:"nonce" binding:"required,len=43"`
	Code       string `json:"code" binding:"omitempty,len=6,numeric"`
}

func googleOriginAllowed(origin, configured string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return false
	}
	for _, allowed := range strings.Split(configured, ",") {
		if strings.TrimSpace(allowed) == origin {
			return true
		}
	}
	return false
}

func (h *handler) allowGoogle(c *gin.Context) bool {
	c.Header("Cache-Control", "no-store")
	if strings.TrimSpace(h.svc.google.ClientID) == "" || h.svc.rdb == nil {
		googleUnavailable(c)
		return false
	}
	if !googleOriginAllowed(c.GetHeader("Origin"), h.svc.google.AllowedOrigins) {
		response.Fail(c, response.CodeForbidden, "Google sign-in is not enabled for this website.")
		return false
	}
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		response.Fail(c, response.CodeBadRequest, "Google sign-in requires a JSON request.")
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 20<<10)
	return true
}

func googleUnavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, response.Result[any]{Code: 503, Message: "Google sign-in is temporarily unavailable. Use your password or try again later.", Timestamp: time.Now().UnixMilli()})
}

func googleNonceKey(nonce string) string {
	digest := sha256.Sum256([]byte(nonce))
	return "auth:google:nonce:" + hex.EncodeToString(digest[:])
}

func googleNonceCookieName(nonce string) string {
	digest := sha256.Sum256([]byte(nonce))
	return googleNonceCookie + "_" + hex.EncodeToString(digest[:8])
}

func setGoogleCookie(c *gin.Context, nonce, value string, age int) {
	c.SetSameSite(http.SameSiteStrictMode)
	secure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetCookie(googleNonceCookieName(nonce), value, age, "/api/auth/google", "", secure, true)
}

// googleChallenge binds the Google ID token to an HttpOnly cookie on the
// frontend origin. Redis makes a successful exchange atomic and single use.
func (h *handler) googleChallenge(c *gin.Context) {
	if !h.allowGoogle(c) {
		return
	}
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		googleUnavailable(c)
		return
	}
	nonce := base64.RawURLEncoding.EncodeToString(bytes[:])
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	if err := h.svc.rdb.Set(ctx, googleNonceKey(nonce), "1", googleNonceTTL).Err(); err != nil {
		googleUnavailable(c)
		return
	}
	setGoogleCookie(c, nonce, nonce, int(googleNonceTTL.Seconds()))
	response.OK(c, gin.H{"clientId": strings.TrimSpace(h.svc.google.ClientID), "nonce": nonce, "expiresIn": int(googleNonceTTL.Seconds())})
}

func (s *service) checkGoogleNonce(ctx context.Context, nonce string, consume bool) error {
	if len(nonce) != 43 {
		return googleauth.ErrCredential
	}
	var value string
	var err error
	if consume {
		value, err = s.rdb.GetDel(ctx, googleNonceKey(nonce)).Result()
	} else {
		value, err = s.rdb.Get(ctx, googleNonceKey(nonce)).Result()
	}
	if errors.Is(err, redis.Nil) {
		return googleauth.ErrCredential
	}
	if err != nil {
		return googleauth.ErrUnavailable
	}
	if value != "1" {
		return googleauth.ErrCredential
	}
	return nil
}

func (h *handler) googleLogin(c *gin.Context) {
	if !h.allowGoogle(c) {
		return
	}
	var dto googleLoginDTO
	if c.ShouldBindJSON(&dto) != nil {
		response.Fail(c, 400, "Invalid Google sign-in request.")
		return
	}
	nonce, err := c.Cookie(googleNonceCookieName(dto.Nonce))
	if err != nil || len(nonce) != 43 || subtle.ConstantTimeCompare([]byte(nonce), []byte(dto.Nonce)) != 1 {
		response.Fail(c, 400, "Google sign-in expired. Please try again.")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	if err = h.svc.checkGoogleNonce(ctx, nonce, false); err != nil {
		h.googleFailure(c, err)
		return
	}
	identity, err := h.svc.googleVerifier.Verify(ctx, dto.Credential, strings.TrimSpace(h.svc.google.ClientID), nonce)
	if err != nil {
		h.googleFailure(c, err)
		return
	}
	// An existing email is not sufficient proof to attach a provider identity.
	// Keep the challenge alive while the account owner verifies an email code.
	_, bound, err := h.svc.findGoogleUser(ctx, identity.Subject)
	if err != nil {
		h.googleFailure(c, err)
		return
	}
	var verifiedUserID idgen.ID
	verifiedNewEmail := false
	if !bound {
		var existing model.User
		err = h.svc.repo.db.WithContext(ctx).Where("LOWER(email) = ?", identity.Email).First(&existing).Error
		if err == nil {
			if existing.Status == 0 {
				h.googleFailure(c, errAccountDisabled)
				return
			}
			if dto.Code == "" {
				googleEmailChallenge(c, identity.Email, true)
				return
			}
			if err = h.svc.verifyEmailCode(ctx, identity.Email, dto.Code); err != nil {
				h.googleFailure(c, err)
				return
			}
			verifiedUserID = existing.ID
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			h.googleFailure(c, err)
			return
		} else {
			if h.svc.registerClosed() {
				h.googleFailure(c, errRegisterClosed)
				return
			}
			if !identity.EmailIsAuthoritative() {
				if dto.Code == "" {
					googleEmailChallenge(c, identity.Email, false)
					return
				}
				if err = h.svc.verifyEmailCode(ctx, identity.Email, dto.Code); err != nil {
					h.googleFailure(c, err)
					return
				}
				verifiedNewEmail = true
			}
		}
	}
	if err = h.svc.checkGoogleNonce(ctx, nonce, true); err != nil {
		h.googleFailure(c, err)
		return
	}
	setGoogleCookie(c, nonce, "", -1)
	u, err := h.svc.resolveGoogleUser(ctx, identity, verifiedUserID, verifiedNewEmail)
	if err != nil {
		h.googleFailure(c, err)
		return
	}
	access, refresh, expiresIn, err := token.Issue(u.ID, u.Role)
	if err != nil {
		h.googleFailure(c, err)
		return
	}
	now := time.Now()
	_ = h.svc.repo.updateFields(u.ID, map[string]any{"last_login_time": now})
	u.LastLoginTime = now
	logAuth(c, u.ID, u.Email, "login", "google", nil)
	response.OK(c, LoginVO{AccessToken: access, RefreshToken: refresh, ExpiresIn: expiresIn, UserInfo: toUserVO(u, model.MenusForUser(h.svc.repo.db, u), model.AdminPermsForUser(h.svc.repo.db, u))})
}

func googleEmailChallenge(c *gin.Context, email string, existing bool) {
	message := "Verify your email to create your account."
	if existing {
		message = "Verify your email to link Google to your existing account."
	}
	c.JSON(http.StatusConflict, response.Result[any]{Code: 409, Message: message, Data: gin.H{"requiresLink": true, "email": email, "existingAccount": existing}, Timestamp: time.Now().UnixMilli()})
}

func (h *handler) googleFailure(c *gin.Context, err error) {
	switch {
	case errors.Is(err, googleauth.ErrUnavailable):
		googleUnavailable(c)
	case errors.Is(err, googleauth.ErrCredential):
		response.Fail(c, 400, "Google sign-in expired or could not be verified. Please try again.")
	case errors.Is(err, errAccountDisabled):
		response.Fail(c, 403, "This account is disabled. Contact support.")
	case errors.Is(err, errRegisterClosed):
		response.Fail(c, 403, "Registration is currently closed. Existing users can still sign in.")
	case errors.Is(err, errBadCode):
		response.Fail(c, 400, "The verification code is incorrect or expired.")
	case errors.Is(err, errGoogleLinked):
		response.Fail(c, 409, "This account is linked to a different Google account. Sign in with your password.")
	case errors.Is(err, errGoogleEmailProof):
		response.Fail(c, 400, "Verify your email address before creating your account. Please start Google sign-in again.")
	case errors.Is(err, errGoogleAccountChanged):
		response.Fail(c, 409, "Your account changed during verification. Please start Google sign-in again.")
	default:
		response.Fail(c, 500, "Google account sign-in failed")
	}
}

func (s *service) findGoogleUser(ctx context.Context, subject string) (*model.User, bool, error) {
	var binding model.UserIdentity
	db := s.repo.db.WithContext(ctx)
	err := db.Where("provider = ? AND subject = ?", "google", subject).First(&binding).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var u model.User
	if err := db.First(&u, "id = ?", binding.UserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, true, errAccountDisabled
		}
		return nil, true, err
	}
	if u.Status == 0 {
		return nil, true, errAccountDisabled
	}
	return &u, true, nil
}

// resolveGoogleUser rechecks identity and account state inside the transaction.
// User creation, identity binding and the signup grant commit together.
func (s *service) resolveGoogleUser(ctx context.Context, identity *googleauth.Identity, verifiedUserID idgen.ID, verifiedNewEmail bool) (*model.User, error) {
	var user *model.User
	err := s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inner := &service{repo: newRepo(tx)}
		existing, bound, err := inner.findGoogleUser(ctx, identity.Subject)
		if err != nil {
			return err
		}
		if bound {
			user = existing
			return nil
		}
		if verifiedUserID != 0 {
			var verified model.User
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&verified, "id = ?", verifiedUserID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errGoogleAccountChanged
				}
				return err
			}
			if verified.Status == 0 {
				return errAccountDisabled
			}
			if !strings.EqualFold(verified.Email, identity.Email) {
				return errGoogleAccountChanged
			}
		}
		var u model.User
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("LOWER(email) = ?", identity.Email).First(&u).Error
		created := false
		if err == nil {
			if u.Status == 0 {
				return errAccountDisabled
			}
			if verifiedUserID != u.ID {
				return errGoogleLinked
			}
			var linked int64
			if err := tx.Model(&model.UserIdentity{}).Where("provider = ? AND user_id = ?", "google", u.ID).Count(&linked).Error; err != nil {
				return err
			}
			if linked > 0 {
				return errGoogleLinked
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			if inner.registerClosed() {
				return errRegisterClosed
			}
			if !identity.EmailIsAuthoritative() && !verifiedNewEmail {
				return errGoogleEmailProof
			}
			var secret [32]byte
			if _, err := rand.Read(secret[:]); err != nil {
				return err
			}
			hash, err := bcrypt.GenerateFromPassword([]byte(base64.RawURLEncoding.EncodeToString(secret[:])), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			id := idgen.Next()
			name := []rune(strings.TrimSpace(identity.Name))
			if len(name) > 64 {
				name = name[:64]
			}
			if len(name) == 0 {
				name = []rune("Creator")
			}
			avatar := ""
			if parsed, err := url.Parse(identity.Picture); err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && len(identity.Picture) <= 512 {
				avatar = identity.Picture
			}
			u = model.User{ID: id, Username: "g_" + id.String(), Email: identity.Email, Nickname: string(name), Avatar: avatar, PasswordHash: string(hash), Role: 0, RoleID: model.RoleIDByCode(tx, model.RoleCodeUser), Status: 1, LastLoginTime: time.Now()}
			if err := tx.Create(&u).Error; err != nil {
				return err
			}
			created = true
		} else {
			return err
		}
		binding := model.UserIdentity{ID: idgen.Next(), Provider: "google", Subject: identity.Subject, UserID: u.ID}
		if err := tx.Create(&binding).Error; err != nil {
			return err
		}
		if created {
			granted, err := points.GrantSignup(tx, u.ID)
			if err != nil {
				return err
			}
			u.Points += int64(granted)
		}
		user = &u
		return nil
	})
	return user, err
}
