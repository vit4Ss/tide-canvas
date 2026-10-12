# 海外前端镜像与部署

推送 `flowlight-en` 分支后，GitHub Actions 自动检查代码、构建镜像，并用**同一个镜像**验证测试和生产配置，验证通过才发布到 GHCR：

```text
ghcr.io/vit4ss/tide-canvas-frontend-en:latest
ghcr.io/vit4ss/tide-canvas-frontend-en:flowlight-en
ghcr.io/vit4ss/tide-canvas-frontend-en:sha-完整提交SHA
```

镜像只包含海外前端，使用现有 FlowLight 后端。容器的 `NODE_ENV` 始终为 `production`；测试/生产选择用 `APP_ENV`。后端地址、域名、Google Client ID、品牌和币种都在运行时读取，切换环境无需重新构建。发布镜像不会自动更新服务器容器。

## 生产服务器

按现有架构，生产后端在本机 `8081`，中文版前端在 `3000`，MCP 在 `8082`。海外前端独立使用 `3100`，可以单独启动：

```bash
cp deploy/prod.env.example deploy/prod.env
# 编辑 deploy/prod.env：填写海外正式域名和 Google Client ID。
docker compose --env-file deploy/prod.env -f deploy/compose.prod.yml pull
docker compose --env-file deploy/prod.env -f deploy/compose.prod.yml up -d
```

配置使用 `network_mode: host`，适用于现有 Linux 服务器，连接 `http://127.0.0.1:8081`。如果需要并入现有 backend/mcp/frontend 的 Compose，把 `compose.prod.yml` 中的 **frontend-en 服务块**复制到现有文件的 `services` 下，再运行：

```bash
docker compose --env-file deploy/prod.env pull frontend-en
docker compose --env-file deploy/prod.env up -d --no-deps frontend-en
```

独立 Compose 和并入现有 Compose 两种方式选择一种，避免同名容器重复管理。后端 JWT、模型供应商密钥、数据库配置和 Google 客户端密钥均不属于前端镜像配置。

## 测试服务器

现有项目的生产和测试环境部署在不同服务器，两边的共享后端均可使用 `8081`：

```bash
cp deploy/test.env.example deploy/test.env
# 编辑 deploy/test.env：填写测试域名、测试后端地址和对应 Google Client ID。
docker compose --env-file deploy/test.env -f deploy/compose.test.yml pull
docker compose --env-file deploy/test.env -f deploy/compose.test.yml up -d
```

测试实例禁止搜索引擎索引，并且不发布站点地图内容。`APP_ENV=test` 不会把生产后端变成测试后端：测试服务器上的共享后端应当以 `TIDECANVAS_ENV=test` 运行；生产则是 `prod`。

如果两套前端临时放在同一台服务器，把测试的 `FRAMELYN_PORT` 改为 `3101`，并把 `FRAMELYN_BACKEND_URL` 指向真正的测试后端。端口和后端隔离必须显式配置。

## 配置对照

| Compose env 文件 | 容器变量 | 含义 |
| --- | --- | --- |
| 由 Compose 文件指定 | `APP_ENV` | `prod` 或 `test` |
| `FRAMELYN_PORT` | `PORT` | 默认 3100 |
| `FRAMELYN_HOSTNAME` | `HOSTNAME` | 默认 127.0.0.1，供宿主机 Nginx 转发 |
| `FRAMELYN_BACKEND_URL` | `BACKEND_URL` | 共享后端地址，默认 http://127.0.0.1:8081 |
| `FRAMELYN_SITE_URL` | `SITE_URL` | 完整网站来源，如 https://en.example.com |
| `FRAMELYN_GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_ID` | Google Web Client ID；留空隐藏 Google 登录 |
| `FRAMELYN_BRAND_NAME` | `BRAND_NAME` | 默认 Framelyn |
| `FRAMELYN_BILLING_CURRENCY` | `BILLING_CURRENCY` | 默认 CNY，必须与后端实际收费一致 |
| `FRAMELYN_SUPPORT_EMAIL` | `SUPPORT_EMAIL` | 对外客服邮箱 |
| `FRAMELYN_IMAGE` | — | 镜像标签，可指定某次提交回滚 |

`deploy/prod.env`、`deploy/test.env` 和 `.env.local` 均被 Git 忽略。修改参数后执行 `docker compose ... up -d` 使容器按新配置重建。直接运行 Docker 时，使用 `--env APP_ENV=prod --env BACKEND_URL=...` 等容器变量。

## 域名和 Google 登录

参考 `nginx.conf.example` 新增海外域名虚拟主机，转发到 `127.0.0.1:3100`，使用现有证书管理方式配置 HTTPS。保持 `Origin`、`Cookie`、`Set-Cookie` 和 `X-Forwarded-Proto` 正确转发。直接用服务器 IP 访问测试端口时，可把 `FRAMELYN_HOSTNAME` 改为 `0.0.0.0`。

Next.js 自身压缩已关闭，避免代理 SSE 时把分块缓存到结束才输出。由 Nginx 压缩 HTML、CSS、JS 和 JSON，`gzip_types` 不包含 `text/event-stream`，并保持 `proxy_buffering off`。

Google 控制台添加对应海外/测试站的 JavaScript 来源。共享后端也需要部署 Google 认证接口，并配置：

```text
TIDECANVAS_GOOGLE_CLIENTID=与前端相同的WebClientID
TIDECANVAS_GOOGLE_ALLOWEDORIGINS=https://en.example.com
```

测试后端使用测试站来源；多个来源以逗号分隔。前端镜像不包含后端源码，发布前端镜像也不会发布这部分后端改动。

## 更新、检查和回滚

```bash
docker compose --env-file deploy/prod.env -f deploy/compose.prod.yml pull
docker compose --env-file deploy/prod.env -f deploy/compose.prod.yml up -d
docker compose --env-file deploy/prod.env -f deploy/compose.prod.yml ps
docker compose --env-file deploy/prod.env -f deploy/compose.prod.yml logs --tail=100 frontend-en
curl http://127.0.0.1:3100/healthz
```

`/healthz` 检查前端自身可用性；后端连接可通过 `/api/market/studio-models?type=image` 验证。回滚时把 `FRAMELYN_IMAGE` 改为之前的 `sha-完整提交SHA` 标签，再运行 pull/up。GHCR 若要求鉴权，使用有该包读取权限的账号执行 `docker login ghcr.io`。

Actions 使用仓库自动提供的 `GITHUB_TOKEN` 发布镜像，无需生产密钥。若仓库限制了工作流或 Packages 权限，需要在 GitHub 仓库设置中启用相应权限。
