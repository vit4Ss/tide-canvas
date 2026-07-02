// Command api is the Tide Canvas backend entrypoint.
//
// Boot sequence: load config -> init logger/idgen -> open MySQL (+AutoMigrate)
// and Redis -> build storage -> assemble the Deps container -> configure gin
// (global middleware, /healthz, static files, /api domain routes, NoRoute
// fallback) -> serve with graceful shutdown.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/db"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/cache"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/mailer"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/storage"
	"tidecanvas/internal/pkg/token"

	"tidecanvas/internal/handler/admin"
	"tidecanvas/internal/handler/ai"
	"tidecanvas/internal/handler/auth"
	"tidecanvas/internal/handler/billing"
	"tidecanvas/internal/handler/chat"
	"tidecanvas/internal/handler/community"
	"tidecanvas/internal/handler/content"
	"tidecanvas/internal/handler/file"
	"tidecanvas/internal/handler/inspiration"
	"tidecanvas/internal/handler/market"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/handler/project"
	"tidecanvas/internal/handler/stub"
)

func main() {
	if err := run(); err != nil {
		logger.L().Error("server exited with error", zap.Error(err))
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	// 1. Config.
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	development := !strings.EqualFold(cfg.Server.Mode, "release")
	logger.Init(development)
	defer logger.Sync()

	if err := idgen.InitNode(1); err != nil {
		return fmt.Errorf("init id generator: %w", err)
	}

	// 2. Datastores.
	gdb, err := db.Open(cfg.MySQL)
	if err != nil {
		return fmt.Errorf("open mysql: %w", err)
	}
	if err := db.Migrate(gdb); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	logger.L().Info("mysql connected & migrated")

	// Demo/bootstrap seed: populate the 作品广场 / 灵感 (and a default admin author)
	// when their tables are empty, so a fresh DB renders content without a manual
	// `go run ./cmd/reseed`. Auto-runs outside release mode; force in release with
	// TIDECANVAS_SEED_DEMO=1. Each seed is idempotent (skips when its data exists)
	// and best-effort (a failure is logged, never blocks startup).
	if development || isTruthy(os.Getenv("TIDECANVAS_SEED_DEMO")) {
		if err := model.Seed(gdb); err != nil {
			logger.L().Warn("seed: admin", zap.Error(err))
		}
		if err := community.Seed(gdb); err != nil {
			logger.L().Warn("seed: community", zap.Error(err))
		}
		if err := inspiration.Seed(gdb); err != nil {
			logger.L().Warn("seed: inspiration", zap.Error(err))
		}
		if err := billing.Seed(gdb); err != nil {
			logger.L().Warn("seed: billing", zap.Error(err))
		}
	}

	// Start the async audit-log writer (access / login / business / model-call).
	eventlog.Init(gdb)

	rdb, err := cache.New(cfg.Redis)
	if err != nil {
		return fmt.Errorf("open redis: %w", err)
	}
	logger.L().Info("redis connected")

	// Token: configure JWT signing (secret/TTLs) and the Redis-backed refresh
	// store/blacklist. Must run before any token is issued or parsed.
	token.Init(cfg.JWT, rdb)

	// 3. Storage. Settings are overlaid from sys_config (admin 配置管理-editable,
	// seeded from the file/env config on first boot); changes apply on restart.
	storageCfg, err := storage.SeedAndLoadConfig(gdb, cfg.Storage)
	if err != nil {
		return fmt.Errorf("load storage config: %w", err)
	}
	store, err := storage.New(storageCfg)
	if err != nil {
		// A bad (admin-edited) OSS config must not brick startup — degrade to local
		// so the server boots and the config can be corrected via the admin UI.
		logger.L().Warn("storage init failed; falling back to local", zap.Error(err))
		storageCfg.Type = "local"
		if store, err = storage.New(storageCfg); err != nil {
			return fmt.Errorf("init storage: %w", err)
		}
	}
	cfg.Storage = storageCfg
	logger.L().Info("storage initialized", zap.String("type", store.Type()))

	// BUG-2: Reference-based generation requires publicly fetchable reference URLs.
	// Under local storage, reference assets are served from localhost, which the
	// overseas relay cannot reach — so image_to_image / image_to_video /
	// first_last_frame / multi_ref operations will fail. Warn loudly so OSS gets
	// enabled in production.
	if !strings.EqualFold(store.Type(), "oss") && strings.TrimSpace(cfg.Relay.APIKey) != "" {
		logger.L().Warn("local storage with relay configured: reference-based generation " +
			"(image_to_image / image_to_video / first_last_frame / multi_ref) will FAIL because " +
			"the overseas relay cannot fetch localhost-hosted reference URLs; enable OSS in production")
	}

	// Mailer: register SMTP config so verification emails can be sent.
	mailer.Init(cfg.Email)

	deps := &app.Deps{DB: gdb, RDB: rdb, Cfg: cfg, Storage: store}

	// 4. HTTP engine.
	switch strings.ToLower(cfg.Server.Mode) {
	case "release":
		gin.SetMode(gin.ReleaseMode)
	case "test":
		gin.SetMode(gin.TestMode)
	default:
		gin.SetMode(gin.DebugMode)
	}

	r := gin.New()
	r.Use(
		middleware.RequestID(),
		middleware.Recovery(),
		middleware.ZapLogger(),
		middleware.AccessLog(),
		middleware.CORS(deps),
	)

	// Liveness probe.
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Serve locally-stored uploads under /static (matches storage.publicURL).
	if strings.EqualFold(cfg.Storage.Type, "local") || cfg.Storage.Type == "" {
		dir := cfg.Storage.LocalDir
		if dir == "" {
			dir = "./data/uploads"
		}
		r.Static("/static", dir)
	}

	// 5. Domain routes under /api.
	api := r.Group("/api")
	stub.Register(api, deps)
	auth.Register(api, deps)
	project.Register(api, deps)
	ai.Register(api, deps)
	file.Register(api, deps)
	chat.Register(api, deps)
	community.Register(api, deps)
	inspiration.Register(api, deps)
	content.Register(api, deps)
	points.Register(api, deps)
	billing.Register(api, deps)
	market.Register(api, deps)
	admin.Register(api, deps)

	// Unmatched paths return the standard 404 envelope.
	r.NoRoute(func(c *gin.Context) {
		response.Fail(c, response.CodeNotFound, "route not found")
	})

	// 6. Serve with graceful shutdown.
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	if cfg.Server.Port == 0 {
		addr = ":8080"
	}
	srv := &http.Server{Addr: addr, Handler: r}

	go func() {
		logger.L().Info("server listening", zap.String("addr", addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.L().Error("listen", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.L().Info("shutting down server")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	return nil
}

// isTruthy reports whether an env value means "on".
func isTruthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
