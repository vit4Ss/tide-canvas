package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/cache"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/mailer"
	"tidecanvas/internal/pkg/token"
)

// service.go holds the auth business logic: email verification codes, account
// registration, login (username|email|phone), JWT issuance with refresh
// rotation, logout (blacklist + refresh revocation) and profile/password
// updates. bcrypt hashes passwords; Redis stores email codes & the refresh
// store via the token package.

// Sentinel errors mapped to business codes by the handler.
var (
	errUsernameExists  = errors.New("auth: username already exists")
	errEmailExists     = errors.New("auth: email already registered")
	errBadCredentials  = errors.New("auth: incorrect account or password")
	errBadCode         = errors.New("auth: invalid or expired verification code")
	errAccountDisabled = errors.New("auth: account disabled")
	errPasswordWrong   = errors.New("auth: incorrect current password")

	// errRateLimited is returned when the per-IP send cap or the per-email
	// resend cooldown is hit. The handler maps it to HTTP/body code 429.
	errRateLimited = errors.New("auth: too many requests")
	// errSendFailed is returned when SMTP delivery fails. The cooldown is NOT
	// set in this case so the user can retry immediately.
	errSendFailed = errors.New("auth: failed to send verification email")
)

type service struct {
	repo  *repo
	rdb   *redis.Client
	email config.EmailConfig
}

func newService(db *gorm.DB, rdb *redis.Client, email config.EmailConfig) *service {
	return &service{repo: newRepo(db), rdb: rdb, email: email}
}

// emailCode generates, stores and sends a verification code for the given email,
// enforcing a per-IP send cap and a per-email resend cooldown. To avoid leaking
// which addresses are registered, the handler always reports generic success;
// only throttle and send failures surface as errors.
//
// Flow:
//  1. Per-IP cap: INCR auth:emailcode:ip:{ip}; on the first hit set the window
//     TTL. If the counter exceeds SendCodeIPLimit -> errRateLimited.
//  2. Per-email cooldown: if auth:emailcode:cooldown:{email} exists ->
//     errRateLimited.
//  3. Generate a CodeLength-digit code, store at cache.EmailCodeKey(email) with
//     CodeTTLSeconds TTL, and reset the failed-attempts counter.
//  4. Send via SMTP when enabled; on send error -> errSendFailed (no cooldown).
//     When disabled, log the code (dev fallback) and succeed.
//  5. On success, set the resend cooldown with ResendCooldownSeconds TTL.
func (s *service) emailCode(ctx context.Context, email, ip string) error {
	cfg := s.email

	if s.rdb != nil {
		// 1) Per-IP send cap (fixed window via INCR + first-hit EXPIRE).
		if strings.TrimSpace(ip) != "" {
			ipKey := cache.EmailCodeIPKey(ip)
			n, err := s.rdb.Incr(ctx, ipKey).Result()
			if err != nil {
				return err
			}
			if n == 1 {
				_ = s.rdb.Expire(ctx, ipKey, time.Duration(cfg.SendCodeIPWindowSeconds)*time.Second).Err()
			}
			if n > int64(cfg.SendCodeIPLimit) {
				return errRateLimited
			}
		}

		// 2) Per-email resend cooldown.
		cooldownKey := cache.EmailCodeCooldownKey(email)
		exists, err := s.rdb.Exists(ctx, cooldownKey).Result()
		if err != nil {
			return err
		}
		if exists > 0 {
			return errRateLimited
		}
	}

	code := genCode(cfg.CodeLength)

	if s.rdb != nil {
		// 3) Store the code and reset the attempt counter for this email.
		if err := s.rdb.Set(ctx, cache.EmailCodeKey(email), code, time.Duration(cfg.CodeTTLSeconds)*time.Second).Err(); err != nil {
			return err
		}
		_ = s.rdb.Del(ctx, cache.EmailCodeAttemptsKey(email)).Err()
	}

	// 4) Deliver. Real SMTP when enabled; otherwise log for local testing.
	if cfg.Enabled {
		if err := mailer.SendVerificationCode(email, code); err != nil {
			logger.L().Error("email verification code send failed",
				zap.String("email", email),
				zap.Error(err),
			)
			// Do not set the cooldown when sending failed so the user can retry.
			return errSendFailed
		}
	} else {
		// Dev fallback: surface the code in the server log when SMTP is off.
		logger.L().Info("email verification code issued (smtp disabled, dev fallback)",
			zap.String("email", email),
			zap.String("code", code),
		)
	}

	// 5) Arm the resend cooldown after a successful send.
	if s.rdb != nil {
		_ = s.rdb.Set(ctx, cache.EmailCodeCooldownKey(email), "1", time.Duration(cfg.ResendCooldownSeconds)*time.Second).Err()
	}

	return nil
}

