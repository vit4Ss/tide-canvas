// Package userkey owns default per-user integration credentials. These keys
// identify a main-site account; they are not upstream apirouter credentials.
package userkey

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

const Prefix = "tc_sk_"

var (
	ErrInvalid  = errors.New("invalid integration credential")
	ErrAccount  = errors.New("account is unavailable")
	ErrConflict = errors.New("credential has changed; reload before editing")
	ErrVault    = errors.New("integration credential cannot be decrypted")
)

type Service struct {
	db   *gorm.DB
	aead cipher.AEAD
}

func New(db *gorm.DB, secret string) (*Service, error) {
	if db == nil || strings.TrimSpace(secret) == "" {
		return nil, errors.New("integration credential storage is not configured")
	}
	key := sha256.Sum256([]byte("tidecanvas:user-api-key:v1:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Service{db: db, aead: aead}, nil
}

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (s *Service) generate(uid idgen.ID) (*model.UserAPIKey, error) {
	if uid == 0 {
		return nil, ErrAccount
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	value := Prefix + base64.RawURLEncoding.EncodeToString(secret)
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	sealed := s.aead.Seal(nonce, nonce, []byte(value), []byte(uid.String()))
	return &model.UserAPIKey{
		UserID: uid, KeyHash: digest(value), Revision: 1,
		Ciphertext: "v1:" + base64.RawStdEncoding.EncodeToString(sealed),
		Hint:       value[:len(Prefix)+6] + "••••••••" + value[len(value)-4:],
	}, nil
}

// Ensure is idempotent across concurrent requests and replicas. It never
// rotates or enables an existing key, including one explicitly disabled.
func (s *Service) Ensure(ctx context.Context, uid idgen.ID) (*model.UserAPIKey, error) {
	if uid == 0 {
		return nil, ErrAccount
	}
	db := s.db.WithContext(ctx)
	var owner model.User
	if err := db.Select("id").First(&owner, "id = ?", uid).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAccount
		}
		return nil, err
	}
	var existing model.UserAPIKey
	if err := db.First(&existing, "user_id = ?", uid).Error; err == nil {
		return &existing, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	row, err := s.generate(uid)
	if err != nil {
		return nil, err
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error; err != nil {
		return nil, err
	}
	// Always reload the winner. A losing concurrent creator must never hand out
	// the random secret that it generated but did not persist.
	if err := db.First(&existing, "user_id = ?", uid).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

func (s *Service) ActiveOwner(ctx context.Context, uid idgen.ID) (*model.User, error) {
	var owner model.User
	if err := s.db.WithContext(ctx).First(&owner, "id = ? AND status = 1", uid).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAccount
		}
		return nil, err
	}
	return &owner, nil
}

// Reveal is used only after owner authentication, never by list/login responses.
func (s *Service) Reveal(ctx context.Context, uid idgen.ID, revision uint64) (string, error) {
	if _, err := s.ActiveOwner(ctx, uid); err != nil {
		return "", err
	}
	row, err := s.Ensure(ctx, uid)
	if err != nil {
		return "", err
	}
	if revision != row.Revision {
		return "", ErrConflict
	}
	if !strings.HasPrefix(row.Ciphertext, "v1:") {
		return "", ErrVault
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(row.Ciphertext, "v1:"))
	if err != nil || len(raw) < s.aead.NonceSize() {
		return "", ErrVault
	}
	plain, err := s.aead.Open(nil, raw[:s.aead.NonceSize()], raw[s.aead.NonceSize():], []byte(uid.String()))
	if err != nil || digest(string(plain)) != row.KeyHash {
		return "", ErrVault
	}
	return string(plain), nil
}

// Change uses an optimistic revision fence, so a retry or stale browser cannot
// silently replace a key twice or re-enable one changed in another session.
func (s *Service) Change(ctx context.Context, uid idgen.ID, revision uint64, rotate bool, enabled bool) (*model.UserAPIKey, error) {
	if _, err := s.ActiveOwner(ctx, uid); err != nil {
		return nil, err
	}
	if _, err := s.Ensure(ctx, uid); err != nil {
		return nil, err
	}
	updates := map[string]any{"revision": gorm.Expr("revision + 1"), "update_time": time.Now()}
	if rotate {
		next, err := s.generate(uid)
		if err != nil {
			return nil, err
		}
		updates["key_hash"], updates["ciphertext"], updates["hint"] = next.KeyHash, next.Ciphertext, next.Hint
		// Rotation preserves the enabled/disabled state.
	} else {
		updates["disabled_at"] = nil
		if !enabled {
			updates["disabled_at"] = time.Now()
		}
	}
	result := s.db.WithContext(ctx).Model(&model.UserAPIKey{}).Where("user_id = ? AND revision = ?", uid, revision).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrConflict
	}
	return s.Ensure(ctx, uid)
}

// Authenticate looks up the owner on every call. Account deletion/disablement
// and key rotation/disablement apply to subsequent requests immediately.
func (s *Service) Authenticate(ctx context.Context, value string) (*model.User, error) {
	if !strings.HasPrefix(value, Prefix) || len(value) != len(Prefix)+43 {
		return nil, ErrInvalid
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, Prefix))
	if err != nil || len(decoded) != 32 {
		return nil, ErrInvalid
	}
	var owner model.User
	err = s.db.WithContext(ctx).Model(&model.User{}).
		Joins("JOIN user_api_key ON user_api_key.user_id = users.id").
		Where("user_api_key.key_hash = ? AND user_api_key.disabled_at IS NULL AND users.status = 1", digest(value)).
		First(&owner).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrInvalid
	}
	if err != nil {
		return nil, err
	}
	return &owner, nil
}
