# 前端切换到 Go 后端：public_id 适配清单

> 适用范围：`D:\tide-canvas\tide-canvas-web`（Next.js + TypeScript 前端）
>
> 背景：Go 后端把「对外资源 id」改为 **public_id（UUID 字符串）**，旧 Spring Boot 后端对外是数字雪花 id。
> 前端当前实体 id 多为 `number`，切到 Go 后端时**部分**需改为 `string`。**不是所有 id 都改**，按下面规则精确区分。
>
> 判断规则（来自后端约定）：
> - **A 类（→ string）**：对外资源 public_id。user、canvas/project、AiTask、AiModel、file、社区 post、comment、blog、充值 order、team（IM 会话/消息若有也属此类）。
> - **B 类（保持 number）**：数字主键或业务码。role、Banner、email-template、redeem（管理端按数字主键；用户兑换用 `code` 字符串）、points 流水 id、AiGenerationLog 日志 id（及日志里的 taskId/userId/projectId 内部数字）、系统/访问/登录日志。
> - **C 类（永不改）**：分页、total、金额 amount、积分 points/pointCost、status、role 值、各类计数、监控 pid，以及日志/流水里展示的关联 userId/taskId/projectId（内部数字，非对外主键）。
>
> 重要前提：**前端代码当前已大量用 `string | number` 透传 id，且动态路由 `[id]` 取的就是 `string`**。因此本次改动以**类型声明**为主，运行期断点很少。下文逐条给 `文件:行号`。

---

## 0. 结论速览（报告口径）

- **A 类需改的类型实体：13 个**（见 §1 表，含其内部的对外 id 字段）。
- **数字假设点（对 A 类 id 做 number 处理、需改）：6 处**（见 §2）。其中**仅 1 处是运行期功能性破坏**（`admin/authors` 的用户 ID 输入框 `InputNumber`，UUID 无法输入），其余 5 处为类型层 / `useState<number|null>` 句柄。
- **不确定点：3 个**（见 §7）：积分调整的 `userId`、redeem 的 `usedBy/createdBy`、AiProvider 的 id 归类。
- 路由参数（§3）：所有 `[id]` / `[token]` 已按 `string` 取用，**无多余 `Number()`/`parseInt()` 需删**。
- API 层（§4）：`lib/api.ts` 全部 id **纯透传**，绝大多数已是 `string | number`；少数 `(id: number)` 签名建议放宽为 `string | number`（非必须，运行期不破）。

> 本文档**不修改任何 .ts/.tsx**，仅为前端开发的执行清单。

---

## 1. 类型字段改动表（`src/types/*.ts`）

> 「改动」列：`→ string` = 必须改；`保持 number` = 不要动。「类」列对应 A/B/C 判断依据。

### 1.1 用户 user — A 类 → string

| 文件:行号 | 字段 | 现类型 | 改动 | 后端实体/依据 |
|---|---|---|---|---|
| `types/user.ts:2` | `UserVO.id` | number | **→ string** | user（A） |
| `types/user.ts:9` | `UserVO.roleId?` | number | 保持 number | 引用 role（B，角色为数字主键） |
| `types/user.ts:16` | `UserVO.teamId?` | number \| null | **→ string \| null** | 引用 team（A） |
| `types/user.ts:26` | `UserSimpleVO.id` | number | **→ string** | user（A） |

> `UserVO` 其余字段（points、apiQuota、storageQuota、isAuthor、status、role、teamPriceFactor）均为 C 类，保持 number。

