# Tide Canvas Server

Go backend for Tide Canvas. Module path: `tidecanvas`. Go 1.23.

## Architecture

```
cmd/api/main.go            # entrypoint: config -> mysql+redis -> migrate -> gin -> /api -> serve
internal/
  app/                     # Deps container (DB, RDB, Cfg, Storage)
  config/                  # viper Config + Load()
  db/                      # GORM mysql open/pool + Migrate()
  middleware/              # CORS, RequestID, Recovery, ZapLogger, JWTAuth, AdminOnly, RateLimit
  model/                   # GORM entities + AutoMigrate()
  handler/
    auth/    (Register)    # /api/auth/*    (authored next phase)
    project/ (Register)    # /api/projects/*
    ai/      (Register)    # /api/ai/*
    file/    (Register)    # /api/files/*
    stub/    (Register)    # placeholder/fallback routes
  pkg/
    response/              # Result/PageData envelope + OK/Page/Fail + codes
    idgen/                 # snowflake ID type (JSON string) + Next/Parse/InitNode
    token/                 # JWT Issue/ParseAccess/ParseRefresh + redis refresh store/blacklist
    cache/                 # go-redis v9 client + key builders
    storage/               # StorageStrategy + LocalStorage (+ presign stub)
    logger/                # zap global logger
configs/config.yaml        # local defaults (env overrides via TIDECANVAS_*)
.env.example               # env override template
```

Each domain package under `internal/handler/<domain>` owns its own
handler + service + repo + dto + vo, and exposes
`func Register(api *gin.RouterGroup, d *app.Deps)`. There is intentionally no
shared dto/vo package (avoids cross-domain name collisions).

## Response envelope (authoritative, matches the frontend contract)

```json
{ "success": true, "code": 200, "message": "success", "data": {}, "timestamp": 1700000000000 }
```

- All IDs serialize as JSON **strings** (snowflake via `idgen.ID`).
- Auth failures put `code: 401` in the JSON **body** (HTTP status also 401); the
  frontend triggers a token refresh on body `code === 401`.
- Business codes (1xxx/2xxx/3xxx) are returned with HTTP 200.

## Prerequisites

- Go 1.23+
- MySQL 8.x with a database named `tidecanvas`
- Redis 6+

## Setup & run

```bash
# 1. resolve dependencies (creates go.sum)
go mod tidy

# 2. configure datastores
#    edit configs/config.yaml, or copy .env.example -> .env and export the vars
#    (env vars use the TIDECANVAS_ prefix, e.g. TIDECANVAS_MYSQL_PASSWORD)
mysql -e "CREATE DATABASE IF NOT EXISTS tidecanvas CHARACTER SET utf8mb4;"

# 3. run (AutoMigrate runs on startup)
go run ./cmd/api
```

Server listens on `:8080` by default (`server.port`). The Next.js dev origin
`http://localhost:3000` is allowed via CORS (`cors.allowOrigins`).

Health check: `GET /healthz`.

## Configuration

`configs/config.yaml` holds defaults. Override any value with an environment
variable using the `TIDECANVAS_` prefix and underscores for dots, e.g.:

| Setting            | Env var                          |
|--------------------|----------------------------------|
| `server.port`      | `TIDECANVAS_SERVER_PORT`         |
| `mysql.password`   | `TIDECANVAS_MYSQL_PASSWORD`      |
| `redis.addr`       | `TIDECANVAS_REDIS_ADDR`          |
| `jwt.secret`       | `TIDECANVAS_JWT_SECRET`          |

> Always override `jwt.secret` outside local development.
