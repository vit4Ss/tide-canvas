# TideCanvas 架构(as-built)

> 分支 flowingLight · 2026-06-21 · 全栈:Next.js 前端(已构建通过)+ Go 后端(已编写,待 `go build`)

## 1. 仓库结构
```
tide-canvas/
├── tide-canvas-web/      # 前端 Next.js 16 + React 19 + Tailwind 4(146 个 TS/TSX)
│   ├── src/app/          # App Router:(site) (studio) (canvas) admin + projects
│   ├── src/components/   # canvas/ flux/ site/ studio/ admin/ project/ shared/ ui/
│   ├── src/styles/liuguang/  # 设计原版 CSS(flux/pages/studio/admin/chat)
│   ├── src/mock/         # 移植自设计的 mock 数据(带 TS 类型)
│   ├── src/lib/ src/stores/ src/types/ src/hooks/
│   └── design-ref/       # claude.ai/design「流光」原始稿(HTML/CSS/JS + app/*.jsx 参考)
├── tide-canvas-server/   # 后端 Go(Gin+GORM+MySQL+Redis)(59 个 .go)
└── docs/                 # PRD.md / REBUILD-PLAN.md / ARCHITECTURE.md
```

## 2. 前端架构
**路由(28 条,4 个分区):**
- `(site)`(深色流光主题,顶栏 nav + 页脚 + FluxField 背景):`/` 首页 · `/explore` 作品广场 · `/models` 模型市场 · `/pricing` 定价
- `(studio)`(左侧 ws-rail):`/studio` 创作台 · `/chat` 对话 · `/inspire` 灵感 · `/assets` 资产
- `(canvas)` + `/projects`(沿用旧编辑器,shadcn 主题):`/projects` 项目枢纽 · `/canvas/new` · `/canvas/[id]` 无限画布节点编辑器
- `admin`(独立 sidebar+topbar):`/admin` 概览 + 14 子模块(users/works/models/discover/resources/points/pricing/payments/marketing/inspiration/home-floors/logs/config/email)

**主题隔离(关键):** liuguang CSS 按路由组在各自 layout 内 import → 站点/工作室/后台为深色流光;`/canvas`、`/projects` 不引入,保留原 shadcn 主题,**互不串色**(已验证)。字体(Sora/Space Grotesk/JetBrains Mono/Noto Sans SC)在 root layout 全局 `<link>`。

**分层:**
- 视图:每页 `"use client"` TSX,沿用 liuguang 原 class;动态逻辑(打字机/筛选/手风琴/生成模拟)从 `liuguang/*.js` 改写为 React state。
- 共享:`components/flux`(FluxField WebGL 背景、Icon、Avatar/Cover/Logo)、`lib/mesh.ts`(渐变占位)、`components/admin`(AdminTable/Modal/StatCard…)。
- 数据:`src/mock/*`(全 mock,封面是 mesh 渐变三元组,空值回退渐变);真实接口层在 `lib/api.ts` + `lib/http.ts`(`Result` 信封解析、401 自动刷新、上传进度/OSS 直传回退)。
- 状态:Zustand(`use-canvas-store` 画布、`use-auth-store` 鉴权)。

## 3. 后端架构(Go)
**分层(internal/):** `handler`(Gin handler+service+repo+dto+vo,每域自包含)→ `model`(GORM 实体)→ MySQL;横切 `middleware`、`pkg/*`。
```
cmd/api/main.go            启动:载配置→连 MySQL/Redis→AutoMigrate→Gin→注册各域路由
internal/
  config/  app/  db/  middleware/  model/
  handler/{auth,project,ai,file,stub}/   # stub = 扩展域占位
  pkg/{response,idgen,token,cache,storage,logger}
```
**契约对齐(与前端强一致):**
- `response.Result[T]{success,code,message,data,timestamp(ms)}` + `PageData[T]{records,total,pageNum,pageSize,pages}`
- `idgen.ID`(int64,JSON 序列化为**字符串**,避免 JS 大数精度丢失)
- JWT:access+refresh,401 写进 body 触发前端刷新;refresh 轮换 + access 黑名单(Redis)
- 业务错误码枚举(1001/2001/3001…)

**已实现域(对应前端现有 api.ts):** auth(注册/登录/刷新/登出/me/改密/资料)、project(CRUD+画布存取+分享+`/api/shared/:token` 公开打开)、ai(generate/任务轮询/取消/models/handlers/logs,Handler 注册表+Provider 接口为桩)、file(上传/批量/presign/register/列表/detail/删除,本地存储)。
**占位域(stub,Phase F 填充):** community/blog/points/orders+billing/market/im/notifications/banners/home/admin。

**数据模型(28 张表):** user, project, ai_provider/model/handler/task/generation_log, file + community_post/comment/like, user_follow, blog_*, point_record, checkin_record, order/plan/point_package, market_model/category, im_*, notification, banner, team, sys_role。雪花 ID,软删除,create/update_time。

**Redis 用途:** 邮箱验证码、refresh 存储/轮换、access 黑名单、用户缓存、限流、AI 并发控制、AI 任务状态/进度(轮询源)、签到幂等、热门缓存。

## 4. 关键数据流
- **打开画布:** `/canvas/[urlToken]` → `projectApi.getByToken` → `GET /api/shared/:token`(公开)→ 加载 canvasData JSON → 自动保存 `PUT /api/projects/:id/canvas`。
- **AI 生成:** 前端 `aiApi.generate` → 后端建 `ai_task`(Redis 存进度)+ 后台 goroutine 执行 → 前端轮询 `GET /api/ai/tasks/:id`。
- **上传:** `uploadFileSmart` → `presign`(本地返回 direct:false)→ 回退 `POST /api/files/upload` → 本地存储 + `/static` 提供访问。

## 5. 构建 / 运行
- 前端:`cd tide-canvas-web && npm run dev`(:3000)。已验证 `tsc` 0 错、`next build` 28 路由全绿。
- 后端:`cd tide-canvas-server && go mod tidy && go run ./cmd/api`(:8080),需本地 MySQL + Redis;配置见 `configs/config.yaml`。

## 6. 状态与待办
**完成:** 前端整套设计移植(Phase A–D,构建通过、主题隔离已验证);Go 后端骨架编写 + gin 路由去冲突(Phase E)。**Go 1.26 已安装;后端 `go mod tidy` + `go build ./...` + `go vet ./...` 全部 EXIT 0,产出 19.6MB 可执行二进制。**
**待办:**
- **运行所需基础设施**:启动 MySQL + Redis(可用 Docker),配置 `configs/config.yaml`,`go run ./cmd/api` 起服务(:8080)。
- **Phase F 前后端接线**:各页 mock 换真实 API;新增前端 api 模块/类型(community/blog/points/orders/market/im/admin);AI 走任务轮询;上传走 presign。需后端跑起来。
- **补缺口**:✅ 已补 `GET /api/files/download?url=...`(公开 fetch-and-stream 代理,画布组件在用);剩:扩展域 stub 填充真实逻辑。
- **鉴权边界**:公开页(首页/广场/定价/分享)匿名;创作/资产/项目需登录——接线时按页定。
- **视觉走查**:本机无浏览器截图工具,流光视觉细节需人工 `npm run dev` 核对。
