# 用户默认 API Key

每个主站用户对应一条 `user_api_key`，用户 ID 是主键。新建账号时在同一数据库事务内生成；覆盖邮箱注册、验证码首次登录、本地注册和后台创建。启动后后台分页补齐存量用户，重复启动或多实例并发不会重新发放、轮换或启用已停用的密钥。

生产环境关闭 GORM 默认事务时，用户创建回调会单独开启事务；已有外层事务则沿用，不会提前提交。Key 写入失败会回滚新账号，其他表的事务策略不变。批量创建中因唯一键冲突被跳过的账号不会产生孤立的 Key。

密钥使用 32 字节安全随机数，格式为 `tc_sk_…`。数据库保存 SHA-256 校验摘要和 AES-256-GCM 密文，不保存明文；加密使用独立域派生的应用 JWT Secret，并以用户 ID 绑定密文。部署时必须保持各实例 JWT Secret 一致。变更加密根密钥后，已有 Key 仍可通过摘要鉴权，但读取原文会失败；应保留原 Secret 完成迁移，或由用户主动重置，不会自动替换已有 Key。

## 用户管理接口

以下接口只接受主站登录 JWT，且校验当前账号仍启用；默认 Key 不能用于这些管理接口。

| 接口 | 作用 |
|---|---|
| `GET /api/auth/api-key` | 获取/补齐自己的默认 Key，只返回名称、掩码、状态、版本和时间 |
| `POST /api/auth/api-key/reveal` | `{revision}`，主动读取完整 Key |
| `POST /api/auth/api-key/rotate` | `{revision}`，原子重置，旧 Key 立即失效；保持启用/停用状态 |
| `PUT /api/auth/api-key/status` | `{revision, enabled}`，启用或停用 |

修改采用版本校验，过期页面和同一请求重试会返回业务码 409，不会重复轮换。读取密钥返回 `Cache-Control: no-store`，登录响应、用户列表和审计日志不携带完整 Key。个人中心只在内存中临时显示，60 秒后或页面隐藏时遮蔽，不写浏览器持久存储。

个人中心请求附带 `accountId` 作为当前页面的账号校验值，只允许与登录 JWT 的用户 ID 一致，不用于选择其他账号。跨标签页切换登录身份或刷新重试时不一致会返回 409；页面会清除完整 Key，并丢弃隐藏页面或切换身份之前发起的迟到明文响应。

## 集成身份校验

`GET /api/integrations/identity` 接受 `Authorization: Bearer tc_sk_…`，返回该 Key 对应的主站 `userId` 和当前 `points`。每次查询真实账号和 Key 状态，账号被停用/删除、Key 停用/轮换后，后续请求立即拒绝；数据库异常返回 HTTP 503，不放行。

API Key 鉴权只挂在明确的集成路由上，不代替主站 JWT，也不继承管理员角色。原有后台“邮件配置”中的无用户归属 Key 不在此鉴权范围。

身份校验本身不扣积分。已实现的 LobeHub 集成使用 OIDC 登录和服务端账号绑定，将该用户默认 Key 同步到个人 provider；模型请求走 `GET /api/integrations/v1/models` 与 `POST /api/integrations/v1/chat/completions`，由主站按真实用户执行额度、并发和积分结算。无需创建 apirouter 用户，也不会向 LobeHub 复制主站共享上游 Key。

部署配置、实际计费规则和验收步骤见 [LobeHub 主站集成](../../deploy/lobehub-integration/README.md)。集成默认关闭，需要按该文档发布主站及 apirouter 的兼容改动并配置现有 LobeHub。
