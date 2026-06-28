// Command reseed wipes the community demo data and re-runs community.Seed with
// the current seed set (placeholder covers + demo authors). One-off dev utility:
//
//	go run ./cmd/reseed
//
// It only touches the community tables (post + like/comment/bookmark), all of
// which hold seed data in this project (there is no user publish-to-plaza flow),
// so the wipe is safe. Demo author users are find-or-created by community.Seed.
package main

import (
	"fmt"
	"os"

	"tidecanvas/internal/config"
	"tidecanvas/internal/db"
	"tidecanvas/internal/handler/community"
	"tidecanvas/internal/handler/inspiration"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "reseed:", err)
		os.Exit(1)
	}
	fmt.Println("reseed: done")
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	// Use a DIFFERENT snowflake node than the running api (node 1) so concurrently
	// generated ids can never collide while the server is up.
	if err := idgen.InitNode(2); err != nil {
		return fmt.Errorf("init id: %w", err)
	}
	gdb, err := db.Open(cfg.MySQL)
	if err != nil {
		return fmt.Errorf("open mysql: %w", err)
	}
	if err := gdb.AutoMigrate(&model.PostBookmark{}); err != nil {
		return fmt.Errorf("ensure bookmark table: %w", err)
	}

	// Clear existing community + inspiration demo data so the fuller seed set lands.
	// All of these hold demo / admin-curation rows (no user-generated content).
	for _, m := range []any{
		&model.PostLike{}, &model.PostComment{}, &model.PostBookmark{}, &model.CommunityPost{},
		&model.PromptLib{}, &model.Collection{},
	} {
		// Unscoped → a real DELETE (these models embed gorm.DeletedAt, so a plain
		// Delete would only soft-delete and accumulate orphaned rows on re-runs).
		if err := gdb.Unscoped().Where("1 = 1").Delete(m).Error; err != nil {
			return fmt.Errorf("clear table: %w", err)
		}
	}
	fmt.Println("reseed: cleared community + inspiration tables")

	if err := community.Seed(gdb); err != nil {
		return fmt.Errorf("seed community: %w", err)
	}
	if err := inspiration.Seed(gdb); err != nil {
		return fmt.Errorf("seed inspiration: %w", err)
	}
	var n, p, col int64
	gdb.Model(&model.CommunityPost{}).Count(&n)
	gdb.Model(&model.PromptLib{}).Count(&p)
	gdb.Model(&model.Collection{}).Count(&col)
	fmt.Printf("reseed: %d posts, %d prompts, %d collections\n", n, p, col)
	return nil
}
