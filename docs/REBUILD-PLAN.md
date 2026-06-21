# TideCanvas 全栈重建方案

> 分支: flowingLight（仅在此分支工作）· 日期: 2026-06-21
> 目标: 前端移植 claude.ai/design「流光(liuguang)」整套设计为 React/Next；后端用 Go(Gin+GORM)+MySQL+Redis 重写。

## 0. 已定决策
- **设计源**: 流光 / liuguang（`design-ref/首页-流光.html` + `design-ref/liuguang/*`）。app/*.jsx 仅作通用逻辑/组件参考（mesh 渐变、部分交互），背景用 `liuguang/flux-field.js`(WebGL 流场)。
- **构建顺序**: 前端先行（全页面 + mock 数据）+ Go 后端骨架，再逐页接真接口。
- **后端栈**: Go + Gin + GORM + MySQL + Redis + JWT。响应信封 `Result<T>`/`PageData<T>`，雪花 ID 序列化为字符串，401 写进 body 触发前端刷新。

## 1. 前端移植策略（高保真、低返工）
1. **CSS 直接复用**: 把 `design-ref/liuguang/{flux,pages,studio,admin,chat}.css` 拷进 `src/styles/liuguang/` 作为全局样式（基本原样保留 `:root` 变量与全部组件类 .hero/.console/.cap-grid/.coverflow/.mcard/.ws-rail/.mgrid 等）。在对应 layout 里 import。
2. **结构移植**: 每页 HTML 结构 → TSX 客户端组件，沿用相同 class 名；把 `liuguang/*.js` 的渲染逻辑(innerHTML 模板)与事件改写成 React state/map/onClick。
3. **主题令牌**: 同时在 `globals.css` 加 Tailwind 4 `@theme`（见设计令牌报告：bg `#05060c`，accent `#6d8bf5/#9b7bf0/#57c9e8`，字体 Sora/Space Grotesk/JetBrains Mono/Noto Sans SC），供新代码用工具类。
4. **字体**: `next/font` 加载（或保留 Google Fonts link）。
5. **背景**: `FluxField` 客户端组件移植 `flux-field.js`（WebGL）；全局噪点 `body::after`。
6. **数据**: 设计全是 mock（mesh 渐变占位、无真实图）。先把 `home-data.js`/`models.js` 等移植为 `src/mock/*.ts`，VO 的 cover/avatar 字段为真实 URL、空时回退 `mesh()` 渐变。

## 2. 路由（Next App Router）
- `(site)` 组（顶栏+页脚，来自 `shell.js`）:
  - `/` 首页（首页-流光 / home-render.js）— 现有 `/` 重定向改为此页
  - `/explore` 作品广场（explore.js）
  - `/models` 模型市场（models.js）
  - `/pricing` 定价（pricing.js）
- `(studio)` 组（左侧 ws-rail，来自 创作台.html）:
  - `/studio` 创作台（create.js）
  - `/chat` 对话（chat.js）
  - `/inspire` 灵感（inspire.js）
  - `/assets` 资产（assets.js）
- 复用现有 `(canvas)`: `/canvas/new`、`/canvas/[id]`、`/projects`。**ws-rail 的「画布」项接到 `/projects`（画布项目枢纽）**，不重建编辑器。
- `/admin` 后台（admin.js，17 个子模块：数据概览/用户/作品/灵感/日志/首页楼层/发现/模型/资源/积分/营销/价格/支付/配置/邮件/角色…）。
- 弃用 design-ref 中的探索性文件：`首页方案.html`、`布局方案.html`、`SCARECROWAI.html`、`layouts/*`。

## 3. 后端（Go + Gin + GORM + MySQL + Redis）
**信封**: `Result[T]{success,code,message,data,timestamp(ms)}`、`PageData[T]{records,total,pageNum,pageSize,pages}`。`code` 用业务码(200/400/401/403/404/429/500/1001…/2001…/3001…)。雪花 `ID int64` 自定义 JSON 序列化为字符串。
**端点分组**（auth/projects/ai/files 照搬现有 `src/lib/api.ts` 契约；其余按设计扩展）:
- `/api/auth/*`（email-code/register/login/refresh/logout/me/password/profile）
- `/api/projects/*`（CRUD + `/canvas` 存取 + `/share` + `/token/:token` 公开打开）
- `/api/ai/*`（generate/grid-split/tasks 轮询/cancel/models/handlers/logs）
- `/api/files/*`（upload/batch/presign/register/list/save-from-url/:id）
- 扩展: `/api/community`(作品广场/点赞/关注/评论) `/api/blog` `/api/points`(余额/记录/签到) `/api/orders`+`/api/billing`(定价/充值/支付回调) `/api/market`(模型市场) `/api/im`(对话, WebSocket `/ws/im`) `/api/notifications` `/api/banners`+`/api/home/feed` `/api/admin/*`
**核心表(GORM)**: user, canvas_project, ai_provider, ai_model, ai_task, ai_generation_log, sys_file, 及 community_post/post_comment/post_like/user_follow/blog_article/point_record/checkin_record/order/market_model/im_*/notification/banner/team/sys_role。软删除 `gorm.DeletedAt`，create_time/update_time。
**Redis**: 邮箱验证码、refresh token 存储/轮换、access 黑名单、用户缓存、限流、AI 并发控制、AI 异步任务状态/进度(轮询源)+队列(asynq)、签到幂等、订单状态、IM 在线/未读/pubsub、热门列表缓存。
**项目结构**: `cmd/{api,worker}` + `internal/{config,router,middleware,handler,service,repository,model,dto,vo,ai/{handler,provider},pkg/{response,idgen,jwt,cache,storage},ws}` + `migrations`。
**库**: gin, gorm+driver/mysql, gormigrate, go-redis/v9, golang-jwt/v5, validator/v10, bwmarrin/snowflake, hibiken/asynq, spf13/viper, gorilla/websocket, aliyun-oss-go-sdk, x/crypto/bcrypt, zap, shopspring/decimal, gomail。

