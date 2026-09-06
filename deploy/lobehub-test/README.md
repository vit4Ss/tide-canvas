# 香港测试服务器：LobeHub 部署文档

- 目标地址：**https://test-lobehub.tcmzhan.com**
- 服务器：香港测试服务器，`45.192.105.204`
- 部署目录：`/root/lobehub`
- 版本：LobeHub `2.2.16`，本目录 Compose 同时锁定镜像摘要。
- 适用范围：独立测试实例、单一测试账号、测试 apirouter 模型接入。

本阶段不包含主站 SSO、主站默认 Key 自动绑定、主站用户积分扣费，也不迁移原聊天记录。测试模型调用使用测试 apirouter 的账户额度；主站生成的 `tc_sk_…` Key 目前不能直接填作 apirouter Key。

完成独立部署后，按 [主站集成文档](../lobehub-integration/README.md) 接入已实现的 SSO、个人 Key 同步和主站积分网关。

## 0. 先了解服务器当前状态

2026-09-06 检查时：

| 项目 | 当前情况 |
|---|---|
| 操作系统 | Debian 13，x86_64 |
| Docker / Compose | 已安装 |
| Nginx / Certbot / Python cryptography | 已安装 |
| 主站 | `test-flowlight.tcmzhan.com`，继续使用原有服务 |
| 中转站 | `test-relay.tcmzhan.com`，继续使用原有服务 |
| 新域名 DNS | `test-lobehub.tcmzhan.com` 已解析至 `45.192.105.204` |
| LobeHub 准备文件 | 已在 `/root/lobehub` 创建 |
| 镜像 | 本次所需的 5 个镜像已下载完成 |
| LobeHub 容器 | **尚未启动** |
| 测试登录账号 | **尚未创建**，仅已生成待使用的账号配置文件 |
| LobeHub Nginx 入口 / 证书 | **尚未配置** |

**服务器上的旧脚本还使用临时的 `test-flowlight.tcmzhan.com:8443` 地址。请先上传本包的新文件，再执行下文；不要直接运行旧脚本。** 新包统一使用 `test-lobehub.tcmzhan.com` 和标准 443 端口。

