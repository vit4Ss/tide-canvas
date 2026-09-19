package mcpconfig

import (
	"context"
	"errors"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
)

func settingsDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { pool.Close() })
	if err := db.AutoMigrate(&model.MCPSettings{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestDefaultsAndFirstSavePreserveDisabledFlags(t *testing.T) {
	db := settingsDB(t)
	ctx := context.Background()
	before, err := Read(ctx, db)
	if err != nil || !before.Enabled || before.Configured || before.Revision != 0 {
		t.Fatalf("defaults=%+v %v", before, err)
	}
	s := Defaults()
	s.Enabled = false
	s.ImageEnabled = false
	s.VideoEnabled = false
	s.AudioEnabled = false
	s.PublicURL = "https://mcp.example.test/mcp"
	s.AllowedOrigins = []string{"https://APP.example.test/", "https://app.example.test"}
	s.PollIntervalSeconds = 12
	after, err := Save(ctx, db, s, 0)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := Read(ctx, db)
	if err != nil || stored.Enabled || stored.ImageEnabled || stored.VideoEnabled || stored.AudioEnabled || !stored.Configured || stored.Revision != 1 || stored.PollIntervalSeconds != 12 {
		t.Fatalf("stored=%+v %v", stored, err)
	}
	if len(stored.AllowedOrigins) != 1 || after.AllowedOrigins[0] != "https://app.example.test" {
		t.Fatal("origins were not normalized")
	}
	if _, err := Save(ctx, db, Defaults(), 0); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale initial save=%v", err)
	}
	if _, err := Save(ctx, db, Defaults(), 1); err != nil {
		t.Fatal(err)
	}
	if _, err := Save(ctx, db, s, 1); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale update=%v", err)
	}
	current, _ := Read(ctx, db)
	if !current.Enabled || current.Revision != 2 {
		t.Fatal("stale writer changed policy")
	}
}

func TestInvalidConfigAndCorruptStorageFailClosed(t *testing.T) {
	for _, address := range []string{"https://user:secret@site.test/mcp", "https://site.test/mcp?key=secret", "https://site.test/mcp?", "javascript:alert(1)"} {
		s := Defaults()
		s.PublicURL = address
		if _, err := Normalize(s); err == nil {
			t.Fatalf("accepted %s", address)
		}
	}
	for _, origin := range []string{"*", "https://site.test/path", "https://site.test/#fragment"} {
		s := Defaults()
		s.AllowedOrigins = []string{origin}
		if _, err := Normalize(s); err == nil {
			t.Fatalf("accepted origin %s", origin)
		}
	}
	db := settingsDB(t)
	if _, err := Save(context.Background(), db, Defaults(), 0); err != nil {
		t.Fatal(err)
	}
	for _, payload := range []string{"null", "{}", `{"enabled":null}`, `broken-json`} {
		if err := db.Model(&model.MCPSettings{}).Where("id = 1").Update("payload", payload).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := Read(context.Background(), db); err == nil {
			t.Fatalf("corrupt policy silently enabled: %s", payload)
		}
	}
}

func TestOriginsUseBrowserCanonicalDefaultPortsAndDomains(t *testing.T) {
	s := Defaults()
	s.AllowedOrigins = []string{"https://APP.example.test:443/", "https://app.example.test", "http://LOCALHOST:80", "http://[::1]:80/", "https://例子.测试/"}
	got, err := Normalize(s)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"https://app.example.test", "http://localhost", "http://[::1]", "https://xn--fsqu00a.xn--0zwm56d"}
	if len(got.AllowedOrigins) != len(want) {
		t.Fatalf("origins=%v", got.AllowedOrigins)
	}
	for i := range want {
		if got.AllowedOrigins[i] != want[i] {
			t.Fatalf("origin=%q want=%q", got.AllowedOrigins[i], want[i])
		}
	}
	for _, bad := range []string{"https://*.example.test", "https://example.test:65536", "https://example.test:0", "https://example.test:"} {
		s := Defaults()
		s.AllowedOrigins = []string{bad}
		if _, err := Normalize(s); err == nil {
			t.Fatalf("invalid origin accepted: %s", bad)
		}
	}
}