### 1.2 画布项目 canvas/project — A 类 → string

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/canvas.ts:5` | `ProjectVO.id` | number | **→ string** | project（A） |
| `types/canvas.ts:7` | `ProjectVO.ownerId?` | number | **→ string** | 归属 user（A） |
| `types/canvas.ts:18` | `ProjectDetailVO` | extends ProjectVO | 随基类 | A |

> `ProjectDetailVO.owner: UserSimpleVO` 的 id 随 §1.1 一起变 string。`status/isPublic` 等 C 类不动。`urlToken/shareToken` 本就是字符串，不受影响。

### 1.3 AI 任务 / AI 模型 — A 类 → string；日志为 B 类

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/ai.ts:6` | `AiGenerateDTO.projectId?` | string \| number | 已兼容（可收窄为 string） | project（A），**已是 string\|number** |
| `types/ai.ts:11` | `AiTaskVO.id` | number | **→ string** | AiTask（A） |
| `types/ai.ts:24` | `AiModelVO.id` | number | **→ string** | AiModel（A） |
| `types/ai.ts:42` | `AiHandlerVO.defaultModelId` | number | **→ string** | 引用 AiModel（A） |
| `types/ai.ts:49` | `AiTaskQuery.projectId?` | string \| number | 已兼容 | project（A） |
| `types/ai.ts:53` | `AiGenerationLogVO.id` | number | **保持 number** | 日志主键（B） |
| `types/ai.ts:54` | `AiGenerationLogVO.taskId` | number | **保持 number** | 日志内关联（C，内部数字） |
| `types/ai.ts:55` | `AiGenerationLogVO.userId` | number | **保持 number** | 日志内关联（C） |
| `types/ai.ts:56` | `AiGenerationLogVO.projectId` | number | **保持 number** | 日志内关联（C） |
| `types/ai.ts:83-85` | `AiGenerationLogQuery.taskId/userId/projectId` | number | **保持 number** | 日志筛选（C） |

> `AiTaskVO.resultUrl/progress/status`、`AiModelVO.pointCost`、`AiHandlerVO.pointCost` 等 C 类不动。

### 1.4 文件 file — A 类 → string

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/file.ts:4` | `FileVO.id` | number | **→ string** | file（A） |
| `types/file.ts:6` | `FileVO.ownerId?` | number | **→ string** | 归属 user（A） |

> `fileSize` C 类不动；`fileType/storageType` 为枚举字符串，不受影响。

### 1.5 社区 post / comment — A 类 → string

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/community.ts:4` | `PostVO.id` | number | **→ string** | post（A） |
| `types/community.ts:5` | `PostVO.userId` | number | **→ string** | 作者 user（A） |
| `types/community.ts:26` | `CommentVO.id` | number | **→ string** | comment（A） |
| `types/community.ts:27` | `CommentVO.userId` | number | **→ string** | 评论者 user（A） |
| `types/community.ts:31` | `CommentVO.parentId` | number \| null | **→ string \| null** | 父 comment（A） |
| `types/community.ts:56` | `CommentCreateDTO.parentId?` | number | **→ string** | 父 comment（A） |
| `types/community.ts:62` | `PostQuery.userId?` | number | **→ string** | 作者 user（A） |

> `viewCount/likeCount/commentCount`、`PostUpdateDTO.status` 等 C 类不动。

### 1.6 博客 blog — A 类 → string

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/blog.ts:4` | `BlogVO.id` | number | **→ string** | blog（A） |
| `types/blog.ts:5` | `BlogVO.authorId` | number | **→ string** | 作者 user（A） |
| `types/blog.ts:54` | `BlogQuery.authorId?` | number | **→ string** | 作者 user（A） |

> `pointsRequired/viewCount/likeCount/tipTotal`、`BlogTipDTO.amount` 等 C 类不动。

### 1.7 充值订单 order — A 类 → string

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/order.ts:4` | `RechargeOrderVO.id` | number | **→ string** | order（A） |

> `orderNo` 本就是字符串业务单号；`amount/pointsAmount/status` 等 C 类不动。

