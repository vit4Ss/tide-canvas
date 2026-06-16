# TideCanvas Deployment

This production setup uses Docker Compose:

```text
Internet -> Caddy(80/443 HTTPS) -> frontend(Next.js :3000)
                                   -> /api/* proxy -> backend(Go :8080)
                                                      -> mysql/redis internal only
```

Backend now runs the Go service (`tide-canvas-go`) via `docker-compose.prod.yml`.
The previous Spring Boot stack is kept as `docker-compose.java.yml` for rollback;
both files share identical mysql/redis/frontend/caddy definitions, so running
either one only rebuilds the `backend` service.

The server only needs the Git repository and one `.env` file. Do not upload
local `application.yml`, `application-docker.yml`, or `.env.local`.

## 1. Prepare Server

Use Ubuntu 22.04+ or Debian 12+. Open ports `22`, `80`, and `443` in the cloud
security group.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://get.docker.com | sudo sh
docker compose version
```

Point your domain `A` record to the server public IP.

## 2. Clone Project

```bash
cd ~
git clone https://github.com/vit4Ss/tide-canvas.git
cd tide-canvas
```

## 3. Create `.env`

```bash
cp .env.prod.example .env
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
vim .env
```

Fill at least:

```env
SITE_ADDRESS=tide.tcmzhan.com
SITE_URL=https://tide.tcmzhan.com
MYSQL_ROOT_PASSWORD=<first random value>
JWT_SECRET=<second random value>
REDIS_PASSWORD=<third random value>
```

Without a domain, use this temporary HTTP-only setup:

```env
SITE_ADDRESS=:80
SITE_URL=http://<server-ip>
```

Optional services are also controlled in `.env`:

- SMTP: fill `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD`, etc.
- Aliyun OSS: set `STORAGE_KIND=oss` and fill `OSS_*`.
- OAuth: fill `GITHUB_*`, `GOOGLE_*`, or `WECHAT_*`.

## 4. Start

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

First build can take several minutes. MySQL initializes from
`tide-canvas-server/sql/init.sql` only when the database volume is empty.

## 5. Verify

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker logs tc-backend --tail 50
docker logs tc-frontend --tail 50
docker logs tc-caddy --tail 50
curl -I https://tide.tcmzhan.com
```

Backend is only bound to localhost on the server:

```bash
curl http://127.0.0.1:8080/api/orders/notify/epay
```

Returning `fail` is enough to prove the backend route is reachable.

## 6. After Launch

1. Log in with the initial admin account and change the password immediately:
   `admin / admin123`.
2. Configure payment in the admin settings.
   Notify URL:
   `https://your-domain/api/orders/notify/epay`
3. Test SMTP from the email template admin page.
4. Check recharge ratio and AI provider settings.

## 7. Update Deployment

```bash
cd ~/tide-canvas
git pull
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

If you changed OAuth client IDs or other `NEXT_PUBLIC_*` values, rebuild the
frontend as above because these values are baked at build time.

## 8. Backup Database

```bash
docker exec tc-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction tide_canvas' | gzip > backup_$(date +%F).sql.gz
```

## Notes

- `application.yml` and `application-docker.yml` are generated inside the
  backend Docker image from env-only sample files.
- Real local config files are ignored by Git and excluded from Docker build
  context.
- Keep `.env` private and never commit it.

## Rollback to the Java backend

The Java stack is preserved as `docker-compose.java.yml`. To switch back, just
bring it up — only the `backend` container is rebuilt, data volumes are untouched:

```bash
cd ~/tide-canvas
docker compose --env-file .env -f docker-compose.java.yml up -d --build
```
