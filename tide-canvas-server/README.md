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
configs/config.yaml        # shared base config (= test defaults)
configs/config.test.yaml   # test overlay (TIDECANVAS_ENV=test, default)
configs/config.prod.yaml   # prod overlay (TIDECANVAS_ENV=prod)
.env.example               # env override template (TIDECANVAS_* wins over yaml)
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

配置分三层加载，后者覆盖前者：

1. `configs/config.yaml` —— 共享底座（取值即测试环境默认）
2. `configs/config.<env>.yaml` —— 环境叠加，由 `TIDECANVAS_ENV` 选择：
   - `test`（缺省）→ `config.test.yaml`
   - `prod` → `config.prod.yaml`（生产占位值上线前必须替换）
3. 环境变量 —— `TIDECANVAS_` 前缀，点换下划线，永远优先

```bash
# 测试环境（缺省，等价于不设 TIDECANVAS_ENV）
go run ./cmd/api

# 生产环境（jwt.secret 缺失或为默认值时会拒绝启动）
TIDECANVAS_ENV=prod TIDECANVAS_JWT_SECRET=... go run ./cmd/api
```

| Setting            | Env var                          |
|--------------------|----------------------------------|
| （环境选择）        | `TIDECANVAS_ENV`                 |
| `server.port`      | `TIDECANVAS_SERVER_PORT`         |
| `mysql.password`   | `TIDECANVAS_MYSQL_PASSWORD`      |
| `redis.addr`       | `TIDECANVAS_REDIS_ADDR`          |
| `jwt.secret`       | `TIDECANVAS_JWT_SECRET`          |

> 生产环境密钥（JWT/MySQL/Redis/支付/Relay）一律走环境变量注入，
> 不要写进 `config.prod.yaml` 提交到仓库。
>
> 前端对应机制：`tide-canvas-web/.env.development`（`next dev` 加载）与
> `.env.production`（`next build` 加载）；Docker 构建时 `--build-arg
> NEXT_PUBLIC_API_BASE_URL=...` 优先级最高。