## 4. 执行分期（每期一个 workflow，期间我回到主循环复核）
- **Phase A 前端基础**（多为串行/小并行，先做）: liuguang CSS 入库 + `globals.css` @theme + 字体 + `FluxField` 背景 + UI 原子(Icon/Avatar/Cover/mesh) + mock 数据模块 + `(site)` 布局(nav/footer) + `(studio)` 布局(ws-rail)。→ 构建通过。
- **Phase B 站点页(并行)**: `/`、`/explore`、`/models`、`/pricing`。
- **Phase C 工作室页(并行)**: `/studio`、`/chat`、`/inspire`、`/assets`；接「画布」→ `/projects`。
- **Phase D 后台**: `/admin` 框架 + 17 子模块（分批并行）。
- **Phase E Go 后端骨架(可与 B/C 并行)**: 项目脚手架 + 响应信封/ID/JWT/中间件 + MySQL/Redis 接入 + auth/projects/ai/files 端点 + GORM 模型 + 迁移；其余端点占位。
- **Phase F 接线**: 逐页把 mock 换成真实 API；AI 生成走任务轮询；上传走 presign/register。

## 5. 验证
- 前端: `npx tsc --noEmit` + `npm run build`（路由表含全部页面）；`npm run dev` 逐页目测对照 design-ref。
- 后端: `go build ./...` + `go vet`；起服务 + MySQL/Redis；用前端 `http.ts` 契约打通 auth→projects→ai→files。
- 端到端: 登录 → 进 `/projects` → `/canvas` 编辑器自动保存；站点/工作室页渲染与 design-ref 一致。

## 6. 备注
- 现有前端此前已精简为 canvas-only；本方案会以新设计重新建起 site/studio/admin。`package.json` 已有 antd/recharts/react-markdown/three 等，按需复用(three 用于画布 3D 节点)。
- 后端鉴权与匿名访问策略：公开页(首页/广场/定价/分享)允许匿名；创作/资产/项目需登录。具体匿名边界在 Phase F 接线时按页确认。
