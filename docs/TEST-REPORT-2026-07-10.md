# 全系统测试缺陷报告 — 2026-07-10

> 本文档由一次完整的系统级测试(7 路并行:公开 API / admin API / 公开站 UI /
> 后台 UI / 端到端链路 / 边界畸形输入 / 并发资金)产出,记录所有**待修复**缺陷,
> 供后续维护者认领修复。约 620 个用例,核心健壮性良好(无 panic、无越权、无 SQL
> 注入、无全表泄漏、鉴权守卫全通),下列为发现的真实缺陷。
>
> **测试基线 commit**: `50873e6`(+ 当时工作区未提交的后台 UI 抛光改动)。
> 修复前请先复现,并注意本仓连的是**远程生产库**,测试写操作务必用 `TEST-` 前缀并清理。
>
> 严重度定义:**P0** 数据/资金损坏或安全 · **P1** 功能错误 · **P2** 体验/契约瑕疵 · **P3** 文档漂移。

---

## 目录

- [P0-1 退款并发导致用户余额变负](#p0-1)
- [P1-1 GORM `default` 吞掉创建时的 false/0 零值(禁用实体落库为启用)](#p1-1)
- [P1-2 admin plans/channels/rules 缺输入校验,DB 约束冲突暴露为 500](#p1-2)
- [P1-3 inspiration collections/prompts 传非 JSON tags 直接 500](#p1-3)
- [P1-4 FluxBg `destroy()` 调 `loseContext()` 永久毒化 canvas](#p1-4)
- [P2-1 AdminGuard 遇失效 token 卡死无限 spinner](#p2-1)
- [P2-2 config map 回退可创建任意垃圾键且无删除接口](#p2-2)
- [P2-3 删除不存在资源返回 200(漏查 RowsAffected)](#p2-3)
- [P2-4 楼层 type 唯一冲突返回裸 500](#p2-4)
- [P2-5 refund 不存在订单返回 400 而非 404](#p2-5)
- [P2-6 pricing/首页 FAQ 收起项漏出答案首行](#p2-6)
- [P2-7 移动端主导航无汉堡菜单](#p2-7)
- [P2-8 创建响应回显持久化前内存值](#p2-8)
- [P2-9 OSS 图床缺 CORS 头(基础设施)](#p2-9)
- [P3 契约/文档漂移集](#p3)
- [附:全部通过项](#pass)

---

<a name="p0-1"></a>
## 🔴 P0-1 退款并发导致用户余额变负

**文件**: `tide-canvas-server/internal/handler/admin/g4_payments.go` · `refundOrder` (行 191–267,扣分段 226–239)

**现象**: 稳定复现(退款×退款 40/40 命中;退款×积分调整 8/60 命中)。同一用户两笔退款并发,或退款与积分消费/调整并发时,用户 `points` 被扣成**负数**,破坏"余额不为负"不变式。

**根因**: 回收积分时先做**非锁快照读**再做**无守卫扣减**:
```go
// 行 226:非锁快照读当前余额
if err := tx.Select("id", "points").Where("id = ?", refunded.UserID).First(&u); ...
deduct := granted
if u.Points < deduct { deduct = u.Points }   // floor 基于陈旧快照
// 行 236:无守卫扣减
UpdateColumn("points", gorm.Expr("points - ?", deduct))
```
两个并发退款各自读到 `points=500`,各自算出 `deduct=500`,各自 `points - 500` → 最终 `-500`。两个扣减互不感知。

**对照(项目内已有的正确实现)**:
- `internal/handler/admin/g4_points.go` 的 `adjust`:用 `SELECT ... FOR UPDATE` 行锁
- `internal/handler/points/ledger.go` 的 `mutate`:用守卫 SQL `WHERE points >= -delta`

**可达性**: 管理员退款是常规操作,且用户侧 AI 生成会走 `points.Consume`、admin 会走 `adjust`,三者都与退款竞争同一 `users` 行。真实可达。

**建议修复(二选一,都在现有 `db.Transaction` 内)**:
1. 回收前对 users 行加锁:`tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id","points").First(&u)` —— 与 `adjust` 一致,序列化同用户的并发写。
2. 守卫 SQL 在同一原子写内计算 floor:`UPDATE users SET points = points - LEAST(points, ?) WHERE id = ?`,再依 `RowsAffected`/回读确定实际扣减量,据此回填 `point_record` 的 `amount`/`balance`。

**复现脚本**: `scratchpad/conc-fixture/`(`fixture` 夹具置订单已支付+造 recharge 流水;`stress-refund-vs-refund.mjs`、`stress-refund-vs-spend.mjs`)。⚠️ 只对夹具自造 TEST 用户跑,勿碰真实数据。

**注**: `settleOrder`(状态抢占 + `points + ?` 原子表达式)、`adjust`(FOR UPDATE)、`Consume`(守卫)三条路径本身安全,负余额缺口**仅在 refundOrder**。退款不回收 `vip_level` 是有意设计(注释已说明,不是 bug)。

---

<a name="p1-1"></a>
## 🟠 P1-1 GORM `default` 吞掉创建时的 false/0 零值(禁用实体落库为启用)

**现象(跨 7+ 张表实测复现)**: 凡模型列带 `gorm:"...default:true"` 或 `default:1`,用结构体 `Create` 时若客户端传 `false`/`0`,GORM 视其为**零值而跳过**,落库为 DB 默认值,且创建响应静默回显默认值:

| 接口 | 传入 | 落库/回显 | 危害 |
|---|---|---|---|
| `POST /api/admin/plans` | `status:0`(下架/草稿) | `status:1` | **测试套餐被直接上架到公开定价页** |
| `POST /api/admin/pay/channels` | `enabled:false` | `enabled:true` | 本应禁用的收款渠道被启用 |
| `POST /api/admin/home/floors` | `enabled:false` | `enabled:true` | 本应隐藏的楼层直接上首页 |
| `POST /api/admin/inspiration/collections` | `visible:false` | `visible:true` | 本应隐藏的合集直接可见 |
| `POST /api/admin/points/rules` | `enabled:false` | `enabled:true` | 禁用规则被启用 |
| `POST /api/admin/email/templates` | `enabled:false` | `enabled:true` | 禁用模板被启用 |
| `POST /api/admin/email/api-keys` | `enabled:false` | `enabled:true` | 禁用密钥被启用 |

**根因**: 相关模型的 `default` 标签 + handler 用结构体 `Create`。GORM 对结构体零值字段不写入,交由 DB default。涉及标签(非穷举):
- `internal/model/admin_billing.go:22`(PayChannel.Enabled)、`:40`(PointRule.Enabled)
- `internal/model/admin_content.go:20`(Collection.Visible)、`:60`(PromptLib.Enabled)
- `internal/model/admin_system.go:111`(EmailTemplate.Enabled)、`:129`(ApiKey.Enabled)
- `internal/model/billing.go:58`(Plan.Status)、`market.go:19/60`(MarketModel.Status,同机理)

**建议修复(任一)**:
1. 这些字段改指针类型(`*bool` / `*int`)或 `sql.Null*`,handler 显式区分"未提供"与"传了 false"。
2. handler 在 `Create` 后紧跟一次 `Updates(map[string]any{...})` 显式补写这些字段(map 不受零值跳过影响)。
3. handler 用 `Select("*")` 或指名列强制写入零值。

**优先级理由**: "禁用套餐意外上架公开定价页"是**面向付费用户的可见事故**,建议随 P0 一并修。

---

<a name="p1-2"></a>
## 🟠 P1-2 admin plans/channels/rules 缺输入校验,DB 约束冲突暴露为 500

**现象**: 这几个创建/更新接口缺少 `tools` 那样的 DTO `binding` 校验层,导致合理或极端管理员输入触发 DB 列约束冲突,以**不友好 500** 而非 400/409 返回:

| # | 接口 | 输入 | 实际 | 根因 |
|---|---|---|---|---|
| a | `POST /api/admin/plans` | `monthly:1e18` | 500 `failed to create plan` | `Plan.Price` = `decimal(10,2)`(上限 99999999.99)溢出 |
| b | `POST /api/admin/plans` | `{name:"x"}`(无 code) | 500 | `Plan.Code` 有 uniqueIndex,空 code 已被占,唯一键冲突 |
| c | `POST /api/admin/pay/channels` | `rate:99999.99` | 500 `failed to create channel` | `PayChannel.Rate` = `decimal(6,4)`(上限 99.9999)溢出;费率并非极端值,管理员易误填 |
| d | `POST /api/admin/points/rules` | `name` 长 65536 | 500 `failed to create rule` | `name`/`scene` = `varchar(64)` 但 DTO 无 `max` 绑定 → "Data too long" |
| e | `POST /api/admin/plans` `/pay/channels` | `monthly:-100`、`rate:-5` | **200 落库** | 无非负校验,负价/负费率静默入库 |

**对照(正面范例)**: `internal/handler/admin/g3_tools.go` 的 DTO 有 `binding:"max=64"` 等,超长返回友好 400。

**建议修复**: 给 `g4_pricing.go`(Plan)、`g4_payments.go`(PayChannel)、`g4_points.go`(PointRule)的 DTO 补 `binding` 校验:字符串 `max` 对齐列长度;数值加范围(价格 `gte=0,lte=99999999.99`、费率 `gte=0,lte=1` 或按业务)、非负;`Plan.Code` 加 `required` 并在 handler 查重返回 409。

---

<a name="p1-3"></a>
## 🟠 P1-3 inspiration collections/prompts 传非 JSON tags 直接 500

**文件**: `tide-canvas-server/internal/handler/admin/g2_inspiration.go`(collections / prompts 创建)

**现象**:
```
POST /api/admin/inspiration/collections
{"title":"TEST","tags":"测试,TEST",...}
→ 500 {"success":false,"code":500,"message":"failed to create collection"}
```
prompts 同。`tags` 列是 MySQL `json` 类型,传逗号分隔字符串导致写库失败冒泡成 500。

**根因**: DTO 对 `tags` 无校验(前端 `types/admin-inspiration.ts` 也仅标 `string`),但底层是 json 列,只接受合法 JSON 数组。

**建议修复**: handler 校验 `tags` 为合法 JSON(或空),否则 400;或后端把逗号分隔字符串规整成 JSON 数组再落库。前端类型与输入组件同步约束。

---

<a name="p1-4"></a>
## 🟠 P1-4 FluxBg `destroy()` 调 `loseContext()` 永久毒化 canvas

**文件**: `tide-canvas-web/src/components/site/flux-field.ts:360`(`destroy()` 内)+ `tide-canvas-web/src/components/site/flux-bg.tsx`(effect)

**现象**: 首页 `#flux-bg` 始终带 `flux-fallback`(退化成 CSS 渐变),背景切换器 `.bg-nav-btn` 不渲染;console `FluxField shader error: null` ×2。dev 模式 + headed GPU 均复现。

**根因**: `destroy()` 调 `WEBGL_lose_context.loseContext()` 主动丢弃上下文。React dev StrictMode 对 `flux-bg.tsx` 的 effect 做「挂载→清理→重挂载」,同一 canvas 第二次 `getContext("webgl")` 拿回的是**已丢失的旧 context**(`isContextLost()===true`)→ shader 编译必败(infoLog 为 null)→ `mountFluxField` 返 null → `store.deactivate()` → 切换器条件 `active && allowSwitch` 永假。context loss 对 canvas 是**粘性**的。

**影响范围限定**: dev StrictMode 双跑是**触发器**;**生产构建单次挂载不触发**(已验证:`npm run build && npm run start` 下流光正常渲染、切换器出现、`isContextLost:false`、像素非零)。但 `flux-bg.tsx` 的 effect deps(`preset`/`intensity`/`allowSwitch`)任何一次变更引发的 effect 重跑,在**生产同样会毒化** canvas —— 属真实潜在脆弱点。

**建议修复(任一)**:
1. `destroy()` 不调 `loseContext()`(rAF/监听器/observer 已单独清理,足够;去掉这行即可,风险最低)。
2. 重挂载时检测 `gl.isContextLost()`,若丢失则替换为新 canvas 节点或 `restoreContext()`。

**验证**: 把该行置空后,dev 下流光正常、切换器出现、极光→深海 orb 正确变色且 `localStorage.flux_bg_preset=ocean` 持久化。

---

<a name="p2-1"></a>
## 🟡 P2-1 AdminGuard 遇失效 token 卡死无限 spinner

**文件**: `tide-canvas-web/src/components/admin/admin-guard.tsx:26–27` + `tide-canvas-web/src/stores/use-auth-store.ts`(`ensureSession`)

**现象**: localStorage 存在一个已登出吊销 / 过期且无法刷新的 `access_token` → 访问 `/admin` → `/api/auth/me` 返回 401 → `fetchUser` 清 token → `ensureSession` 返回 `false` → AdminGuard 的 `if (!ok || !mounted) return;` 直接返回,`state` 永停在 `"checking"` → 页面只剩转圈,不跳登录页(等 6 秒仍停留 `/admin`)。

**根因**: `ensureSession` 只在「入口无 token」分支里 `window.location.href=/login`;「有 token 但被 401 清除」路径返回 false 后**无人负责跳转**。AdminGuard 注释("No token → ensureSession redirects to /login")与实际不符。真实场景:登出后按浏览器返回键回 `/admin`、或 token 自然过期。

**建议修复**: AdminGuard 在 `ok===false`(且已无有效会话)时补跳转:`window.location.href = /login?redirect=/admin`(与 line 32 的 no-user 分支一致)。

**证据**: `scratchpad/admin-ui/token-recheck.png`。

---

<a name="p2-2"></a>
## 🟡 P2-2 config map 回退可创建任意垃圾键且无删除接口

**文件**: `tide-canvas-server/internal/handler/admin/g5_config.go`(`bindConfigItems` 的 map 回退)

**现象**: `PUT /api/admin/config` body `{"name":"x"}` → 200,**静默创建** `sys_config` 行 `config_key="name"`。`bindConfigItems` 把任意 JSON 对象当作 `key→value` 落库,**零 key 白名单**。且 config **无 DELETE 接口** → 误建的垃圾键无法经 API 删除。

**建议修复**: map 回退加已知 key 白名单校验(未知 key 拒绝或忽略);补一个受限的 config 删除接口(或至少支持删除非基线键)。

**已知残留**: 测试期间经此路径误建了 `sys_config` 键 `name`,已按约定置空串(`value=""`,`group=""`),因无删除接口无法经 API 清除,需 DBA 手动删除或加接口后清理。

---

<a name="p2-3"></a>
## 🟡 P2-3 删除不存在资源返回 200(漏查 RowsAffected)

**现象**: `DELETE` 对不存在 id 的语义不一致:
- **返回 200 success(漏查 `RowsAffected`)**: `/api/admin/plans/:id`、`/pay/channels/:id`、`/points/rules/:id`、`/notifications/:id`
- **正确返回 404**: roles / works / models / home-floors / collections / prompts / email-templates / api-keys

**建议修复**: 前四个删除 handler 检查 `res.RowsAffected == 0` 时返回 404,与其余接口对齐。

---

<a name="p2-4"></a>
## 🟡 P2-4 楼层 type 唯一冲突返回裸 500

**文件**: `tide-canvas-server/internal/handler/admin/g3_floors.go`(create)

**现象**: `POST /api/admin/home/floors` `{"name":"TEST","type":"作品流"}` → 500 `failed to create floor`(`home_floor.type` uniqueIndex 冲突)。

**建议修复**: 识别 duplicate-key 错误返回 400/409 + 可读信息("该楼层类型已存在")。属 P1-2 同类模式(DB 约束→裸 500),可一并处理。

---

<a name="p2-5"></a>
## 🟡 P2-5 refund 不存在订单返回 400 而非 404

**文件**: `tide-canvas-server/internal/handler/admin/g4_payments.go` · `refundOrder`

**现象**: `POST /api/admin/orders/999999999999999999/refund` → 400「仅已支付订单可退款」。claim-update(`WHERE id=? AND status=1`)的 `RowsAffected==0` 无法区分"订单不存在"与"状态不符"。

**建议修复**: `RowsAffected==0` 时先查订单是否存在,不存在返回 404,存在但状态不符才返回 400。

---

<a name="p2-6"></a>
## 🟡 P2-6 pricing/首页 FAQ 收起项漏出答案首行

**文件**: `tide-canvas-web/src/styles/liuguang/pages.css:182–184`

**现象**: `/pricing` 与首页 FAQ 所有**收起**的 `.faq-item` 都可见答案首行(视觉"半开")。class 切换逻辑正常(`.open` 增删正确),纯视觉泄漏。

**根因**: `.faq-a{grid-template-rows:0fr; overflow:hidden}` 折叠,但 `.faq-a-in{padding:0 22px 20px}` 的底部 20px padding 使收起态 `.faq-a` 仍有 ~20px 高,`overflow:hidden` 恰好裁出一行文字。

**建议修复**: 把 padding 从 `.faq-a-in` 移到内层不参与折叠的元素,或折叠态用 `visibility`/`padding:0` 归零;确保 `0fr` 时实测高度为 0。

**证据**: `scratchpad/site-ui/pricing-anon-faq.png`。

---

<a name="p2-7"></a>
## 🟡 P2-7 移动端主导航无汉堡菜单

**文件**: `tide-canvas-web/src/styles/liuguang/flux.css:428`(`.nav-links{display:none}`)、`:431`(≤560px 连"登录"也隐藏)

**现象**: ≤880px 时主导航 `.nav-links` 隐藏且**无任何替代入口**(无汉堡菜单),手机上无法从导航到达 作品广场/创作台/价格,只能靠页脚。

**建议修复**: 移动端补一个汉堡菜单/抽屉承载主导航(后台侧栏已有移动抽屉可参考实现)。

**证据**: `scratchpad/site-ui/home-m390-anon-mobile-top.png`。

---

<a name="p2-8"></a>
## 🟡 P2-8 创建响应回显持久化前内存值(与库不一致)

**现象**: `POST /api/admin/plans` `monthly:0.1+0.2` → 响应 `0.30000000000000004`,但 DB `decimal(10,2)` 实存 `0.30`。创建/更新返回的是**持久化前的内存对象**,客户端看到与库不一致的值。

**根因**: handler 用 `Create(&row)` 后直接把 `row` 序列化返回,未回读 DB 舍入后的真值。

**建议修复**: 写入后回读该行(或对 decimal 字段先做与列精度一致的舍入)再返回。与 P1-1 的"响应回显默认值"同源(都是回显未落库的内存态),可一并处理。

---

<a name="p2-9"></a>
## 🟡 P2-9 OSS 图床缺 CORS 头(基础设施,非代码)

**现象**: `/studio` 与 `/models`(登录态)console 每页刷 4–6 条 CORS 错误:
```
Access to image at 'https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/canvas/uploads/gen/….png'
from origin 'http://localhost:3000' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header…
```
来源: `tide-canvas-web/src/components/studio/create-studio.tsx:120` 环境光采样用 `crossOrigin="anonymous"` 加载生成图。**页面功能与图片显示均正常**(有静默回退到中性黑影)。

**建议修复**: 在 OSS bucket 配置 CORS 规则允许站点 origin(基础设施侧,非应用代码)。若短期无法配 CORS,可评估去掉环境光采样的 `crossOrigin` 或改用同源代理。

---

<a name="p3"></a>
## 🔵 P3 契约/文档漂移集(非功能缺陷)

| # | 位置 | 漂移 |
|---|---|---|
| 1 | `tide-canvas-web/src/types/ai.ts` `AiTaskVO` | 缺后端 `vo.go:49` 序列化的 `pointCost int64` 字段(前端展示任务扣费无类型支持) |
| 2 | `tide-canvas-web/src/types/admin-tools.ts` | 注释称 `cover: null clears`,但后端 `*[]int` 对 null 视为"未提供、保持不变",实际无清除路径 |
| 3 | `tide-canvas-web/src/types/admin-email.ts` `ApiKeyVO.keyValue` | 注释未说明列表/更新响应是**掩码值**(仅创建时明文) |
| 4 | `tide-canvas-web/src/types/admin-users.ts` | role 注释 "0 user / 1 vip / 9 admin",后端实际口径 "0 user / 9 admin" |
| 5 | `AdminModerationReviewDTO`(works moderation review 请求体) | 无对应 TS 镜像类型 |
| 6 | `tide-canvas-server/internal/handler/chat/register.go` 顶部注释 | 只列 4 条路由,实际挂载 10 条(rename/remove/stream/append/turn/context 未列) |

---

<a name="pass"></a>
## ✅ 全部通过项(健壮性确认)

- **公开 API 契约**: 99 用例 98 PASS(唯一 P2 见 P3-1),全部公开读接口 200 + VO 逐字段对齐,时间/id 字符串化/tags 序列化形式均正确。
- **鉴权守卫**: 所有需登录接口不带 token / 篡改签名 / 垃圾 token → 全部 401 结构化错误,无一 500。
- **边界/注入/畸形输入**: 分页(0/负/超大/非数字)全部钳制或 400、**无全表返回**;ID 注入(`1 OR 1=1`、`'; DROP TABLE`、`../etc/passwd`、`%00`)全部解析为 int → 400/404,**SQL 注入与路径穿越完全失效**;截断 JSON/空 body/错 Content-Type/1MB body/6 万层嵌套 → 全部结构化 400;**全程无 panic、无栈崩溃**,所有 500 均为显式 `response.Fail` 干净 JSON。
- **并发资金(除 P0-1 外全稳)**: 退款幂等(×10 只成功 1 次、只扣一次)、积分调整原子性(±100×10 精确对账)、reorder 并发一致(无重复 sortOrder、无丢行)、积分回收下限(余额不足退到 0 不为负,单退款路径下)。`settleOrder`/`adjust`/`Consume` 三条路径均安全。
- **端到端链路(8/8 PASS)**: 首页全局配置 / 楼层开关 / 楼层排序 / 工具上下架 / 页脚链接 / 定价套餐 / 通知触达 / 作品社区联动,后台改 → 公开 API 生效 → 前台页面生效 → 逐字节恢复,全部走通。
- **后台 UI(131 项检查 127 PASS)**: 15 页表格/筛选/分页/弹窗校验/拖拽排序/搜索/开关/移动抽屉/未登录守卫拦截,均正常(FAIL 项即 P2-1)。
- **admin API CRUD(15 组 ~120 用例)**: 全组守卫/分页/筛选/CRUD/校验错误路径通过(缺陷即上列 P1-1/2/3、P2-2/3/4/5)。
- **前端 types 契约**: 14 个 `admin-*.ts` 逐字段核对与实测响应一致(除 P3 的文档级出入)。

---

## 测试资产位置

测试脚本、截图、复现夹具均在会话 scratchpad(易失,如需长期保留请归档):
`.../scratchpad/` 下 `api-test.mjs`、`site-ui/`、`admin-ui/`、`e2e/`、`conc-fixture/`、`refund-fixture/` 等。

## 修复优先级建议

1. **立即**: P0-1(资金) + P1-1(禁用实体变启用,含"套餐意外上架")—— 数据/资金完整性。
2. **尽快**: P1-2(admin 校验) + P1-3(tags 500) + P1-4(flux 脆弱点)。
3. **排期**: P2 系列(guard spinner / 删除 404 / FAQ 视觉 / 移动导航 / 回显一致性 / config 白名单)。
4. **跟进**: P2-9(OSS CORS 基础设施) + P3(类型/文档对齐)。