服务器总内存约 4 GB，检查时可用约 1.6 GB。此 Compose 给新增常驻容器设置了合计约 1.36 GiB 的内存上限，适合尝试小规模测试，尚未经过该服务器上的启动验收。官方完整部署建议至少 4 GB 内存、20 GB 存储，推荐 8 GB 以上内存；当前机器还承担其他服务，若出现 OOM，应先补充资源。[官方资源要求](https://github.com/lobehub/lobehub/blob/v2.2.16/docs/self-hosting/platform/docker-compose.mdx)

## 1. 上传部署文件

在 ATerminal 中打开“香港测试服务器”的 SFTP，将本目录以下文件上传并覆盖到 `/root/lobehub/`：

```text
compose.yml
bootstrap.py
nginx-http.conf
nginx.conf
```

README 和测试文件可以保留在本地。服务器上已有的以下文件必须保留，不要删除、覆盖或提交到 Git：

```text
/root/lobehub/.env
/root/lobehub/.bootstrap-login.json
```

`.env` 包含数据库密码、加密密钥和测试模型凭据。`.bootstrap-login.json` 保存即将创建的测试账号及随机密码。更新公开域名不会更换这些密码。

以下所有命令均在服务器 SSH 终端执行：

```bash
cd /root/lobehub
chmod 700 /root/lobehub
chmod 600 .env .bootstrap-login.json
docker compose version
python3 -c 'import cryptography'
```

如果以后在全新服务器部署，先创建 `/root/lobehub` 并上传文件；不存在 `.env` 时，跳过上面的两个私密文件权限命令，下一步会自动以 600 权限生成。

## 2. 初始化，并切换到正确域名

```bash
cd /root/lobehub
python3 bootstrap.py prepare
python3 bootstrap.py configure-domain
python3 bootstrap.py relay
docker compose -f compose.yml config --quiet
```

这几条命令分别完成：保留或初始化私密配置；仅更新公开访问地址；验证并接入测试模型；检查 Compose 语法和变量。

`configure-domain` 会将以下三项统一为 `https://test-lobehub.tcmzhan.com`，并同步本地测试账号文件里的网址：

```dotenv
APP_URL=https://test-lobehub.tcmzhan.com
NEXT_PUBLIC_AUTH_URL=https://test-lobehub.tcmzhan.com
S3_ENDPOINT=https://test-lobehub.tcmzhan.com
```

`relay` 会从现有 `tidecanvas-backend` 容器读取测试中转凭据，验证模型目录后配置 `gpt-6-astra`。它不会打印 Key，也不会发起付费生成。正常输出包含：

```text
Test model configured: gpt-6-astra
```

如果提示模型未配置，可以先部署页面，再在 `.env` 配置真实的 apirouter 测试 Key；不要使用主站的 `tc_sk_…` Key：

```dotenv
OPENAI_PROXY_URL=https://test-relay.tcmzhan.com/v1
OPENAI_API_KEY=在此填写测试apirouter的Key
OPENAI_MODEL_LIST=-all,+gpt-6-astra=GPT-6 Astra
```

由于这里使用服务端共享的测试中转凭据，默认注册白名单只允许 `lobehub-test@tcmzhan.com`。先保持这个单账号范围，后续接好逐用户鉴权和扣费后再开放更多用户。

## 3. 确认 DNS，准备证书申请入口

DNS 应为：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | `test-lobehub` | `45.192.105.204` |

若使用 Cloudflare，首次签发证书时建议先设为“仅 DNS”。不要添加指向其他服务器的 AAAA 记录。

```bash
getent ahostsv4 test-lobehub.tcmzhan.com
python3 bootstrap.py nginx-http
```

脚本仅新增本域名的 Nginx 配置，执行 `nginx -t` 成功后平滑加载。此时根页面返回 503 是正常的，只有 ACME 验证路径开放；主站和中转站继续沿用各自配置。

测试证书验证路径：

```bash
printf 'ok\n' > /var/www/lobehub-acme/.well-known/acme-challenge/deployment-check
curl -fsS http://test-lobehub.tcmzhan.com/.well-known/acme-challenge/deployment-check
```

应返回 `ok`。如果不通，先检查 DNS 和服务器安全组的 TCP 80/443，暂时不要申请证书。

## 4. 申请 HTTPS 证书

使用 webroot 模式，不需要停止现有 Nginx：

```bash
certbot certonly --webroot \
  -w /var/www/lobehub-acme \
  -d test-lobehub.tcmzhan.com
```

按提示填写联系邮箱、接受服务条款。成功后应存在：

```text
/etc/letsencrypt/live/test-lobehub.tcmzhan.com/fullchain.pem
/etc/letsencrypt/live/test-lobehub.tcmzhan.com/privkey.pem
```

## 5. 启动独立容器

```bash
cd /root/lobehub
docker compose -f compose.yml pull
docker compose -f compose.yml up -d --wait --wait-timeout 240
docker compose -f compose.yml ps -a
```

已下载的镜像会复用。Compose 会自动创建独立网络和命名卷：

| 服务 | 用途 | 对宿主机开放 |
|---|---|---|
| `app` | LobeHub | 仅 `127.0.0.1:3210` |
| `postgres` | 聊天、用户、文件元数据 | 不开放端口 |
| `redis` | 本实例缓存 | 不开放端口 |
| `storage` | 私有 S3 文件存储 | 仅 `127.0.0.1:19000` |
| `storage-init` | 创建 `lobehub-files` 桶 | 不开放端口，成功后退出 |

项目名固定为 `tide-lobehub-test`。因此不会占用原有 MySQL、Redis、主站或 apirouter 容器名称和端口。

成功状态应是四个常驻服务健康，`storage-init` 为 `Exited (0)`。第一次启动会执行数据库迁移，超过等待时间不代表数据应被删除，先检查日志：

```bash
python3 bootstrap.py logs
docker compose -f compose.yml logs --tail=80 postgres redis storage-init
curl -I http://127.0.0.1:3210/
```

本地页面可能重定向到登录页，HTTP 200 或正常 3xx 均可继续。

## 6. 创建测试账号，再开放 HTTPS 页面

```bash
cd /root/lobehub
python3 bootstrap.py account
python3 bootstrap.py nginx
```

`account` 会创建默认测试账号并验证密码登录；重复执行时先尝试注册，再用已保存的密码登录，不会更换密码。成功后才生成 `.account-ready` 标识和 `.test-access.txt`。

`nginx` 检查账号标识和新域名证书，然后把第 3 步的证书申请站点切换成正式 HTTPS 反向代理。已有同名站点若被手工修改，脚本会停止覆盖，需先自行检查配置差异。

现在访问：

**https://test-lobehub.tcmzhan.com**

测试邮箱：`lobehub-test@tcmzhan.com`。密码在服务器以下文件中，可通过 SFTP 查看或下载：

```text
/root/lobehub/.test-access.txt
```

此账号是 LobeHub 独立测试账号，暂不等同于主站账号。没有 SMTP 时，测试账号不依赖邮箱收信，密码找回邮件也不会可用，请保留该文件。

## 7. 验收

先验证登录，再做少量功能测试：

1. 打开新域名，证书域名正确，没有 HTTPS 警告。
2. 用上述测试账号登录，刷新页面后登录态仍有效。
3. 选择 `GPT-6 Astra`，发送一句短消息，确认回复完成并保存。这一步会产生测试 apirouter 的调用费用。
4. 上传一张小图片，检查上传、预览、下载。文件桶保持私有，LobeHub 使用签名地址访问；Nginx 必须保留完整 `/lobehub-files/...` 路径和 Host。[对应版本的 S3 实现](https://github.com/lobehub/lobehub/blob/v2.2.16/apps/server/src/modules/S3/index.ts)
5. 检查资源和已有服务：

```bash
docker stats --no-stream
free -m
df -h /
curl -I https://test-flowlight.tcmzhan.com
curl -I https://test-relay.tcmzhan.com
```

## 8. 常见问题

| 现象 | 检查方法 |
|---|---|
| 证书申请失败 | 确认 A 记录、80 端口、安全组和 ACME 探针；不能拿原主站证书替代新域名证书 |
| HTTPS 502 | 先检查 `docker compose ps -a`，再测本机 `127.0.0.1:3210` |
| 登录回到临时地址或 Origin 错误 | 重新执行 `configure-domain`，然后执行 `docker compose -f compose.yml up -d --force-recreate app` |
| `storage-init` 非 0 退出 | 查看该服务日志，核对 S3 凭据与 `.env`；不要重新生成已有存储密钥 |
| 图片签名无效 | 检查 `S3_ENDPOINT`、`S3_ENABLE_PATH_STYLE=1`，确认反代没有删去桶名、改 Host 或移除查询参数 |
| 看不到模型 / Key 无效 | 执行 `python3 bootstrap.py relay` 后重建 app，确认使用的是测试 apirouter Key |
| 服务反复退出、退出码 137 | 查看 `docker stats` 和容器的 OOMKilled 状态；当前资源限额用于低配尝试，可能需要增加服务器内存 |
| 回复中途停止 | 检查 LobeHub 和 apirouter 的该次调用日志；更换聊天界面不会自动修复上游断流、长度限制或错误结束原因 |

查看 app 是否被内存限制终止：

```bash
docker inspect "$(docker compose -f compose.yml ps -q app)" \
  --format 'OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}}'
```

## 9. 停止、备份和更新

只暂停这一套测试实例：

```bash
cd /root/lobehub
docker compose -f compose.yml stop
```

恢复：

```bash
docker compose -f compose.yml up -d --wait --wait-timeout 240
```

做一份一致的测试环境备份时，先暂停 LobeHub 和文件存储；数据库保持运行以便导出：

```bash
cd /root/lobehub
set -o pipefail
umask 077
mkdir -p backups
backup_time=$(date +%Y%m%d-%H%M%S)
docker compose -f compose.yml stop app storage
docker compose -f compose.yml exec -T postgres pg_dump -U postgres lobehub \
  | gzip > "backups/database-$backup_time.sql.gz"
docker cp "$(docker compose -f compose.yml ps -a -q storage)":/data \
  "backups/storage-$backup_time"
tar -czf "backups/config-$backup_time.tar.gz" .env .bootstrap-login.json compose.yml
docker compose -f compose.yml up -d --wait --wait-timeout 240
```

逐条执行并检查结果；如果导出或复制报错，先保留现场，不能把空文件当作成功备份。附件实际保存在 `tide-lobehub-test_storage-data` 卷，以上步骤将其单独复制出来，Redis 作为缓存无需随数据库导出。不要使用 `docker compose down -v`，它会删除此栈的数据卷。重要备份应另存到本服务器之外。

本包锁定镜像摘要，单独运行 `pull` 不会跳到新版本。升级时先备份，再有意更新 `compose.yml` 的版本及摘要。数据库迁移后，恢复旧镜像不一定能回退数据库，保留升级前备份。

证书维护：

```bash
systemctl list-timers certbot.timer
certbot renew --cert-name test-lobehub.tcmzhan.com --dry-run
```

确认 Certbot 的定时续期已启用。续期成功后 Nginx 需要重新加载证书；可创建一个专用 deploy hook（若文件已存在，先检查，不要直接覆盖）：

```bash
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
hook=/etc/letsencrypt/renewal-hooks/deploy/lobehub-nginx-reload.sh
if [ ! -e "$hook" ]; then
  printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > "$hook"
  chmod 755 "$hook"
fi
```

## 10. 后续主站接入范围

独立部署成功后，主站入口可以跳到新域名，但“跳转”和“免重复登录”是两件事。仍需继续实现：OIDC / SSO 用户映射、逐用户调用凭证、主站积分网关，以及模型工具调用的协议适配。现有主站的最近 3 条历史规则不会自动迁移到 LobeHub。

本指南参考 [LobeHub 2.2.16 官方 Compose](https://github.com/lobehub/lobehub/blob/v2.2.16/docker-compose/deploy/docker-compose.yml) 和 [官方部署说明](https://github.com/lobehub/lobehub/blob/v2.2.16/docs/self-hosting/platform/docker-compose.mdx)。本次交付完成的是配置与操作文档；容器启动、账号登录、证书签发和文件上传尚待你按步骤验收。

交付前已通过脚本的 3 项本地测试、Compose 配置校验，以及 Nginx 模板语法校验。Nginx 语法检查临时引用了服务器现有证书，未安装站点；这不代表新域名证书已经签发。