### 1.8 团队 team — A 类 → string

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/team.ts:2` | `TeamMemberVO.userId` | number | **→ string** | user（A） |
| `types/team.ts:13` | `TeamVO.id` | number | **→ string** | team（A） |
| `types/team.ts:15` | `TeamVO.ownerId` | number | **→ string** | 归属 user（A） |

> `TeamMemberVO.role`（团队内角色 0/1）、`memberCount`、`priceFactor` 为 C 类，保持 number。

### 1.9 后台聚合视图 admin（部分 A）

| 文件:行号 | 字段 | 现类型 | 改动 | 依据 |
|---|---|---|---|---|
| `types/admin.ts:57` | `ActiveUserVO.id` | number | **→ string** | user（A） |
| `types/admin.ts:66` | `AdminUserVO` | extends UserVO | 随 §1.1 变 string | user（A） |
| `types/admin.ts:192-193` | `ContentVO.id` | number | **→ string** | 审核内容=项目/帖子（A，见 §7 备注） |

> `AdminUserUpdateDTO.role/roleId/status/apiQuota/storageQuota`（admin.ts:72-78）：`roleId` 引用 role（B，**保持 number**），其余 C 类。`DashboardOverviewVO`/`Daily*VO`/`NameValueVO`（admin.ts:4-55）全是计数 C 类，保持 number。

### 1.10 明确保持 number 的实体（B 类，**不要改**）

| 文件:行号 | 字段 | 依据 |
|---|---|---|
| `types/role.ts:12` | `RoleVO.id` | role 数字主键（B） |
| `types/admin.ts:87` | `BannerVO.id` | Banner 数字主键（B） |
| `types/email-template.ts:10` | `EmailTemplateVO.id` | email-template 数字主键（B） |
| `types/redeem.ts:4` | `RedeemCodeVO.id` | redeem 管理端数字主键（B）；用户兑换用 `code` 字符串（redeem.ts:5） |
| `types/redeem.ts:8` | `RedeemCodeVO.createdBy?` | 引用 user，见 §7 不确定点 |
| `types/redeem.ts:12` | `RedeemCodeVO.usedBy?` | 引用 user，见 §7 不确定点 |
| `types/points.ts:9` | `PointsTransactionVO.id` | 流水 id（B） |
| `types/points.ts:10` | `PointsTransactionVO.userId` | 流水内关联（C，内部数字） |
| `types/points.ts:15` | `PointsTransactionVO.bizId` | 流水关联业务 id（C，内部数字） |
| `types/points.ts:31` | `PointsTransactionQuery.userId?` | 流水筛选（C，见 §7） |
| `types/admin.ts:133/152/174` | `LogVO.id` / `AccessLogVO.id` / `LoginLogVO.id` | 日志主键（B） |
| `types/admin.ts:134/153/175` | `LogVO.userId` / `AccessLogVO.userId` / `LoginLogVO.userId` | 日志内关联（C，内部数字，可为 null） |
| `types/admin.ts:106` | `AiProviderVO.id` | AI 供应商，见 §7 不确定点（默认按 B 保持 number） |

### 1.11 与 id 无关、不受影响

- `types/api.ts`：`PageData.total/pageNum/pageSize/pages`、`PageQuery.pageNum/pageSize`、`Result.code/timestamp` 全是 C 类。
- `types/monitor.ts`：`pid`、内存/CPU 等全是 C 类。
- `stores/use-canvas-store.ts`：`CanvasNode.id`、`Connection.id/sourceId/targetId`、`CanvasGroup.id/nodeIds` 是**前端本地生成的字符串**（`node_xxx`/`group_xxx`，见 `generateNodeId` line 118），与后端 id 无关，保持 string。`currentProjectId: string | null`（line 62）**已是 string**，无需改。
- IM 会话/消息：前端**当前不存在**对应类型/接口（已全量检索 `Conversation/Message/Im/Chat`，无命中），本次无改动；后端若上线 IM，新类型按 A 类用 string。

---

## 2. 数字假设点（对 A 类对外 id 做了 number 处理 → 需改）

> 说明：以下只列**对 A 类 id 的 number 假设**。对 B/C 类数字（分页、金额、status、points、流水/日志内 userId 等）的 `Number()`/`parseInt()` **已刻意排除，不要动**（见 §6）。

| # | 文件:行号 | 现状 | 改法 | 严重度 |
|---|---|---|---|---|
| 1 | `app/admin/authors/page.tsx:24` 配合 `:124` | `const [grantUserId, setGrantUserId] = useState<number \| null>(null)`，并用 `<InputNumber … value={grantUserId} onChange={setGrantUserId}>` 让管理员**输入用户 ID** | **运行期破坏**：用户 public_id 是 UUID，`InputNumber` 无法输入。把 state 改为 `string`，把 `InputNumber` 换成普通 `Input`（去掉 `min={1}`），`grant(grantUserId)` 透传字符串 | 高（功能性） |
| 2 | `app/admin/authors/page.tsx:26,93` | `const [revokingId, setRevokingId] = useState<number \| null>(null)`；`loading={revokingId === a.id}`（`a.id` 为 AdminUserVO.id，A 类） | state 改 `string \| null`；`handleRevoke(userId: number)`（:59）形参改 `string` | 中（类型层） |
| 3 | `app/(public)/community/page.tsx:36` 配合 `:69,261,268` | `const [menuOpenId, setMenuOpenId] = useState<number \| null>(null)`；与 `post.id`（A 类）比较 | state 改 `string \| null`（`menuOpenId !== null` 判空写法仍有效） | 中（类型层） |
| 4 | `app/(public)/community/[id]/page.tsx:35` 配合 `:108,144` | `const [replyTo, setReplyTo] = useState<{ id: number; nickname: string } \| null>(null)`，`id` 取自 `comment.id`（A 类），并作为 `parentId: replyTo?.id` 发送 | `id` 改 `string`（联动 §1.5 的 `CommentVO.id`、`CommentCreateDTO.parentId`） | 中（类型层） |
| 5 | `app/(auth)/user/orders/page.tsx:35-37` 配合 `:68,85,102,138,142,148` | `cancellingId/payingId/syncingId: useState<number \| null>`；与 `order.id`（A 类）比较，`handleCancel/Pay/Sync(id: number)` | state 与三个 handler 形参改 `string`（透传到 `orderApi.cancel/pay/sync`） | 中（类型层） |
| 6 | `app/admin/orders/page.tsx:38` 配合 `:87` | `const [payingId, setPayingId] = useState<number \| null>(null)`；`loading={payingId === o.id}`（order.id，A 类） | state 改 `string \| null`；`handleConfirmPay` 形参改 `string` | 中（类型层） |

> 同类「按钮 busy 句柄」`useState<number|null>` 还出现在下列页面，均与 **A 类 id** 比较，建议一并改 `string | null`（与 §1 对应实体联动）：
> - `app/(auth)/user/blogs/page.tsx:30` `deletingId` ↔ `blog.id`（A）
> - `app/admin/files/page.tsx:38` `deleting` ↔ `file.id`（A）
> - `app/admin/contents/page.tsx:29` `auditing` ↔ `content.id`（A，`handleAudit(id: number)`@:52 形参改 string）
> - `app/admin/ai/models/page.tsx:138` `editingId` ↔ `model.id`（AiModel，A）
>
> **以下 `useState<number|null>` 是 B/C 类，保持 number，不要改：**
> - `app/admin/banners/page.tsx:28` `editingId` ↔ `BannerVO.id`（B）
> - `components/canvas/canvas-history-panel.tsx:30` `expandedId` ↔ `AiGenerationLogVO.id`（B 日志主键）
> - `app/admin/ai/logs/page.tsx:56,57` `taskId/userId`（C，日志内部数字筛选）

### 2.1 type 层的显式 number 断言（可选放宽，运行期不破）

| 文件:行号 | 现状 | 说明 |
|---|---|---|
| `hooks/canvas/use-ai-generation.ts:120` | `aiApi.getTask(taskId as number)`；`taskId` 形参为 `string \| number`（:105），实参为 `res.data.id`（AiTaskVO.id，A 类） | `AiTaskVO.id` 改 string 后，`as number` 仍能拼进 URL（模板字符串），运行期不破；建议去掉 `as number` 并把 `aiApi.getTask` 签名放宽（见 §4） |

---

## 3. 路由参数（`app/**/[id]`、`[token]`）

Next.js 动态路由 `params.id` / `params.token` **本来就是 `string`**。逐一核对，所有页面均按字符串取用，**没有多余的 `Number()`/`parseInt()` 需要删除**，切换后无需改动：

| 文件:行号 | 取参 | 用途 | 结论 |
|---|---|---|---|
| `app/(public)/blogs/[id]/page.tsx:25` | `const blogId = params.id as string` | `blogApi.get/like/purchase/tip(blogId)` | 已 string，OK |
| `app/(public)/community/[id]/page.tsx:22` | `const postId = params.id as string` | `communityApi.get/listComments/...(postId)` | 已 string，OK |
| `app/(auth)/community/[id]/edit/page.tsx:14` | `const postId = params.id as string` | `communityApi.get(postId)` | 已 string，OK |
| `app/(auth)/user/blogs/[id]/edit/page.tsx:24` | `const blogId = params.id as string` | `blogApi.get(blogId)`（经 blog-form） | 已 string，OK |
| `app/(canvas)/canvas/[id]/page.tsx:20` | `const token = params.id as string` | **此处 `[id]` 实为 `urlToken`（字符串）**，调 `projectApi.getByToken(token)`（:48） | 已 string，OK |
| `app/(public)/share/[token]/page.tsx:9` | `const token = params.token as string` | 分享 token（本就是字符串） | OK |

> 补充：`app/(canvas)/canvas/[id]/page.tsx:51-52` 取真实项目 id 时写的是 `setProjectId(String(res.data.id))` / `setCurrentProjectId(String(res.data.id))`——**已显式 `String(...)` 包裹**，`ProjectVO.id` 无论 number 还是 string 都正确（`String(string)` 是幂等的），切换后零改动。

---

## 4. API 调用确认（`lib/api.ts`、`lib/http.ts`）

**结论：id 全部纯透传，无需为「值」做任何改动。** `lib/http.ts` 的 `buildUrl` 用 `String(value)` 拼 query（:24），路径 id 由各 api 方法用模板字符串 `${id}` 拼接——number/string 都正确。

- **已是 `string | number`（最佳，零改动）**：`projectApi.*`（:79-92）、`aiApi.generate/listTasks`（projectId）、`communityApi.*`（:345-360）、`blogApi.*`（:367-382）、`fileApi.delete`（:139）。
- **签名为 `(id: number)`，建议放宽为 `string | number`（非必须，运行期靠模板字符串仍工作）**：
  - `aiApi.getTask/cancelTask`（:100-103）— AiTask（A）
  - `fileApi.get`（:137）— file（A）
  - `adminApi.users.get/update`（:203-206）、`adminApi.contents.audit`（:211）、`adminApi.ai.models.update/delete`（:237-238）— user/content/AiModel（A）
  - `adminApi.authors.grant/revoke`（:308-311）、`adminApi.points.adjust({userId})`（:294）— user（A），**配合 §2#1 必改**
  - `adminApi.orders.get/pay`（:316-319）、`orderApi.get/cancel/pay/sync`（:396-405）— order（A），**配合 §2#5/#6**
  - `teamApi.removeMember(userId)`（:71）— user（A）
- **保持 `(id: number)`（B 类，不要动）**：`adminApi.roles.*`（:197-198）、`adminApi.banners.*`（:219-222）、`adminApi.emailTemplates.*`（:265-271）、`adminApi.redeem.updateStatus/delete`（:256-257）、`adminApi.logs/accessLogs/loginLogs.remove`（:276/282/288）、`adminApi.ai.logs.get`（:247）。
- **本就字符串**：`projectApi.getByToken`、`redeemApi.redeem(code)`（:166）、`adminApi.ai.providers.remoteModels(id: string)`（:231）、`adminApi.ai.handlers.update(name)`（:242）。

> 即使不放宽这些 `(id: number)` 签名，把 §1 的 VO id 改成 `string` 后，调用处会 **TS 报「string 不能赋给 number」编译错误**——按报错把对应 api 形参改 `string | number` 即可，逻辑零改动。

---

## 5. A 类 id 的等值比较（联动校验，务必前后端一起切）

下列处对**两个 A 类 id 做 `===`/`!==` 严格比较**（user.id 与资源的 ownerId/userId/authorId）。只要两侧**同时**变成 string，比较仍成立；**风险在于一侧已是 string 而另一侧仍是 number**（`"7" === 7` 恒为 false，会静默判错权限/归属）。改 §1 类型时这些点会自动一致，无需改逻辑，但要一起验证：

| 文件:行号 | 比较 | 含义 |
|---|---|---|
| `app/(auth)/community/[id]/edit/page.tsx:54` | `post.userId !== user.id` | 是否本人帖子（编辑鉴权） |
| `app/(auth)/user/blogs/[id]/edit/page.tsx:68` | `blog.authorId !== user.id` | 是否本人博客 |
| `app/(auth)/user/assets/page.tsx:133` | `file.ownerId === user?.id` | 素材是否本人（团队共享标识） |
| `app/(auth)/user/projects/page.tsx:77` | `project.ownerId !== user?.id` | 项目是否队友（团队共享角标） |
| `app/(public)/community/page.tsx:200` | `user.id === post.userId` | 列表项是否本人（显隐菜单） |
| `app/(public)/community/[id]/page.tsx:184` | `user.id === post.userId` | 详情是否本人 |
| `app/(public)/blogs/[id]/page.tsx:172` | `user?.id === blog.authorId` | 博客是否本人 |

> `app/admin/email-templates/page.tsx:121,165`（`t.id === current.id`）比较的是 EmailTemplate（B），两侧都是 number，**不在此列**。

### 5.1 仅展示、不影响逻辑（A 类 id 渲染，可不改）

切到 UUID 后下面只是「显示更长/取末段意义变弱」，不报错、不破坏功能，按需美化即可：

- `app/admin/users/page.tsx:120`、`app/admin/contents/page.tsx:63`：`String(v).slice(-6)` 显示 id 末 6 位——UUID 同样能跑，仅语义变化。
- `app/admin/ai/models/page.tsx:211,244,296`：`String(p.id) === form.providerId`、`value: String(p.id)`——已用 `String()` 包裹，number/string 皆可（AiProvider 见 §7）。

---

## 6. 不变项清单（B、C 类——切换时**严禁误改**）

避免「一刀切把所有 id 改 string」误伤这些点：

**B 类实体 id（保持 number）**：`RoleVO.id`、`BannerVO.id`、`EmailTemplateVO.id`、`RedeemCodeVO.id`、`PointsTransactionVO.id`、`AiGenerationLogVO.id`、`LogVO.id`、`AccessLogVO.id`、`LoginLogVO.id`。（对应 §1.10）

**C 类（保持 number）**：
- 分页/响应：`PageQuery.pageNum/pageSize`、`PageData.total/pages`、`Result.code`。
- 金额/积分/计数：`amount`、`pointsAmount`、`points`、`pointCost`、`pointsRequired`、`viewCount/likeCount/commentCount/tipTotal`、`memberCount`、`DashboardOverviewVO.*`、`Daily*VO.*`、`NameValueVO.value`。
- 状态/枚举值：`status`、`role`（数字角色值）、`OrderStatus`/`PointsTransactionType`/`UserStatus`/`UserRole`/`ProjectStatus`/`AiTaskStatus` 枚举。
- 监控：`SystemMetricsVO.pid`、CPU/内存等。
- **日志/流水里展示或筛选的关联 id（内部数字，非对外主键）**：`AiGenerationLogVO.taskId/userId/projectId`、`AiGenerationLogQuery.taskId/userId/projectId`、`PointsTransactionVO.userId/bizId`、`LogVO/AccessLogVO/LoginLogVO.userId`。

**对应的「不要动」代码点（这些 `Number()`/`parseInt()` 是 B/C 类，保留）**：
- `app/(auth)/user/recharge/page.tsx:32` `Number.parseInt(customInput,10)`（充值金额，C）
- `app/admin/users/page.tsx:97` `Number(adjustAmount)`（积分金额，C）
- `app/admin/points/page.tsx:32` `Number(filterUserId)` + `:78-85` `<Input type="number">`（积分流水的内部 userId 筛选，C；但**见 §7 不确定点**）
- `app/admin/points/page.tsx:89`、`app/admin/contents/page.tsx:91`、`app/admin/login-logs/page.tsx:42`、`app/admin/redeem/page.tsx:41`、`app/admin/ai/logs/page.tsx:77`：`Number(status/type/success)`（状态/类型码，C）
- `app/admin/ai/logs/page.tsx:99-100` `…/^\d+$/.test() ? Number(...)`（日志内 taskId/userId 筛选，C——**正确做法，保留**）
- `app/admin/ai/logs/page.tsx:87,148,211` `Number(cost).toFixed(4)`（成本金额，C）
- `app/admin/page.tsx:55-60` 图表 `Number(d.newUsers/value/pv/...)`（计数，C）
- `components/shared/form-fields.tsx:55`、`components/blog/blog-form.tsx:283`、`components/canvas/nodes/*`（音量/时长/档位/积分单价等 C 类）
- `lib/points.ts:9` `Number(user.teamPriceFactor)`（系数，C）

---

## 7. 不确定点（需后端确认）

1. **积分调整接口的 `userId`**（`app/admin/users/page.tsx:104` `adminApi.points.adjust({ userId: adjustTarget.id })`，及 `lib/api.ts:294`）：这里 `adjustTarget.id` 取自 `UserVO.id`（**A 类，将变 string**），但 `PointsTransactionVO.userId` / `PointsTransactionQuery.userId`（`app/admin/points/page.tsx:32`）是**流水里的内部数字 userId（C 类）**。两者同名但语义不同。
   - 若 Go 后端 `points/adjust` 接收**用户 public_id 字符串** → `adjust` 的 `userId` 入参随 `UserVO.id` 改 string；而流水查询的 `userId` 是否仍是数字需确认。
   - 若后端仍用数字 userId 定位用户 → 维持现状，但 `adjustTarget.id`（string）需要后端能接受。**请后端明确 `points/adjust` 与 `points/transactions?userId=` 两处 userId 的类型。**

2. **redeem 的 `usedBy` / `createdBy`**（`types/redeem.ts:8,12`）：兑换码实体本身是 B 类（数字主键），但这两个字段引用 user（A 类）。前端目前**未在任何页面读取/比较**这两个字段（已检索），保持现状即可；但若后端把它们也改为 user public_id 字符串，应同步把这两字段改 `string`。**请后端确认这两个外键的对外表示。**

3. **AiProvider 的 id**（`types/admin.ts:106`，`app/admin/ai/providers/page.tsx:41`、`app/admin/ai/models/page.tsx:211/244/296`）：AI 供应商不在 A 类清单里（清单只点名 AiModel）。默认按**管理端内部配置（B 类，保持 number）**处理。代码已用 `String(p.id)` 比较/取值，无论 number/string 都能跑。**若 Go 后端把 provider 也改成 public_id 字符串，请告知**，届时 `AiProviderVO.id` 改 string、`app/admin/ai/providers/page.tsx:41` 的 `editingId` 改 `string | null`。

---

## 8. 风险提示与落地建议

- **前后端必须一起切、不可混连**：前端连**旧 Spring Boot** 后端时 id 是**数字雪花**；连 **Go** 后端时是 **UUID 字符串**。一旦把 §1 的 VO id 改成 `string` 而仍连旧后端，旧后端返回的数字 id 会被 JS 当 string 处理——透传/拼 URL 仍能跑，但 §5 的 `user.id === post.userId` 这类**跨字段严格比较会因「number vs string」静默失效**（鉴权/归属判断出错）。
- **建议联调顺序**：① 后端 Go 接口确认对外 id 形态 → ② 一次性改完 §1 类型 + §2 的 6 个数字假设点（尤其 §2#1 的 InputNumber）→ ③ 跑 `tsc`/`next build`，按编译错误把 §4 中 `(id: number)` 签名放宽为 `string | number` → ④ 重点回归 §5 的 7 个权限/归属比较点与 §2#1 的「按用户 ID 授权作者」功能。
- **雪花 id 精度提醒（连旧后端时）**：旧后端数字雪花 id 超出 JS `Number.MAX_SAFE_INTEGER`，若后端以 JSON number 下发可能已丢精度——这也是改用字符串 public_id 的好处之一。切到 Go 后端、id 变 UUID 字符串后该问题自然消除。
- **本次零改动的好底子**：动态路由 `[id]`（§3）、`lib/api.ts` 透传（§4）、`use-canvas-store` 的 `currentProjectId: string`、`canvas/[id]/page.tsx` 的 `String(res.data.id)` 包裹——这些已是字符串友好的写法，是迁移负担小的主要原因。
