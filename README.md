# Tide Canvas / Flowlight

Flowlight consists of a Next.js frontend, a Go API, MySQL, and Redis.

## Start locally with Docker

Prerequisite: Docker Engine or Docker Desktop with Docker Compose v2.

```bash
cp .env.example .env
docker compose up --build -d --wait
```

After all health checks pass:

- Web: http://localhost:3000
- API health: http://localhost:8080/healthz

Useful commands:

```bash
docker compose ps
docker compose logs -f backend frontend
docker compose down
```

`docker compose down` preserves MySQL, Redis, and uploaded-file volumes. Do not
use `down -v` unless deleting local data is intentional.

The root composition is local-only: mail, payments, and cloud storage are
disabled, and all published ports bind to `127.0.0.1`.

## Native development

Required runtimes:

- Node.js 22
- Go 1.24
- MySQL 8
- Redis 7

Start only MySQL and Redis:

```bash
cd tide-canvas-server
docker compose up -d --wait
```

Then follow [the server guide](tide-canvas-server/README.md) and run the web app:

```bash
cd tide-canvas-web
npm ci
npm run dev
```

## `flowlight-20260809` preview pipeline

`.github/workflows/flowlight-preview.yml` listens to pushes on
`flowlight-20260809` and performs:

1. frontend type checking, linting, and production build;
2. backend tests and binary build;
3. frontend/backend image publishing to GHCR;
4. optional preview deployment through Docker over SSH.

The pipeline publishes two immutable namespaces without overwriting production
`latest`:

- `ghcr.io/<owner>/tide-canvas-frontend:flowlight-20260809`
- `ghcr.io/<owner>/tide-canvas-backend:flowlight-20260809`
- both images also receive `flowlight-20260809-sha-<commit>` tags.

Automatic deployment is disabled until the repository variable
`FLOWLIGHT_PREVIEW_AUTO_DEPLOY=true` is configured. A manual workflow run can
also select `deploy_preview`.

Create a GitHub Environment named `flowlight-preview` with these required
secrets:

- `PREVIEW_DOCKER_HOST`: for example `ssh://deploy@example.com:22`
- `PREVIEW_SSH_PRIVATE_KEY`
- `PREVIEW_SSH_KNOWN_HOSTS`
- `PREVIEW_MYSQL_ROOT_PASSWORD`
- `PREVIEW_JWT_SECRET`

Optional integration secrets:

- `PREVIEW_RELAY_API_KEY`
- `PREVIEW_STORAGE_ACCESS_KEY`
- `PREVIEW_STORAGE_SECRET_KEY`

Optional Environment variables and their defaults are documented in
`deploy/flowlight-preview.env.example`. The remote account must be able to use
Docker, and the host must have Docker Engine installed. The deployment binds
the frontend and backend to loopback ports by default, so a host Nginx/Traefik
proxy remains the public TLS entry point.

## Manual preview deployment

```bash
cp deploy/flowlight-preview.env.example deploy/flowlight-preview.env
# Replace every required placeholder, then:
docker login ghcr.io
docker compose \
  --env-file deploy/flowlight-preview.env \
  -f deploy/compose.flowlight-preview.yaml \
  up -d --pull always --wait
```

## Security

- Never commit `.env` files or real credentials.
- Production/test credentials must be injected through protected environment
  variables or a secret manager.
- Mail, payments, and OSS are disabled unless explicitly enabled.
- Credentials that have ever appeared in Git history must be rotated; deleting
  them from the current branch does not revoke them.
