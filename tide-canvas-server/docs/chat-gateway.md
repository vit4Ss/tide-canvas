# 对话网关（OpenAI 兼容接口，供 Codex 等客户端使用）

主站在 `/api/integrations/v1` 下提供一组 OpenAI 兼容接口。用户用自己账号的默认 API Key（`tc_sk_…`，见 [用户默认 API Key](user-api-keys.md)）直接调用后台「AI 聊天供应商」里开放的模型，主站按真实 Token 用量从该账号积分结算。供应商的地址和密钥只存在服务端，客户端拿不到。

原先内嵌的 AI 聊天页面（LobeHub）已经移除。这条接口链路、后台「AI 聊天供应商」配置和 Token 计费逻辑保持不变，并新增了 Responses 协议端点，使 Codex 可以直接接入。

## 与站内文本能力的分界

## 定价：原价、默认单价与倍率

- 每个模型行上的单价是运营填的**原价**（积分 / 1M Token，输入、输出分开）。
- 供应商可设**默认单价**：新拉取的模型自动带上它；保存默认单价时也会填给该供应商尚未定价的模型，已填过的不动。
- 供应商可设**倍率**（十进制字符串，如 `0.7`；留空即 1）：实收价 = 原价 × 倍率，四舍五入到六位小数。目录（`GET /models`）、预留和结算用的都是实收价；模型行仍显示原价，后台另列实收价。
- 倍率或原价任一无法解析时，该模型从目录撤下、调用被拒绝，不会退回按原价出售（`chatgateway.effectivePricing`）。


- **站内**（创作台的文本生成、技能、MCP 的 `run_skill`）继续使用「模型管理」里的文本模型，按次计费，不经过本网关。
- **API Key 调用文本**一律走本网关，按 Token 计费。为此 `/api/open/v1/models` 里的文本模型改为本网关的目录（`type: text`，`modelId` 为 `flowinglight/<model_key>`，`config` 为 tokenPricing，`endpoint` 指向 `/responses`，`billing: token`），不再出现「模型管理」里的按次文本模型；`/api/open/v1/handlers` 不列文本能力；`/api/open/v1/generations` 收到文本能力（`assistant_chat`、`skill_text_completion`）时返回业务码 2003 并指向本网关，不预留也不扣费。MCP 没有文本生成工具，其 `list_models` 读的是同一个生成模型列表，因此也不再出现文本模型。

## 接口

| 接口 | 协议 | 说明 |
|---|---|---|
| `GET /api/integrations/v1/models` | OpenAI 模型列表 | 返回已开放的模型。`id` 形如 `flowinglight/<model_key>`，`token_pricing` 是每百万 Token 的积分单价，已按供应商倍率折算为实收价 |
| `POST /api/integrations/v1/responses` | OpenAI Responses | **Codex 用的端点。** 网关把请求转成供应商的 Chat Completions 调用，再把流式结果转回 Responses 事件 |
| `POST /api/integrations/v1/chat/completions` | OpenAI Chat Completions | 供 SDK 与其他客户端使用。请求原样转给供应商，只替换模型名、补上输出上限和用量统计 |

鉴权统一为 `Authorization: Bearer tc_sk_…`。模型名可以用列表里的 `flowinglight/<model_key>`，也可以直接用 `<model_key>`；发给供应商的始终是供应商自己认识的 `<model_key>`。

代码在 `internal/handler/chatgateway/`：`gateway.go` 是共用的路由解析、预扣、供应商调用与结算；`responses.go` 是 Responses ⇄ Chat Completions 的转译；`chatpool.go` 把模型解析到供应商地址（多地址按顺序故障转移）；`token_billing.go` / `billing_api.go` 是结算与账单接口。

## 接入 Codex

Codex 自 2026 年 2 月起只支持 Responses 协议（`wire_api = "chat"` 已被移除，写了会在启动时报错），所以必须走 `/responses`。在用户级配置 `~/.codex/config.toml` 中加入（项目内的 `.codex/config.toml` 不接受 `model_providers`）：

```toml
model = "flowinglight/deepseek-chat"   # 从 GET /models 返回的 id 里选
model_provider = "flowinglight"

[model_providers.flowinglight]
name = "流光"
base_url = "https://你的主站域名/api/integrations/v1"
env_key = "FLOWLIGHT_API_KEY"
wire_api = "responses"
```

然后 `export FLOWLIGHT_API_KEY=tc_sk_…` 后启动 Codex。Codex 会在 `base_url` 后拼 `/responses`。

Responses 请求的转译规则：

