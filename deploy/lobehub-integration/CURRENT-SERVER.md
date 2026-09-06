# 香港测试服务器：启用现有 LobeHub 接入

2026-09-06 已通过只读检查确认：

| 项目 | 实际值 |
|---|---|
| 主站地址 | `https://test-flowlight.tcmzhan.com` |
| 主站 Compose | `/root/flowfinght/docker-compose.yml`（目录拼写就是 `flowfinght`） |
| 主站项目 / 服务 | `flowfinght` / `backend` |
| LobeHub 地址 | `https://test-lobehub.tcmzhan.com` |
| LobeHub Compose | `/root/lobehub-db/docker-compose.yml` |
| LobeHub 项目 / 服务 | `lobehub` / `lobe`（不是 `lobehub` 服务） |
| 主站 Nginx 配置源文件 | `/etc/nginx/sites-available/flowlight.tcmzhan.com.conf` |
| LobeHub Nginx 配置源文件 | `/etc/nginx/sites-available/test-lobehub.tcmzhan.com.conf` |

当前主站代码已经发布，但接入参数、签名私钥、LobeHub SSO 和桥接路由均未配置，因此接口返回 `enabled: false`。以下命令由你在服务器执行，会重新创建两个应用容器并重载 Nginx，短暂中断相关访问。

## 推荐：一键启用

把最新的 `lobehub-integration-config.zip` 上传到服务器 `/root/`，只需执行这一行：

```bash
python3 -m zipfile -e /root/lobehub-integration-config.zip /root && python3 /root/lobehub-integration/enable.py
```

脚本会自动生成接入密钥、备份配置、修改两个 Compose 服务和 Nginx、检查配置、重启主站后端与 LobeHub，并验证登录入口。现有数据库、搜索和存储服务不会重建；现有 LobeHub `.env` 保持原样，SSO 参数单独挂载到 `lobe` 服务。启用中途失败会尝试恢复备份并重新启动受影响的应用服务；如果恢复也失败，会明确提示备份位置。

备份位于 `/root/lobehub-integration/private/backups/`。重复执行保留已有接入密钥和限额，不重复插入路由；不允许两个启用脚本同时运行。需要的 Python 工具缺失时会自动安装。先接通普通聊天，确认 apirouter 已部署工具调用兼容版本后，可追加 `--tools` 执行脚本启用工具。

仅做部署检查、不修改配置：

```bash
python3 /root/lobehub-integration/enable.py --check
```

一键流程成功后不用再执行下面的手动步骤。

## 附件提示“网络异常或跨域配置”

本次排查确认，实例的上传端点配置为 `https://test-s3.tcmzhan.com`，但该域名无法解析，也没有对应 Nginx 站点。因此浏览器无法上传到对象存储；存储桶也没有额外的 CORS 规则。

运行定向修复：

```bash
python3 /root/lobehub-integration/fix_upload.py
```

脚本给现有聊天域名增加 `/lobe/` 存储代理，将 `S3_ENDPOINT` 改为聊天域名，使用同源签名上传，保留原有存储桶、访问密钥和桶权限。存储参数只添加到 `lobe` 服务，原 `.env` 不变。会备份配置、重载 Nginx、仅重新创建 LobeHub，并自动验证一张临时小图片的上传、读回和清理。失败时尝试恢复原配置。

修复成功后刷新 LobeHub 页面，再点击失败附件上的重试按钮或重新选择图片；旧页面拿到的上传地址仍可能指向旧域名。该步骤不调用模型、不扣主站积分。

