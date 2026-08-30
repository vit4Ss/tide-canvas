package token

import (
	"errors"
	"testing"
	"time"

	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/idgen"
)

func TestDownloadTicketIsShortLivedAndBoundToOneFile(t *testing.T) {
	Init(config.JWTConfig{Secret: "download-ticket-test-secret", Issuer: "ticket-test"}, nil)
	const uid idgen.ID = 9101
	const raw = "https://cdn.example.com/gen/song.mp3?sign=abc"
	const name = "歌曲.mp3"
	ticket, err := IssueDownloadTicket(uid, 0, raw, name, time.Minute)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	claims, err := ParseDownloadTicket(ticket, raw, name)
	if err != nil || claims.UserID != uid {
		t.Fatalf("parse = (%+v, %v)", claims, err)
	}
	if _, err := ParseDownloadTicket(ticket, raw+"&other=1", name); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("retargeted URL error = %v, want invalid token", err)
	}
	if _, err := ParseDownloadTicket(ticket, raw, "other.mp3"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("retargeted name error = %v, want invalid token", err)
	}
}