// verifyEmailCode checks the submitted code against the stored one and consumes
// it on success. If Redis is unavailable, verification is skipped (dev mode).
//
// On mismatch the per-email attempt counter is incremented; once it reaches
// MaxAttempts the code key is deleted so the code is invalidated until a new one
// is requested. On a successful match both the code and attempt keys are removed.
func (s *service) verifyEmailCode(ctx context.Context, email, code string) error {
	if s.rdb == nil {
		return nil
	}
	key := cache.EmailCodeKey(email)
	stored, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return errBadCode
		}
		return err
	}
	if stored == "" || stored != code {
		// Count the failed attempt; invalidate the code once the cap is reached.
		attemptsKey := cache.EmailCodeAttemptsKey(email)
		n, aerr := s.rdb.Incr(ctx, attemptsKey).Result()
		if aerr == nil {
			if n == 1 {
				// Bound the attempt counter's lifetime to the code's TTL so it
				// self-cleans even if the code is never matched.
				_ = s.rdb.Expire(ctx, attemptsKey, time.Duration(s.email.CodeTTLSeconds)*time.Second).Err()
			}
			if n >= int64(s.email.MaxAttempts) {
				_ = s.rdb.Del(ctx, key).Err()
				_ = s.rdb.Del(ctx, attemptsKey).Err()
			}
		}
		return errBadCode
	}
	// Success: consume the code and clear the attempt counter.
	_ = s.rdb.Del(ctx, key).Err()
	_ = s.rdb.Del(ctx, cache.EmailCodeAttemptsKey(email)).Err()
	return nil
}

// register creates a new account after verifying the email code, then returns
// the created user's VO.
func (s *service) register(ctx context.Context, dto RegisterDTO) (*UserVO, error) {
	email := strings.TrimSpace(strings.ToLower(dto.Email))

	if err := s.verifyEmailCode(ctx, email, dto.Code); err != nil {
		return nil, err
	}

	username := strings.TrimSpace(dto.Username)
	if username == "" {
		username = deriveUsername(email)
	}

	if exists, err := s.repo.existsUsername(username); err != nil {
		return nil, err
	} else if exists {
		return nil, errUsernameExists
	}
	if exists, err := s.repo.existsEmail(email); err != nil {
		return nil, err
	} else if exists {
		return nil, errEmailExists
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(dto.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	nickname := strings.TrimSpace(dto.Nickname)
	if nickname == "" {
		nickname = username
	}

	now := time.Now()
	u := &model.User{
		ID:            idgen.Next(),
		Username:      username,
		Email:         email,
		Phone:         strings.TrimSpace(dto.Phone),
		Nickname:      nickname,
		PasswordHash:  string(hash),
		Role:          0,
		Status:        1,
		LastLoginTime: now,
	}
	if err := s.repo.create(u); err != nil {
		return nil, err
	}

	vo := toUserVO(u, 1)
	return &vo, nil
}

// login authenticates by account+password and issues a token pair.
func (s *service) login(ctx context.Context, dto LoginDTO) (*LoginVO, error) {
	u, err := s.repo.findByAccount(strings.TrimSpace(dto.Account))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, errBadCredentials
		}
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(dto.Password)) != nil {
		return nil, errBadCredentials
	}
	if u.Status == 0 {
		return nil, errAccountDisabled
	}

	access, refresh, expiresIn, err := token.Issue(u.ID, u.Role)
	if err != nil {
		return nil, err
	}

	// Best-effort last-login bookkeeping; failure must not block login.
	now := time.Now()
	_ = s.repo.updateFields(u.ID, map[string]any{"last_login_time": now})
	u.LastLoginTime = now

	factor, _ := s.repo.teamPriceFactor(u.TeamID)
	return &LoginVO{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    expiresIn,
		UserInfo:     toUserVO(u, factor),
	}, nil
}

// loginCode authenticates by email + verification code, creating the account on
// first use (passwordless login-or-create), then issues a token pair. The code
// is validated against and consumed from the same Redis key the email-code
// endpoint writes (cache.EmailCodeKey).
func (s *service) loginCode(ctx context.Context, dto LoginCodeDTO) (*LoginVO, error) {
	email := strings.TrimSpace(strings.ToLower(dto.Email))

	if err := s.verifyEmailCode(ctx, email, dto.Code); err != nil {
		return nil, err
	}

	u, err := s.repo.findByAccount(email)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		// First-time login: create the account.
		u, err = s.createCodeUser(email)
		if err != nil {
			return nil, err
		}
	}
	if u.Status == 0 {
		return nil, errAccountDisabled
	}

	access, refresh, expiresIn, err := token.Issue(u.ID, u.Role)
	if err != nil {
		return nil, err
	}

	// Best-effort last-login bookkeeping; failure must not block login.
	now := time.Now()
	_ = s.repo.updateFields(u.ID, map[string]any{"last_login_time": now})
	u.LastLoginTime = now

	factor, _ := s.repo.teamPriceFactor(u.TeamID)
	return &LoginVO{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    expiresIn,
		UserInfo:     toUserVO(u, factor),
	}, nil
}

