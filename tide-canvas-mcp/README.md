# FlowLight 生成 MCP 服务

独立的 MCP 服务器，支持 Streamable HTTP（多用户远程接入）和 stdio（单用户本地客户端）。基于 [官方 Go SDK v1.8.0](https://github.com/modelcontextprotocol/go-sdk/tree/v1.8.0)，单独构建，不改变原后端 Go 版本。

调用路径：MCP 客户端 → 本服务 → 主站 `/api/open/v1` → 原有模型渠道。主站负责鉴权、计费、退款、任务恢复和存储，生成记录仍标记“接口调用”，显示在创作台。

## 工具

| 工具 | 用途 | 是否扣积分 |
|---|---|---|
| `prepare_asset_upload` | 为客户端本地文件签发一次性上传地址 | 否 |
| `import_asset_url` | 将公网文件直链导入当前账号素材库 | 否 |
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

首次打开时，表单会填入「当前站点 + /mcp」作为**待保存的建议地址**，需要管理员确认后点击保存。Skill 安装器只使用服务端已保存的 `publicUrl`；输入框里的建议值不代表已经配置。未保存时，右侧不会显示可复制的已保存配置。

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

## 把已导入的 Skill 开放为独立 MCP

MCP 1.2.0 起，在主站后台「技能广场」列表开启「对外开放」，或在导入/新建/编辑界面勾选「开放至 MCP / Skill 广场」。此开关默认关闭，同时控制前台 Skill 广场与专属 MCP 接入，不影响原有站内技能入口。开启前必须通过标准 Skill 格式校验。同一份已发布 Skill 会得到稳定的专属地址：

```text
https://你的主站域名/mcp/skills/<技能ID>
```

一个 Skill 一个地址，所有地址由同一个 MCP 容器提供。原 `/mcp` 现在提供 9 个上传、生成和查询工具。每个技能地址只提供 `get_skill_info`、`prepare_asset_upload`、`import_asset_url`、`run_skill`、`get_skill_run`、`respond_skill_run` 和 `get_balance`，不会混入其他技能。

- 导入后的技能默认下架；需要上架且主站 MCP 总开关开启才可远程启动。
- 普通导入与 MCP 使用同一套 Agent Skills 格式校验；必须有有效的 `SKILL.md`、YAML `name`/`description` 及正文。已有技能开放 MCP 时会复核已发布版本；不合规的历史内容需修正并重新发布，不能通过勾选 MCP 绕过校验。
- 编辑页可复制地址和接入 JSON，用户填写自己的主站 API Key。
- `get_skill_info` 返回公开说明和输入 Schema；`run_skill` 接受 `clientRequestId` 和 `input`（prompt/assets/parameters），返回异步任务 id。
- 本地文件先调用 `prepare_asset_upload`，由本地客户端按返回的一次性地址上传；公网媒体直链可调用 `import_asset_url`，也可直接作为 asset URL 交给 `run_skill` 自动导入。两者都返回当前账号拥有的素材 ID/URL，不扣生成积分但占用存储配额。
- 等待确认或输入时，将 `pendingAction` 和草稿给用户看；`respond_skill_run` 提交用户决定，带上最新 revision 及独立的操作编号。
- 按现有模型调用规则扣积分，没有额外的 Skill 固定费用。长流程可能调用多个模型步骤；已成功步骤的费用不会因后续步骤失败一概退回，失败生成按原规则处理。
- 同一次提交/操作重试沿用原编号和参数。新任务固定使用启动时的已发布版本；发布新版本只影响之后的新任务。
- 单独关闭或下架某个 Skill 后，拥有该技能既有任务的用户仍可通过该 MCP 地址查询和取消自己的任务；不能新建、继续或重试。无任务的用户不能读取关闭技能的配置。MCP 总开关关闭时仍会拒绝 MCP 连接。
- Skill 文件、Manifest、私有提示词及步骤输入留在服务端。对外只返回公开输入说明、用户交互所需的草稿和最终产物；模型输出仍可能包含它生成的内容，不承诺绝对防提示词提取。

部署时需要同步更新后端、前端和 MCP 镜像，并在现有 HTTPS vhost 的 `location = /mcp` 旁新增：

```nginx
location ^~ /mcp/ {
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Host 127.0.0.1:8082;
    proxy_set_header Authorization $http_authorization;
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

这里的 `proxy_pass` 不带路径，保留 `/mcp/skills/<技能ID>`。之后执行 `nginx -t && systemctl reload nginx`。

## 前台 Skill 广场与公开安装包

主站导航和创作台侧栏的「Skill 广场」打开 `/skills`，详情为 `/skills/<技能ID>`。目录只展示已开启「对外开放」、已上架且具有已发布版本的技能，支持搜索和分类。关闭后目录、详情、公开 SKILL.md 和安装包均不可访问，MCP 不再接受新任务；已受理任务的所有者仍可查询或取消，原有站内技能入口按原配置运行。

详情页按「怎么用 → 输入什么 → 输出什么」展示，后台新建、编辑与导入均可填写 `inputDescription`（2000 字）、`inputExample`（4000 字）、`outputExample`（6000 字），并复用 `howTo` 和 `outputDescription`。样例支持 Markdown 列表和表格，输入样例可直接复制；这些字段只维护公开展示内容，不改变执行版本和计费。后台 AI 补齐也支持说明与样例，只填空白字段，保存前由管理员核对。旧技能未填写时使用已有说明和明确的提问模板，不生成虚构的执行记录。部署需同步更新前后端，后端启动时自动迁移新增字段。

用户在详情页可以复制安装链接或完整安装指令，交给当前使用的 AI 客户端。页面不展示手动 MCP 配置、源文件预览或 ZIP 下载入口；ZIP 接口仍保留供安装工具使用。公开接口无需登录，使客户端能读取安装说明：

安装名称使用技能标题，例如 `ai-director-video-review`；按 [Agent Skills 命名规范](https://agentskills.io/specification#name-field)将大写转换为小写、空格和符号整理为连字符，并限制为 64 字符。标题无法生成有效名称时回退至已校验原 Skill 的名称，Windows 保留目录名增加 `-skill` 后缀。公开详情的 `skillName`、YAML `name` 和 ZIP 目录保持一致；MCP 连接名和地址仍用稳定技能 ID。安装指令读取最新名称，不将 `flowlight-skill-<id>` 继续作为安装名。旧名称仅在确认同一源站同一技能后备份迁移；新目录已有不同来源或用户自建的同名 Skill 时保留原文件并提示选择，不覆盖或悄悄另取数字名称。

- `GET /api/skill-library`：公开目录（pageNum/pageSize/category/keyword）。
- `GET /api/skill-library/<id>`：公开详情与安装状态。
- `GET /api/skill-library/<id>/SKILL.md`：动态生成的公开调用版 Skill。
- `GET /api/skill-library/<id>/download`：只含 `<公开技能名>/SKILL.md` 的 ZIP。

这些接口不返回原始 Skill 文件、Manifest、私有提示词、默认参数或用户密钥。公开文件自身也经过同一套标准 Skill 校验。执行仍经专属 MCP 并要求使用者自己的主站 API Key，阅读/下载说明不会发起收费任务。

列表和详情提供「复制安装指令」：用户粘贴给当前使用的智能体后，由智能体识别其宿主和能力、下载并校验 SKILL.md、安装到该客户端实际支持的 Skill 位置，并配置专属 MCP。安装与执行分开判定：技能已对外开放、已上架且格式有效即可获取安装包；MCP 总开关关闭、地址暂未配置或用户未设置 API Key，不阻止安装文件。接口通过 `mcpAvailable` / `mcpUnavailableReason` 单独说明连接条件；智能体缺少连接条件时如实报告已完成的安装状态，不会为验证安装自动生成或扣费。缺少地址时不生成空 URL 配置，使用前从保存的来源读取技能详情中的最新地址。

Codex 本地技能与远程 MCP 的安装方式参见 [OpenAI 技能文档](https://developers.openai.com/zh-Hans/docs/build-skills) 和 [MCP 文档](https://developers.openai.com/zh-Hans/docs/extend/mcp)。

复制的安装指令与公开 SKILL.md 都使用客户端无关的 MCP 接入流程，不固定技能目录、CLI 命令或配置文件格式，也不因机器上装了某个 CLI 就认定当前宿主。优先使用当前客户端的 MCP/扩展/连接器管理工具；没有管理工具时才读取该客户端的帮助并只合并本技能连接。已存在的连接复用，保留其他配置与显式停用状态。需分别确认 Agent Skills 和带 Bearer 鉴权的远程 Streamable HTTP 能力；只有本地 stdio 能力不满足专属 Skill 端点要求。只支持远程 MCP 时跳过本地 Skill 文件；只支持 Skill 时可安装说明文件，但应报告无法执行云端技能。没有本地技能目录时使用宿主保存的来源或安装指令，不强求 references/connection.json。

配置后只用本技能专属连接的 get_skill_info 验证，返回的 id 必须匹配且 enabled 为 true 才能报告连接验证通过；不能用另一个 Skill 的同名工具或仅写入配置代替成功验证。不支持热加载时提示重新连接或开启新会话。元数据不可用、MCP 未开放或端点缺失时保留已有文件和配置，不猜测地址；没有可配置的连接时不保存密钥。已安装旧版 Skill 的用户应重新复制安装指令，按内容更新同来源文件，避免旧文档继续引导修改其他软件。

客户端的具体管理方式应以各自文档与当前宿主工具为准，例如 [Goose 的扩展管理](https://github.com/aaif-goose/goose/blob/main/documentation/docs/getting-started/using-extensions.md) 和 [Claude Code 的 MCP 接入](https://code.claude.com/docs/en/mcp)。

登录用户点击「复制安装指令」时，前端通过本人鉴权的默认 Key 接口按需读取密钥，并加入剪贴板中的私人安装指令；使用账号 ID 和 Key 版本核对响应，切换账号或取消请求后不再复制。密钥不进入列表、预览、公开 SKILL.md、分享链接或 ZIP，也不在前端缓存。「只复制链接」不读取密钥。未登录时仍复制不含密钥的通用说明。此操作不会重置或启用已停用的 Key。

需在「MCP 配置」保存正确的对外接入地址；未配置时不会把回环地址或请求 Host 猜测为外部 MCP 地址。技能下架、单项对外开放关闭或原始文件不合规时，安装包停止分发；全局 MCP 关闭仅阻止连接，不阻止合规技能的说明文件安装。已下载的说明仍受执行端鉴权和开关约束。

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

如果安装器报告 `mcpAvailable: false` 且没有 `mcpEndpoint`，先检查主站 `/api/mcp/config`。`publicUrl` 为空时，在后台 MCP 配置中填写完整对外地址并保存；`configured: false` / `revision: 0` 表示尚未保存过配置。

保存地址后仍无法连接时，检查 `/mcp/skills/<技能ID>` 的反向代理。若返回 Next.js 的 HTML 404，而 `/mcp` 能访问，说明宿主机 Nginx 只转发了根入口。按上文加入 `location ^~ /mcp/` 并执行 `nginx -t && systemctl reload nginx`；同时更新 MCP 容器。仅拉取应用镜像不会修改宿主机 Nginx 文件。之后重新复制该技能的安装指令，让智能体补齐本地 MCP 配置。内部健康检查成功并不证明公网专属路由已经接通。

`go test ./...` 使用本地模拟主站及官方 SDK 客户端，覆盖新旧协议、生成参数映射、幂等重试、多用户隔离、Key 失效、积分不足、Origin 限制及密钥不随重定向泄露，不消耗真实生成积分。

- 401：检查主站个人中心的默认 API Key，不能使用供应商 Key。
- 403：检查来源白名单、nginx Host 和任务归属。
- 503：检查主站地址、连通性和生成 API 版本。
- isError：向用户展示工具返回的主站错误，不能擅自换请求编号重生成。
- processing：继续查询任务；MCP 请求结束不表示作品生成完成。
- 主站任务响应缺少 ID/状态或格式异常时，工具会明确报错，不会伪装成生成中。提交响应中断或无法确认时必须用原编号和参数重试。
- 主站积分、生成并发和接口限流仍生效。MCP 请求最大 2 MiB，文件上传走主站接口。

协议参考：[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[官方 SDK](https://github.com/modelcontextprotocol/go-sdk/tree/v1.8.0)。
