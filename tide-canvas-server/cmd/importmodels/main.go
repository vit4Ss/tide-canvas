// Command importmodels is a headless wrapper around the admin relay sync: it
// pulls the ScarecrowToken relay catalog (GET /v1/models) and upserts it into
// market_model. The admin 模型管理「刷新」button does the same via HTTP; this CLI
// is for ops/headless runs. Mapping rules live in handler/admin/relay_sync.go.
package main

import (
	"flag"
	"fmt"
	"os"

	"tidecanvas/internal/config"
	"tidecanvas/internal/db"
	"tidecanvas/internal/handler/admin"
	"tidecanvas/internal/model"
)

func main() {
	base := flag.String("base", "", "relay base URL (default: config relay.baseUrl)")
	key := flag.String("key", "", "relay API key (default: config relay.apiKey)")
	status := flag.Int("status", 1, "status for newly created rows (1 已上架 / 0 待审核 / 2 已下架)")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "load config:", err)
		os.Exit(1)
	}
	baseURL := *base
	if baseURL == "" {
		baseURL = cfg.Relay.BaseURL
	}
	apiKey := *key
	if apiKey == "" {
		apiKey = cfg.Relay.APIKey
	}
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "no relay api key (pass -key or set relay.apiKey in config)")
		os.Exit(2)
	}

	gdb, err := db.Open(cfg.MySQL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "open mysql:", err)
		os.Exit(1)
	}

	// Resolve an author: prefer a seeded admin (role 9), else any user, else 0.
	var author model.User
	if err := gdb.Select("id").Where("role = ?", 9).Order("id ASC").First(&author).Error; err != nil {
		_ = gdb.Select("id").Order("id ASC").First(&author).Error
	}

	res, err := admin.SyncRelayModels(gdb, baseURL, apiKey, *status, author.ID)
	if err != nil {
		fmt.Fprintln(os.Stderr, "sync:", err)
		os.Exit(1)
	}
	fmt.Printf("done: created=%d updated=%d total=%d\n", res.Created, res.Updated, res.Total)
}