// createCodeUser provisions a new passwordless account for an email. The
// password hash is derived from a random secret so the row is never usable for
// password login; defaults mirror a fresh registration.
func (s *service) createCodeUser(email string) (*model.User, error) {
	username := deriveUsername(email)

	// Random, unrecoverable password so this account can only authenticate via
	// the email-code flow.
	hash, err := bcrypt.GenerateFromPassword([]byte(genCode(16)+genCode(16)+email), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	u := &model.User{
		ID:            idgen.Next(),
		Username:      username,
		Email:         email,
		Nickname:      username,
		PasswordHash:  string(hash),
		Role:          0,
		Status:        1,
		LastLoginTime: now,
	}
	if err := s.repo.create(u); err != nil {
		return nil, err
	}
	return u, nil
}

// refresh validates a refresh token, rotates it (old one revoked, new pair
// issued) and returns the new tokens.
func (s *service) refresh(refreshToken string) (*RefreshVO, error) {
	claims, err := token.ParseRefresh(refreshToken)
	if err != nil {
		return nil, err
	}

	access, newRefresh, expiresIn, err := token.Issue(claims.UserID, claims.Role)
	if err != nil {
		return nil, err
	}

	// Rotation: revoke the consumed refresh JTI so it cannot be replayed.
	_ = token.RevokeRefresh(claims.UserID, claims.JTI)

	return &RefreshVO{
		AccessToken:  access,
		RefreshToken: newRefresh,
		ExpiresIn:    expiresIn,
	}, nil
}

// logout blacklists the current access token and clears all refresh tokens for
// the user so every session is invalidated.
func (s *service) logout(uid idgen.ID, jti string, accessTTL time.Duration) error {
	if jti != "" {
		_ = token.RevokeAccess(jti, accessTTL)
	}
	return token.RevokeAllRefresh(uid)
}

// me returns the current user's VO.
func (s *service) me(uid idgen.ID) (*UserVO, error) {
	u, err := s.repo.findByID(uid)
	if err != nil {
		return nil, err
	}
	factor, _ := s.repo.teamPriceFactor(u.TeamID)
	vo := toUserVO(u, factor)
	return &vo, nil
}

// updateProfile applies nickname/phone changes and returns the fresh VO.
func (s *service) updateProfile(uid idgen.ID, dto UpdateProfileDTO) (*UserVO, error) {
	fields := map[string]any{}
	if dto.Nickname != nil {
		fields["nickname"] = strings.TrimSpace(*dto.Nickname)
	}
	if dto.Phone != nil {
		fields["phone"] = strings.TrimSpace(*dto.Phone)
	}
	if len(fields) > 0 {
		if err := s.repo.updateFields(uid, fields); err != nil {
			return nil, err
		}
	}
	return s.me(uid)
}

// updatePassword verifies the old password then stores a new bcrypt hash.
func (s *service) updatePassword(uid idgen.ID, dto UpdatePasswordDTO) error {
	u, err := s.repo.findByID(uid)
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(dto.OldPassword)) != nil {
		return errPasswordWrong
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(dto.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.repo.updateFields(uid, map[string]any{"password_hash": string(hash)})
}

// deriveUsername builds a username from an email local-part, sanitized.
func deriveUsername(email string) string {
	local := email
	if i := strings.IndexByte(email, '@'); i > 0 {
		local = email[:i]
	}
	local = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			return r
		default:
			return -1
		}
	}, local)
	if local == "" {
		local = "user"
	}
	// Append a short unique suffix to avoid collisions on common local-parts.
	suffix := idgen.Next().String()
	if len(suffix) > 4 {
		suffix = suffix[len(suffix)-4:]
	}
	return local + "_" + suffix
}

// genCode returns a numeric verification code of the requested length. A
// non-positive length falls back to 6 digits.
func genCode(length int) string {
	if length <= 0 {
		length = 6
	}
	const digits = "0123456789"
	b := make([]byte, length)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		if err != nil {
			// Extremely unlikely; fall back to a fixed digit.
			b[i] = digits[0]
			continue
		}
		b[i] = digits[n.Int64()]
	}
	return string(b)
}
