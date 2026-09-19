# FlowLight 生成 MCP 服务

独立的 MCP 服务器，支持 Streamable HTTP（多用户远程接入）和 stdio（单用户本地客户端）。基于 [官方 Go SDK v1.8.0](https://github.com/modelcontextprotocol/go-sdk/tree/v1.8.0)，单独构建，不改变原后端 Go 版本。

调用路径：MCP 客户端 → 本服务 → 主站 `/api/open/v1` → 原有模型渠道。主站负责鉴权、计费、退款、任务恢复和存储，生成记录仍标记“接口调用”，显示在创作台。

## 工具

| 工具 | 用途 | 是否扣积分 |
|---|---|---|
| `list_models` | 查询图片、视频、音频模型及规格、定价 | 否 |
| `generate_image` | 文生图、图生图 | 按主站模型计费 |
| `generate_video` | 文生、图生、首尾帧、全能参考视频 | 按主站模型计费 |
| `generate_audio` | 音乐、音效、语音，取决于所选模型 | 按主站模型计费 |
| `get_generation_task` | 查询本人任务进度和结果 URL | 否 |
| `list_generation_tasks` | 分页查看自己的接口调用历史 | 否 |
| `get_balance` | 查询当前 Key 对应用户的积分余额 | 否 |

先调用 `list_models`，生成时使用响应中的 **modelId**（不是展示名或数字目录 ID）。三个生成工具均要求 `modelId` 和 `clientRequestId`；prompt 描述需求，parameters 放模型支持的规格参数。

同一次生成的重试必须保持请求编号和参数一致，新创作才换编号。返回 `task.id` 和 `statusText`：`processing` 时每 5–10 秒调用 get_generation_task；`succeeded` 后读取 `task.resultUrl`/`task.resultMeta`，`failed` 或 `cancelled` 停止轮询并显示 errorMsg。创建成功不表示生成已完成。

MCP 不长时间等待视频生成，服务重启不会中断主站已经受理的任务。积分不足等业务错误返回 MCP `isError: true`；HTTP 鉴权失败返回 401/403。服务不会自动换编号重新生成。

## 本地启动

需要 Go 1.25+，推荐 1.26。默认主站后端为 `http://127.0.0.1:8081`，也可指向已部署的测试站：

```powershell
cd F:\cluade\canvas\tide-canvas\tide-canvas-mcp
go mod download
go run . -base-url https://test-flowlight.tcmzhan.com
```

Linux/macOS 同样在 tide-canvas-mcp 目录运行 go 命令。默认服务地址 `http://127.0.0.1:8082/mcp`，Ctrl+C 退出。可用 `go build -o flowlight-mcp .` 编译（Windows 输出名使用 flowlight-mcp.exe）。

`GET /healthz` 仅检查进程存活，不代表主站可达、Key 有效或任务成功。程序读取进程环境变量，**不自动加载 .env**；`.env.example` 是配置模板。

| 环境变量 / 参数 | 默认值 | 说明 |
|---|---|---|
| `FLOWLIGHT_BASE_URL` / `-base-url` | `http://127.0.0.1:8081` | 主站地址，不带 `/api/open/v1`；不是第三方 Relay 地址 |
| `MCP_ADDR` / `-addr` | `127.0.0.1:8082` | HTTP 监听地址 |
| `MCP_TRANSPORT` / `-transport` | `http` | `http` 或 `stdio` |
| `MCP_ALLOWED_ORIGINS` | 空 | 浏览器跨域来源，多个完整 origin 用逗号分隔；原生客户端无需设置 |
| `FLOWLIGHT_API_KEY` | 无 | **仅 stdio 模式**使用，填用户自己的主站 Key |

HTTP 模式没有共享付费 Key，每个请求都必须携带用户自己的 Bearer Key。每个 HTTP 请求都会向主站验证身份，Key 停用或重置后后续请求失效；生成和查询本身也由主站再次鉴权。

## 后台配置

主站后台 → 系统 → **MCP 配置**（`/admin/mcp`，使用 `admin.config` 模块权限）提供：

- MCP 总开关，图片/视频/音频独立开关。
- 对外接入地址（用于客户端配置与文档）、允许的浏览器来源、建议轮询间隔。
- 保存版本与服务实际读取版本、连接检测、客户端 JSON 配置复制。

MCP 1.1.0+ 通过主站公开策略端点 `/api/mcp/config` 读取非敏感设置，缓存最多 5 秒；HTTP 和 stdio 都会隐藏关闭的工具并拒绝直接调用。关闭接入不会取消已经在主站受理的任务。Key 身份验证不使用这个缓存。

客户端若缓存了工具列表，需要刷新或重连才能看到新列表；直接调用仍受服务端策略限制。服务一旦读取过新版策略，后续 404 或配置版本倒退都会拒绝调用，避免滚动部署把已关闭能力重新打开。

首次保存后，浏览器来源列表以后台为准，替代 `MCP_ALLOWED_ORIGINS` 的启动默认值。反向代理下的浏览器请显式填写网页 origin；没有 Origin 的原生客户端不受影响。配置接口缺失、拉取失败或版本回退时拒绝新调用，包括 MCP 刚启动或重启后的首次请求，不自动退回默认开放。

主站与 MCP 需一起更新才能启用此功能。MCP 进程版本不支持配置时，后台会提示升级；已在线但没有读到策略时会提示检查 `FLOWLIGHT_BASE_URL` 与主站版本。`/healthz` 的在线状态不表示策略已经同步。

监听端口、主站地址属于进程启动参数，仍由部署环境管理；管理页的检测地址使用主站环境变量 `TIDECANVAS_MCP_INTERNALURL`，默认 `http://127.0.0.1:8082`。对外接入地址不用于后台发起探测请求，不能用它探测任意内网地址。

## 客户端配置

支持 url + headers 的 MCP 客户端可参考：

```json
{
  "mcpServers": {
    "flowlight-generation": {
      "type": "http",
      "url": "http://127.0.0.1:8082/mcp",
      "headers": { "Authorization": "Bearer 填入主站个人中心的APIKey" }
    }
  }
}
```

部署测试服务器并配置 nginx 后，将 URL 改成 `https://test-flowlight.tcmzhan.com/mcp`。不同客户端的配置入口和外层字段可能不同，核心是 Streamable HTTP、URL 和 Bearer Header。请选择手动 Key 模式，此服务没有新增 OAuth 自动登录流程。

仅支持本地进程的客户端可以使用 stdio，无需先启动 HTTP 服务：

```json
{
  "mcpServers": {
    "flowlight-generation": {
      "command": "C:/完整路径/flowlight-mcp.exe",
      "args": ["-transport", "stdio", "-base-url", "https://test-flowlight.tcmzhan.com"],
      "env": { "FLOWLIGHT_API_KEY": "填入主站个人中心的APIKey" }
    }
  }
}
```

stdout 只输出 MCP 协议，日志写 stderr。不要把真实密钥提交到 Git。

## 工具参数示例

图片工具 generate_image 的 arguments：

```json
{
  "modelId": "从list_models选择真实图片模型",
  "clientRequestId": "image-job-001",
  "prompt": "云海中的未来城市",
  "parameters": { "resolution": "4k", "quality": "high", "ratio": "16:9", "batchCount": 1 }
}
```

视频工具 generate_video 的 arguments：

```json
{
  "modelId": "从list_models选择真实视频模型",
  "clientRequestId": "video-job-001",
  "prompt": "镜头缓缓推进",
  "imageUrls": ["https://你的CDN/已上传参考图.png"],
  "parameters": { "resolution": "1080p", "duration": 5 }
}
```

不指定 mode 时，依次按首尾帧、视频/音频参考、多图参考、单图、纯文本选择模式。显式 mode 可选 text_to_video、image_to_video、start_end_to_video、reference_to_video，必须与素材匹配。imageUrls、firstFrame、lastFrame、videoUrls、audioUrls 放顶层；其他参数放 parameters。

mode 和参考素材字段不能放在 parameters 内，否则工具会在付费请求前报错。纯文生图/文生视频必须填写 prompt；仅用参考图生成视频、仅歌词生成音频仍可省略 prompt。

音频工具 generate_audio 的 arguments：

```json
{
  "modelId": "从list_models选择真实音频模型",
  "clientRequestId": "audio-job-001",
  "prompt": "舒缓的钢琴背景音乐",
  "parameters": { "makeInstrumental": true }
}
```

示例模型 ID 必须替换，规格必须符合对应模型 config。参考文件先经主站页面或 `POST /api/open/v1/files` 上传，MCP 使用返回的 fileUrl。远程 MCP 不读取用户电脑的文件路径，不在协议中传大文件/base64。

## Docker 与部署

CI 新增 `ghcr.io/vit4ss/tide-canvas-mcp:latest` 镜像，deploy/docker-compose.yml 新增 mcp 服务。提交推送、等待镜像构建完成后，在服务器执行：

```bash
cd /你的项目目录/deploy
docker compose pull
docker compose up -d
curl http://127.0.0.1:8082/healthz
```

主站必须同时包含生成 API 与本次的 `/api/mcp/config` 配置接口，仅有 `157fc08` 的生成 API 版本还不够。请同步更新主站和 MCP。Compose 使用 host 网络，主站后端 8081，MCP 8082；MCP 不需要数据库、Redis 或第三方模型密钥。

在目标域名的 nginx server 中加入下列 location。仓库 deploy/nginx/conf.d/flowlight.conf 已包含；测试站若有独立虚拟主机，也需加入：

```nginx
location = /mcp {
    proxy_pass http://127.0.0.1:8082/mcp;
    proxy_set_header Host 127.0.0.1:8082;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_read_timeout 90s;
    proxy_buffering off;
    proxy_cache off;
    client_max_body_size 2m;
}
```

保持这里的 Host 设置，让 SDK 本地防护继续生效；浏览器来源通过 MCP_ALLOWED_ORIGINS 授权。检查并重载：`nginx -t && systemctl reload nginx`。

也可不等 CI，手动构建：

```bash
docker build -t flowlight-mcp ./tide-canvas-mcp
docker run -d --name flowlight-mcp --restart unless-stopped --network host \
  -e FLOWLIGHT_BASE_URL=http://127.0.0.1:8081 flowlight-mcp
```

使用 Docker bridge 网络时需显式设置 `-e MCP_ADDR=0.0.0.0:8082 -p 127.0.0.1:8082:8082`，并把主站地址改成容器可访问的地址。生产连接使用 HTTPS 反向代理。

## 验证与排查

`go test ./...` 使用本地模拟主站及官方 SDK 客户端，覆盖新旧协议、生成参数映射、幂等重试、多用户隔离、Key 失效、积分不足、Origin 限制及密钥不随重定向泄露，不消耗真实生成积分。

- 401：检查主站个人中心的默认 API Key，不能使用供应商 Key。
- 403：检查来源白名单、nginx Host 和任务归属。
- 503：检查主站地址、连通性和生成 API 版本。
- isError：向用户展示工具返回的主站错误，不能擅自换请求编号重生成。
- processing：继续查询任务；MCP 请求结束不表示作品生成完成。
- 主站任务响应缺少 ID/状态或格式异常时，工具会明确报错，不会伪装成生成中。提交响应中断或无法确认时必须用原编号和参数重试。
- 主站积分、生成并发和接口限流仍生效。MCP 请求最大 2 MiB，文件上传走主站接口。

协议参考：[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[官方 SDK](https://github.com/modelcontextprotocol/go-sdk/tree/v1.8.0)。
