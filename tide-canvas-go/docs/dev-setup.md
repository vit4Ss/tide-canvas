# 开发环境搭建（Windows）

本机已具备 **winget** 与 **Docker**，但缺 **Go** 与 **MySQL**。以下用 winget 装 Go、Docker 跑 MySQL，最省事。

## 1. 安装 Go

winget 默认从 go.dev 拉安装包，国内常连不上（报 `0x80072efd`）。改用 Go 官方中国镜像 `golang.google.cn`：

```powershell
$ProgressPreference='SilentlyContinue'
Invoke-WebRequest "https://golang.google.cn/dl/go1.26.4.windows-amd64.msi" -OutFile "$env:USERPROFILE\Downloads\go1.26.4.msi"
Start-Process "$env:USERPROFILE\Downloads\go1.26.4.msi"
```

或浏览器打开 https://golang.google.cn/dl/ 下最新 `windows-amd64.msi` 双击安装。
（有代理/VPN 时也可：`$env:HTTPS_PROXY="http://127.0.0.1:7890"; winget install -e --id GoLang.Go`）

安装器默认装到 `C:\Program Files\Go` 并自动配 PATH。装完**重开一个新终端**让 PATH 生效，验证（go.mod 要求 ≥ 1.23）：

```powershell
go version
```

## 2. 配置国内代理（关键，否则拉依赖会超时）

项目依赖 gin / gorm / gorilla-websocket / aliyun-oss-go-sdk 等，直连 GitHub 与 proxy.golang.org 在国内很慢：

```powershell
go env -w GOPROXY=https://goproxy.cn,direct
go env -w GOSUMDB=sum.golang.google.cn
```

## 3. 拉依赖 + 编译

```powershell
cd D:\tide-canvas\tide-canvas-go
go mod tidy        # 下载全部依赖、生成 go.sum
go build ./...     # 编译所有包
```

⚠️ **预期会有编译错误**：本项目由多轮代码生成而成，此前无 Go 环境从未 build 过。把 `go build ./...` 的报错贴出来逐个修即可（多为 import/签名小问题）。

## 4. 用 Docker 起 MySQL 并初始化表

```powershell
# 启动 MySQL 8（root 密码 root，自动建库 tide_canvas）
docker run -d --name tc-mysql -p 3306:3306 `
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=tide_canvas mysql:8

# 等几秒待其就绪后，导入表结构（30 张表 + 种子）
# 注意：用 docker cp + 容器内导入，避免 PowerShell 按 GBK 误读 SQL 中文注释
docker cp sql\schema.sql tc-mysql:/schema.sql
docker exec tc-mysql sh -c "mysql -uroot -proot < /schema.sql"
```

> Redis 暂不需要（限流/验证码/IM 在线状态均为单机内存版）。多实例部署再装：
> `docker run -d --name tc-redis -p 6379:6379 redis:7`

## 5. 配置文件

```powershell
Copy-Item configs\config.example.yaml configs\config.yaml
```

编辑 `configs\config.yaml`，把 `db.dsn` 的密码改成 `root`：

```yaml
db:
  dsn: "root:root@tcp(127.0.0.1:3306)/tide_canvas?charset=utf8mb4&parseTime=True&loc=Asia%2FShanghai"
```

## 6. 运行与验证

```powershell
go run ./cmd/server
```

另开一个终端：

```powershell
curl http://localhost:8080/health           # {"status":"ok"}
# WebSocket 自测（浏览器控制台）：
#   new WebSocket("ws://localhost:8080/api/im/ws?token=<登录拿到的accessToken>")
```

## 常用命令

```powershell
go build ./...          # 全量编译
go vet ./...            # 静态检查
go run ./cmd/server     # 本地运行
docker start tc-mysql   # 重启后拉起 MySQL
```

## 默认管理员

`schema.sql` 内置：用户名 `admin` / 密码 `admin123`（`POST /api/auth/login`）。
