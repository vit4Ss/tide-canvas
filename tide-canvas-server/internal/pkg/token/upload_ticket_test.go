package token

import (
	"errors"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/idgen"
)

func TestUploadTicketBindsExactFileMetadata(t *testing.T) {
	Init(config.JWTConfig{Secret: "upload-ticket-test-secret", Issuer: "upload-ticket-test"}, nil)
	const uid idgen.ID = 9201
	hash := strings.Repeat("ab", 32)
	ticket, err := IssueUploadTicket(uid, "clip.mp4", "video/mp4", "video", "general", 1234, hash, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ParseUploadTicket(ticket)
	if err != nil || claims.UserID != uid || claims.Name != "clip.mp4" || claims.Size != 1234 || claims.SHA256 != hash || claims.FileType != "video" {
		t.Fatalf("claims=%+v err=%v", claims, err)
	}
	if _, err := ParseDownloadTicket(ticket, "https://example.test/clip.mp4", "clip.mp4"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("upload ticket accepted as download ticket: %v", err)
	}
}
