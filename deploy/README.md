# 海外前端镜像与部署

推送 `flowlight-en` 分支后，GitHub Actions 自动检查代码、构建镜像，并用**同一个镜像**验证测试和生产配置，验证通过才发布到 GHCR：

```text
ghcr.io/vit4ss/tide-canvas-frontend-en:latest
ghcr.io/vit4ss/tide-canvas-frontend-en:flowlight-en
ghcr.io/vit4ss/tide-canvas-frontend-en:sha-完整提交SHA
```

镜像只包含海外前端，使用现有 FlowLight 后端。容器的 `NODE_ENV` 始终为 `production`；测试/生产选择用 `APP_ENV`。后端地址、域名、Google Client ID、品牌和币种都在运行时读取，切换环境无需重新构建。发布镜像不会自动更新服务器容器。

| 环境 | 网站地址 | Nginx 示例 |
| --- | --- | --- |
| 生产 | https://framelyn.tcmzhan.com | `nginx.conf.example` |
| 测试 | https://test-framelyn.tcmzhan.com | `nginx.test.conf.example` |

Compose 默认值和 env 模板均已填写对应域名。本地开发继续使用 `http://localhost:3100`。

## 生产服务器

按现有架构，生产后端在本机 `8081`，中文版前端在 `3000`，MCP 在 `8082`。海外前端独立使用 `3100`，可以单独启动：

```bash
cp deploy/prod.env.example deploy/prod.env
# 编辑 deploy/prod.env：填写 Google Client ID，核对现有后端地址。
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
# 编辑 deploy/test.env：核对测试后端地址，填写对应 Google Client ID。
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
| `FRAMELYN_SITE_URL` | `SITE_URL` | 生产 https://framelyn.tcmzhan.com；测试 https://test-framelyn.tcmzhan.com |
| `FRAMELYN_GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_ID` | Google Web Client ID；留空隐藏 Google 登录 |
| `FRAMELYN_BRAND_NAME` | `BRAND_NAME` | 默认 Framelyn |
| `FRAMELYN_BILLING_CURRENCY` | `BILLING_CURRENCY` | 默认 USD；英文套餐独立定价，历史订单按自身币种显示 |
| `FRAMELYN_SUPPORT_EMAIL` | `SUPPORT_EMAIL` | 对外客服邮箱 |
| `FRAMELYN_IMAGE` | — | 镜像标签，可指定某次提交回滚 |

`deploy/prod.env`、`deploy/test.env` 和 `.env.local` 均被 Git 忽略。修改参数后执行 `docker compose ... up -d` 使容器按新配置重建。直接运行 Docker 时，使用 `--env APP_ENV=prod --env BACKEND_URL=...` 等容器变量。

## 域名和 Google 登录

生产服务器参考 `nginx.conf.example`，测试服务器参考 `nginx.test.conf.example`。两个域名分别解析到各自服务器，再由 Nginx 转发到各自的 `127.0.0.1:3100`。使用现有证书管理方式配置这两个域名的 HTTPS。保持 `Origin`、`Cookie`、`Set-Cookie` 和 `X-Forwarded-Proto` 正确转发。直接用服务器 IP 访问测试端口时，可把 `FRAMELYN_HOSTNAME` 改为 `0.0.0.0`。

Next.js 自身压缩已关闭，避免代理 SSE 时把分块缓存到结束才输出。由 Nginx 压缩 HTML、CSS、JS 和 JSON，`gzip_types` 不包含 `text/event-stream`，并保持 `proxy_buffering off`。

Google 控制台的「已获授权的 JavaScript 来源」添加以下两项；已有本地开发来源可以保留：

```text
https://framelyn.tcmzhan.com
https://test-framelyn.tcmzhan.com
```

共享后端也需要部署 Google 认证接口。生产后端配置：

```text
TIDECANVAS_GOOGLE_CLIENTID=与前端相同的WebClientID
TIDECANVAS_GOOGLE_ALLOWEDORIGINS=https://framelyn.tcmzhan.com
```

测试后端配置 `TIDECANVAS_GOOGLE_ALLOWEDORIGINS=https://test-framelyn.tcmzhan.com`。多个来源以逗号分隔。前端镜像不包含后端源码，发布前端镜像也不会发布这部分后端改动。

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


## 英文站美元套餐

共享后端和 Flowlight 管理后台也需要更新。后台「价格管理」新增「英文站 · USD」，
独立维护套餐、年付总价、积分、英文文案、方案对比、FAQ 和促销；新套餐默认下架。
英文前端读取 `/api/billing/en/*`，不会把中文套餐金额直接标成美元。

美元支付使用 Stripe Checkout（一次性付款，不自动续费）。后端凭据和后台 stripe 渠道未配置/启用时，前端显示报价并关闭付费购买。
先在后台填入实际美元价格，再按业务准备情况上架。现有人民币订单保持原币种和金额。
部署时先更新共享后端及中文后台，再更新 `frontend-en`；具体说明见共享后端的
`docs/EN_BILLING.md`。

## Stripe 收款

Stripe 密钥只配置在共享 backend 容器，英文 frontend-en 不需要 Stripe 密钥。后端新增 `TIDECANVAS_STRIPE_ENABLED`、`TIDECANVAS_STRIPE_SECRETKEY`、`TIDECANVAS_STRIPE_WEBHOOKSECRET`、`TIDECANVAS_STRIPE_SITEURL`，默认关闭。测试/生产分别使用自己的密钥与回调地址：

- 测试：`https://test-framelyn.tcmzhan.com/api/billing/stripe/webhook`
- 生产：`https://framelyn.tcmzhan.com/api/billing/stripe/webhook`

按共享后端 `docs/STRIPE.md` 完成开户、Sandbox 联调、后台渠道启用，再启用生产收款。现有 Nginx `/api/` 反代需原样转发请求体与 Stripe-Signature 头。退款先在 Stripe 完成原路退回，再在后台做账务退款和积分回收；本次不包含自动订阅或退款同步。

## Waffo Pancake 收款

英文站也支持一次性 USD 积分包的 Pancake 渠道，后台类型为 `pancake`。
接入代码位于共享 Go 后端和新增的 `tide-canvas-payments` Node SDK 服务，
前端无需 Waffo 私钥。共享后端 `docs/PANCAKE.md` 说明了本地测试、凭据、
Webhook、容器覆盖文件和真实 Sandbox 验证步骤。

价格为税前金额，收银台可能加税；账单分别展示套餐小计、税费和实付。
Pancake 退款请从其后台发起，再由已验签通知同步积分，不能使用旧账务退款按钮。
