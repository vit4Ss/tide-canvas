package chatgateway

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"time"

	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/chatupstream"
)

// service is the OpenAI-compatible chat gateway behind /api/integrations/v1.
// It resolves a model to the provider the operator configured under
// 「AI 聊天供应商」, calls that provider with the operator's credential, and
// bills the calling account by token usage. Clients — Codex, an SDK, curl —
// authenticate with their own account API key, so the provider's credentials
// never leave this server and every call lands on the right user's points.
type service struct {
	d   *app.Deps
	cfg config.ChatGatewayConfig
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
		return nil, errors.New("the chat gateway requires the user API key service")
	}
	cfg := d.Cfg.ChatGateway
	if cfg.MaxConcurrent < 1 {
		cfg.MaxConcurrent = 2
	}
	if cfg.DailyLimit < 0 {
		return nil, errors.New("chat gateway daily limit cannot be negative")
	}
	// The same dial policy model discovery uses (see chatupstream.NewTransport):
	// an address behaves the same in the admin page and in a conversation.
	upstreamTransport := chatupstream.NewTransport()
	upstreamTransport.ResponseHeaderTimeout = 15 * time.Minute
	return &service{d: d, cfg: cfg, upstreams: chatupstream.New(d.Cfg.JWT.Secret),
		upstream: &http.Client{Transport: upstreamTransport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