修复依据：[LobeHub S3 上传实现](https://github.com/lobehub/lobehub/blob/v2.2.16/apps/server/src/modules/S3/index.ts)。该实现用 `S3_ENDPOINT` 生成浏览器使用的签名上传地址，所以仅让服务器能访问 RustFS 并不足够，生成的地址也必须能被浏览器访问。

## 1. 上传并生成配置

将本目录上传成 `/root/lobehub-integration`。如果使用配套 ZIP，在服务器解压：

```bash
cd /root
python3 -m zipfile -e lobehub-integration-config.zip /root
cd /root/lobehub-integration
python3 prepare.py init
```

服务器已安装 `python3-cryptography`。脚本使用上面的两个测试域名，生成独立客户端密钥和 RSA 签名私钥。配置写入 `private/`，密钥不会打印出来。先用默认参数接通普通聊天；确认 apirouter 已更新到兼容版本后，再将 `private/main.env` 中的 `TIDECANVAS_LOBEHUB_SUPPORTSTOOLS` 改为 `true`，重新创建主站后端并从主站再次进入 LobeHub。

不要修改或重新生成现有 LobeHub 的 `AUTH_SECRET`、`KEY_VAULTS_SECRET`、`JWKS`、数据库和存储密码。新生成的 OIDC 签名密钥与它们是不同用途。

## 2. 修改主站 Compose

先备份，然后编辑现有文件：

```bash
cp -a /root/flowfinght/docker-compose.yml /root/flowfinght/docker-compose.yml.before-lobehub
nano /root/flowfinght/docker-compose.yml
```

在 `services` 下的 `backend` 中，增加以下字段，与现有 `image`、`environment`、`volumes` 同级：

```yaml
    env_file:
      - /root/lobehub-integration/private/main.env
```

在 **backend 已有的 `volumes` 列表中追加**这一行：

```yaml
      - /root/lobehub-integration/private/oidc-private.pem:/run/secrets/lobehub-oidc.pem:ro
```

保留所有原有环境变量和卷，不要再声明第二个 `volumes`。本步骤直接修改现有主配置，以后常规 `docker compose up -d` 也会保留接入参数；不再额外使用 `main.override.yml`。

检查并更新主站后端：

```bash
cd /root/flowfinght
docker compose -p flowfinght -f docker-compose.yml config --quiet
docker compose -p flowfinght -f docker-compose.yml up -d --no-deps backend
curl -fsS https://test-flowlight.tcmzhan.com/api/lobehub/config
```

**只有配置检查通过才执行后续命令。**不要去掉 `--quiet` 将完整 Compose 配置输出到公共日志。最后接口应出现 `"enabled":true`；否则先检查 `docker logs --tail 100 tidecanvas-backend` 中的接入错误，再继续。

## 3. 配置 LobeHub SSO

已确认当前 `lobe` 服务配置了 `env_file: .env`，所以合并进实际 `.env` 即可：

```bash
python3 /root/lobehub-integration/prepare.py merge-env \
  --target /root/lobehub-db/.env \
  --fragment /root/lobehub-integration/private/lobehub.env

cd /root/lobehub-db
docker compose -p lobehub -f docker-compose.yml config --quiet
docker compose -p lobehub -f docker-compose.yml up -d --no-deps --force-recreate lobe
```

脚本自动备份原 `.env`，只替换 SSO 相关项。`--no-deps` 仅重新创建 LobeHub，保留 PostgreSQL、RustFS 等服务。注意最后的服务名是 **`lobe`**。

## 4. 配置 Nginx

先备份两个配置源文件：

```bash
cp -a /etc/nginx/sites-available/flowlight.tcmzhan.com.conf /etc/nginx/sites-available/flowlight.tcmzhan.com.conf.before-lobehub
cp -a /etc/nginx/sites-available/test-lobehub.tcmzhan.com.conf /etc/nginx/sites-available/test-lobehub.tcmzhan.com.conf.before-lobehub
```

编辑 `/etc/nginx/sites-available/flowlight.tcmzhan.com.conf`，在包含 `listen 443` 的 HTTPS `server { ... }` 内、现有 `location` 外加入：

```nginx
include /root/lobehub-integration/nginx-main-locations.conf;
```

编辑 `/etc/nginx/sites-available/test-lobehub.tcmzhan.com.conf`，同样在 HTTPS `server` 块内加入：

```nginx
include /root/lobehub-integration/nginx-lobehub-locations.conf;
```

不要放进 80 端口的重定向 `server`，不要删掉已有证书、`location /`、主站 `/api/` 或静态资源代理。当前检查到的现有路由与本次片段没有重名。

```bash
nginx -t
systemctl reload nginx
```

只有 `nginx -t` 成功才执行 reload。

## 5. 验证

```bash
curl -fsS https://test-flowlight.tcmzhan.com/api/lobehub/config
curl -fsS https://test-flowlight.tcmzhan.com/api/lobehub/oidc/.well-known/openid-configuration
curl -I https://test-lobehub.tcmzhan.com/signin
```

第一项应显示 `enabled: true`；第二项返回 issuer 等 OIDC 信息；第三项应返回 302，跳转到主站 `/ai-chat`。刷新主站「AI 聊天」页后按钮应可点击，再从这里进入 LobeHub 完成账号绑定。仅让按钮变亮不代表后续 SSO 已验证，所以请完成上述全部步骤后再测试入口。

以上步骤未替你在服务器执行。更完整的计费规则、模型能力和回滚说明见 [接入文档](README.md)。
