# TideCanvas 服务器部署指南

架构(单域名,所有服务跑在一台服务器的 Docker 里):

```
公网 → Caddy(80/443, 自动HTTPS) → frontend(Next.js :3000)
                                      └─ /api/* 内网代理 → backend(Spring Boot :8080)
                                                              ├─ mysql:3306(仅内网)
                                                              └─ redis:6379(仅内网)
```

支付回调、OAuth 回调等全部走 `https://你的域名/api/...`,由 Next 代理转发到后端,无需暴露 8080。

## 一、准备

1. **服务器**:Linux(Ubuntu 22.04+ / Debian 12 推荐),2核4G 起步,放行 80/443 端口(云厂商安全组)
2. **域名**:添加 A 记录指向服务器公网 IP(如 `canvas.example.com`)。暂时没域名也能按 IP 跑(见 .env 注释)
3. **安装 Docker**(含 compose 插件):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

## 二、上传代码

> 注意:`application.yml`、`application-docker.yml`、`.env*` 被 .gitignore 忽略,
> **git clone 不包含它们**,必须单独上传(本机这两个文件已配置好邮件等内容)。

方式 A —— 有 Git 仓库:

```bash
# 服务器上
git clone <你的仓库地址> tide-canvas && cd tide-canvas

# 本机上(PowerShell)补传被 git 忽略的配置
scp D:\tide-canvas\tide-canvas-server\src\main\resources\application.yml        user@服务器:~/tide-canvas/tide-canvas-server/src/main/resources/
scp D:\tide-canvas\tide-canvas-server\src\main\resources\application-docker.yml user@服务器:~/tide-canvas/tide-canvas-server/src/main/resources/
```

方式 B —— 无仓库,直接整体上传(本机 PowerShell,排除产物目录):

```powershell
scp -r D:\tide-canvas\tide-canvas-server user@服务器:~/tide-canvas/
scp -r D:\tide-canvas\tide-canvas-web    user@服务器:~/tide-canvas/   # 先删本地 node_modules/.next 或用 rsync --exclude
scp D:\tide-canvas\docker-compose.prod.yml D:\tide-canvas\.env.prod.example user@服务器:~/tide-canvas/
scp -r D:\tide-canvas\deploy user@服务器:~/tide-canvas/
```

## 三、配置环境变量

```bash
cd ~/tide-canvas
cp .env.prod.example .env
vim .env
```

必填三项:

| 变量 | 说明 | 示例 |
|---|---|---|
| `SITE_ADDRESS` | Caddy 监听地址 | `canvas.example.com`(自动 HTTPS)或 `:80`(按 IP) |
| `SITE_URL` | 站点完整 URL(OAuth/CORS 用) | `https://canvas.example.com` |
| `MYSQL_ROOT_PASSWORD` / `JWT_SECRET` | 强随机,`openssl rand -base64 32` 生成 | — |

**邮件**:服务器在海外可直连 Gmail → `MAIL_SOCKS_HOST=` 留空即可;大陆机房连不上 Gmail → 要么填服务器上的代理,要么换国内 SMTP(见 .env 注释)。

## 四、启动

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

首次构建约 5~10 分钟(Maven + npm 拉依赖)。MySQL 首次启动会自动执行 `init.sql` 建库(含支付配置、邮件模板等全部初始数据)。

验证:

```bash
docker compose -f docker-compose.prod.yml ps          # 全部 Up / healthy
docker logs tc-backend --tail 20                       # 看到 Started TideCanvasApplication
curl -s http://127.0.0.1:8080/api/orders/notify/epay   # 返回 fail 即后端正常
curl -sI https://你的域名                               # 200,前端可访问
```

## 五、上线后必做

1. **改管理员密码**:默认账号 `admin / admin123`,登录后立即修改
2. **管理后台 → 系统设置 → 支付设置**:填易联达商户ID、商户RSA私钥、平台RSA公钥;
   异步通知地址填 `https://你的域名/api/orders/notify/epay`;支付完成跳转填 `https://你的域名/user/orders`;打开"启用在线支付"
3. **管理后台 → 邮件模板**:发一封测试邮件确认 SMTP 通(发不出去多半是上面"邮件"一节的网络问题)
4. **充值比例**:确认 `points.recharge.ratio` 是否符合预期(新库初始为 100,即 1 元 = 100 积分)

### 从本地库迁移数据(可选)

不迁移则服务器是全新库。要把本地的用户/订单等数据搬过去:

```powershell
# 本机导出
docker exec tc-mysql sh -c "mysqldump -uroot -proot123 --single-transaction tide_canvas" > dump.sql
scp dump.sql user@服务器:~/
```
```bash
# 服务器导入(覆盖初始数据)
docker exec -i tc-mysql sh -c "mysql -uroot -p\"$MYSQL_ROOT_PASSWORD\" tide_canvas" < ~/dump.sql
```

## 六、日常运维

```bash
# 更新部署(改了代码后)
git pull   # 或重新 scp
docker compose -f docker-compose.prod.yml up -d --build

# 查日志
docker logs -f tc-backend

# 数据库备份(建议加 crontab 每日执行)
docker exec tc-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction tide_canvas' | gzip > backup_$(date +%F).sql.gz
```

## 常见问题

- **HTTPS 证书签发失败**:确认域名 A 记录已生效(`ping 域名`)且 80/443 对公网放行;Caddy 会自动重试
- **前端 500 / API 不通**:`docker logs tc-frontend`、`docker logs tc-backend`;检查 backend 是否 healthy
- **支付回调不到账**:确认 notify_url 是公网域名且为 `/api/orders/notify/epay`;用户也可在订单页点"同步状态"主动查单补偿
- **修改了 OAuth client-id / SITE_URL**:这些在前端构建期内联,需 `docker compose -f docker-compose.prod.yml up -d --build frontend` 重新构建
