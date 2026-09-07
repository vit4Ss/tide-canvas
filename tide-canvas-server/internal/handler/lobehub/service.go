package lobehub

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/chatupstream"
	"tidecanvas/internal/pkg/idgen"
)

var errGrant = errors.New("expired or invalid authorization")
var errMapping = errors.New("account mapping conflict")
var errBindingBusy = errors.New("account configuration is already being synchronized")
var errLobeLogin = errors.New("LobeHub login required")
var errLobeUnavailable = errors.New("LobeHub identity service unavailable")

type service struct {
	d          *app.Deps
	cfg        config.LobeHubConfig
	signer     *rsa.PrivateKey
	kid        string
	http       *http.Client
	mainOrigin string
	// Seals the third-party credentials this site calls upstream with. Keyed off
	// the JWT secret, like the user key vault.
	upstreams chatupstream.Vault
	// The client that talks to the third-party providers. One per service, not
	// one per call: a fresh transport each time would redo the TCP and TLS
	// handshake for every message the user sends. The long header timeout is
	// for reasoning models, which can think for minutes before the first token.
	upstream *http.Client
	// When each address last had a success written down. A healthy address is
	// used on every call, and writing "still fine" each time would put a DB
	// write on the hot path for a timestamp nobody reads that precisely.
	okWritten sync.Map // idgen.ID -> time.Time
}

func newService(d *app.Deps) (*service, error) {
	if d.UserKeys == nil {
		return nil, errors.New("LobeHub requires the user API key service")
	}
	cfg := d.Cfg.LobeHub
	if cfg.MaxConcurrent < 1 {
		cfg.MaxConcurrent = 2
	}
	if cfg.DailyLimit < 0 {
		return nil, errors.New("LobeHub daily limit cannot be negative")
	}
	for _, raw := range []string{cfg.PublicURL, cfg.IssuerURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
			(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
			return nil, errors.New("LobeHub requires valid HTTPS public and issuer URLs")
		}
	}
	cfg.PublicURL = strings.TrimRight(cfg.PublicURL, "/")
	cfg.IssuerURL = strings.TrimRight(cfg.IssuerURL, "/")
	public, _ := url.Parse(cfg.PublicURL)
	if public.Path != "" {
		return nil, errors.New("LobeHub public URL must be an origin")
	}
	issuer, _ := url.Parse(cfg.IssuerURL)
	if issuer.Path != "/api/lobehub/oidc" {
		return nil, errors.New("LobeHub issuer must end with /api/lobehub/oidc")
	}
	if cfg.InternalURL == "" {
		cfg.InternalURL = cfg.PublicURL
	}
	internal, err := url.Parse(cfg.InternalURL)
	if err != nil || internal.Host == "" || (internal.Path != "" && internal.Path != "/") || internal.User != nil || internal.RawQuery != "" || internal.Fragment != "" || (internal.Scheme != "https" && internal.Scheme != "http") {
		return nil, errors.New("invalid LobeHub internal origin")
	}
	cfg.InternalURL = strings.TrimRight(cfg.InternalURL, "/")
	if len(cfg.ClientSecret) < 32 || cfg.ClientID == "" {
		return nil, errors.New("LobeHub client credentials are required")
	}
	raw, err := os.ReadFile(cfg.SigningKeyFile)
	if err != nil {
		return nil, errors.New("LobeHub signing key is unavailable")
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("invalid LobeHub signing key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	}
	if err != nil {
		return nil, errors.New("invalid LobeHub signing key")
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok || rsaKey.N.BitLen() < 2048 {
		return nil, errors.New("LobeHub signing key must be RSA 2048 or stronger")
	}
	pub, _ := x509.MarshalPKIXPublicKey(&rsaKey.PublicKey)
	digest := sha256.Sum256(pub)
	// The same dial policy model discovery uses (see chatupstream.NewTransport):
	// an address behaves the same in the admin page and in a conversation.
	upstreamTransport := chatupstream.NewTransport()
	upstreamTransport.ResponseHeaderTimeout = 15 * time.Minute
	return &service{d: d, cfg: cfg, signer: rsaKey, kid: hex.EncodeToString(digest[:12]), mainOrigin: issuer.Scheme + "://" + issuer.Host, upstreams: chatupstream.New(d.Cfg.JWT.Secret),
		upstream: &http.Client{Transport: upstreamTransport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		http:     &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func randomHandle() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b), err
}
func (s *service) putGrant(db *gorm.DB, kind string, uid idgen.ID, payload any, ttl time.Duration) (string, error) {
	value, err := randomHandle()
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	row := model.LobeHubGrant{Hash: hash(value), Kind: kind, UserID: uid, Payload: string(raw), ExpiresAt: time.Now().Add(ttl)}
	return value, db.Create(&row).Error
}
func (s *service) grant(ctx context.Context, kind, value string) (*model.LobeHubGrant, error) {
	if len(value) != 43 {
		return nil, errGrant
	}
	var row model.LobeHubGrant
	err := s.d.DB.WithContext(ctx).Where("hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?", hash(value), kind, time.Now()).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errGrant
	}
	return &row, err
}
func consume(db *gorm.DB, row *model.LobeHubGrant) error {
	now := time.Now()
	result := db.Model(&model.LobeHubGrant{}).Where("hash = ? AND consumed_at IS NULL AND expires_at > ?", row.Hash, now).Update("consumed_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errGrant
	}
	return nil
}
func (s *service) active(ctx context.Context, uid idgen.ID) (*model.User, error) {
	return s.d.UserKeys.ActiveOwner(ctx, uid)
}