- `instructions` → `system` 消息；`input` 里的 `message` 项按角色映射（`developer` → `system`）；纯文本内容折叠为字符串，只有 `user` 消息里带 `input_image` 时才保留数组形式。
- `function_call` 项并入前一条 assistant 消息的 `tool_calls`；`function_call_output` → `tool` 消息。
- `tools` 只保留 `type: "function"`（`web_search`、`local_shell`、`custom` 等托管工具类型丢弃）；`tool_choice`、`parallel_tool_calls` 随工具一起传递。
- `max_output_tokens` → `max_completion_tokens`（再被模型单价里的 `maxOutputTokens` 钳制）；`reasoning.effort` → `reasoning_effort`；`text.format` 的 `json_schema` / `json_object` → `response_format`；`temperature`、`top_p` 直传。
- `reasoning` 项、`store`、`include`、`prompt_cache_key` 等只有 OpenAI 托管运行时才能用的字段被丢弃。`previous_response_id` 直接返回 400：网关不保存对话，客户端要像 Codex 一样把完整历史放进 `input`。

流式响应事件：`response.created` → `response.output_item.added` / `response.output_text.delta` / `response.function_call_arguments.delta` / `response.reasoning_summary_text.delta` → `response.output_item.done` → `response.completed`（带 `usage` 和 `billing`）。失败时最后一个事件是 `response.failed`，其 `response.error.code` 按 Codex 的分类给出：供应商 4xx 拒绝 → `invalid_prompt`（Codex 不重试，直接显示供应商原话），429 → `rate_limit_exceeded`，5xx / 连不上 → `server_is_overloaded`（Codex 会退避重试）。

## 计费

每个模型只有 Token 计价一种模式，单价在「AI 聊天供应商 → 模型」里按每百万 Token 填写（输入 / 输出 / 缓存输入），没填单价的模型不会出现在列表里、也不能调用。

1. 调用开始时按「输入上限 + 输出上限」的最坏成本**预留**积分（`X-Point-Reserved`），写入 `model_gateway_request` 一行，状态 `pending`。积分不足时返回 HTTP 429 `insufficient_quota`，不会碰供应商。
2. 网关始终以流式向供应商请求并要求 `stream_options.include_usage`。结束后按供应商返回的 `usage` 结算实际费用，费用非零时向上取整为整数积分，未用完的预留释放；结算结果进入积分流水（`AI 聊天 Token 计费：<model_key>`）。
3. 非流式响应用 `X-Point-Cost` 头和 `billing` 字段报告实际积分；流式响应在 `[DONE]` 之前多一帧 `{"choices":[],"billing":{…}}`（Chat Completions）或在 `response.completed` 的 `response.billing` 里（Responses）。
4. 供应商没有返回可信用量时，行状态变为 `billing_pending`，预留不释放，管理员在后台「积分管理 → Token 调用账单」核对后结算或释放。生成失败且没有任何输出时预留全额退回。
   待核对期间实扣金额为 0，不把候选费用当作扣款。人工结算要求明确填写输入、输出 Token（0 合法，缺失或 null 拒绝）；处理时重新检查管理员当前的积分权限。
5. 崩溃遗留的 `pending` 行由启动时的 reconciler 每分钟扫描，超过 65 分钟未结算的按 `worker_interrupted` 结算。
   已完整读取的上游结果与用量会在积分事务之前单独持久化。若随后结算写库失败，恢复时使用这份用量和原价格快照，不能把它当作无输出释放预留；缺少可靠用量但已有输出的仍进入人工核对。

账单接口：用户 `GET /api/chat-gateway/billing`（JWT），管理员 `GET /api/admin/chat-gateway-billing` 与 `POST /api/admin/chat-gateway-billing/:id/resolve`（需要 `admin.points`）。

`Idempotency-Key` 请求头（或请求 ID）相同且请求体相同时，重放不重复扣费，直接回放已存的结果；请求体不同返回 409 `idempotency_conflict`；原请求仍在生成时返回 409 `request_in_progress`。

## 限额与错误

### API 调用记录

个人中心的 API Key 区域和 API 文档可进入 `/api-usage`；后台入口为
`/admin/chat-usage`，沿用 `admin.models` 权限。用户只看本人，管理员可按用户 ID 筛选。

- 用户查询：`GET /api/chat-gateway/usage`（登录 JWT）；后台查询：`GET /api/admin/chat-gateway-usage`。
- 仅包括 API Key 在 `/api/integrations/v1/chat/completions` 或 `/responses` 被受理并预留成功的调用。
  身份校验、余额或参数校验未通过的请求不创建计费行；同一请求重放不增加记录。
- 来源以 `source=api_key_chat_provider` 固定保存，不按模型名称关联。旧记录来源无法确证，
  仍在原 Token 账单中查询，不混入新列表；「模型管理」调用的原记录逻辑不变。
- 显示输入/输出/缓存/推理 Token、结算积分、预留、客户端协议和响应方式、时间。
  未取得可靠用量显示 `—`；缓存属于输入、推理属于输出，不额外相加。
- 首字是从发起上游到第一个正文/推理/工具输出的耗时，总耗时包含备用切换和上游读取，
  不包含向客户端重放/传输及数据库结算时间。进程被中断时未采集的耗时留空。
- 后台另外显示请求 IP、实际供应商、接入地址 ID、上游 HTTP 状态及计价供应商。
  名称和价格按调用时快照保存，供应商修改/删除不改变历史。无请求正文、密钥或上游地址输出。
- 筛选支持 `model`（字面子串）、`status`、`protocol=chat|responses`、`stream=true|false`、
  `startDate/endDate=YYYY-MM-DD`（北京时间含结束日）、`pageNum/pageSize`（最大 100）。
  列表及统计应用同一筛选，实扣积分不包含冻结额度，并减去同一用户/调用的真实退款流水；原始结算金额仍保留。

### 与「我的生成记录」的边界

两套价格独立：`chat_model` 按输入/输出/缓存 Token 单价和供应商倍率计费；
`market_model` 的文本生成（包括 MCP/Agent Skill 中间步骤）继续按每次模型调用固定积分收费，
不读取 `chat_model` 的 Token 单价。相同 model key 也不会合并路由或价格。
每次非零 Token 费用沿用现有向上取整为整数积分规则；按次文本忽略图片的 batchCount、清晰度等残留参数。
一套 Skill 若实际执行三次文本模型调用，分别记录三笔按次费用，而不是按工作流入口再扣一笔 Token 费用。
它们共用用户余额和积分流水；Token 已预留部分不能被同时进行的按次生成花掉。

- 本节的 API 调用记录只查询 `model_gateway_request` 中明确标记的聊天供应商调用。
- MCP 生成工具和 Agent Skill 工作流仍使用 `ai_tasks` / `ai_generation_logs`。
  用户「我的生成记录」(`/api/ai/history`) 包含自己各模型步骤的文本、图片、视频、音频结果，
  包括中间步骤和最终结果。不会另外创建账单或再次扣费，也不复制进 API 聊天调用记录。
- 每步显示原扣费、实际退款和净消耗；退款以正向积分流水为准，不根据任务成功/失败猜测。
- Skill 历史只返回用户输入、产物和安全字段，不返回私有提示词、Manifest 和供应商报文。
  新记录保存安全输入/结果及费用快照，旧步骤从所属用户的任务/SkillRun 安全补齐。
- 创作台和资产库继续按最终素材筛选，不因此显示内部文本卡或在模型选择器加入文本模型。

| 情形 | HTTP | `error.code` |
|---|---|---|
| 模型未开放 / 单价缺失 | 404 | `model_not_available` |
| 供应商没有可用地址 | 503 | `upstream_unavailable` |
| 积分不足以预留 | 429 | `insufficient_quota` |
| 账号并发达到上限（`chatGateway.maxConcurrent`，默认 2；账号开了不限并发则跳过） | 429 | `concurrency_limit` |
| 账号今日次数用完（`chatGateway.dailyLimit`，0 为不限） | 429 | `daily_limit` |
| 账号 API 调用总额度用完（用户表 `api_quota`） | 429 | `account_quota` |
| 每账号每分钟超过 120 次（Redis） | 429 | `rate_limit_exceeded` |
| 请求体超过 64 MiB | 413 | `request_too_large` |
| 供应商拒绝 | 供应商状态码 | `upstream_error`，`message` 为供应商原话 |

供应商的多个接入地址按顺序尝试；连不上、401/402/403/404/408/429/5xx 会换下一个地址，其他 4xx 视为对请求本身的拒绝，直接返回给用户。一旦供应商开始返回内容就不再切换地址，避免重复输出和重复计费。

## 部署配置

`configs/config.yaml`：

```yaml
chatGateway:
  maxConcurrent: 2 # 单账号同时进行中的调用数
  dailyLimit: 0    # 单账号每日调用次数上限，0 为不限
```

环境变量 `TIDECANVAS_CHATGATEWAY_MAXCONCURRENT` / `TIDECANVAS_CHATGATEWAY_DAILYLIMIT` 可覆盖。旧的 `lobehub.*` 配置项已删除，留在 yaml 或环境变量里会被忽略。

Nginx 需要单独给 `/api/integrations/v1/` 一个 location（`deploy/nginx/conf.d/flowlight.conf` 已包含）：关闭请求和响应缓冲、`client_max_body_size 64m`、读写超时 3600s。通用的 `/api/` location 只有 300s 超时，长时间推理会被掐断。

数据库：`lobehub_grant`、`lobehub_link` 两张表不再被迁移或读取，可以在确认无用后手动删除；`model_gateway_request` 继续使用。前台菜单键 `ai_chat` 已从 `FrontMenuKeys` 移除，角色里残留的该键会被忽略。
