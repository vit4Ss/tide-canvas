# Framelyn Stripe 接入与上线

## 本次实现

- Stripe 托管 Checkout，`mode=payment`：一次性购买，无自动扣款或订阅。
- 独立 USD 套餐从 Flowlight 后台填写后上架，不自动创建套餐、不换算人民币。
- 月档按月档价格一次支付；年档按全年总价一次支付，一次发放 12 倍月档积分。
- 沿用共享账户会员规则：会员等级只升级；没有会员到期规则，同档/低档会员购买仍受现有规则限制。月/年选项不意味着订阅续费或每月自动发分。
- 每笔订单保存价格、积分、会员等级、套餐名称及返回域名快照。下单后调整套餐不改变这笔订单。
- 同一套餐的未完成订单也会跨月档/年档复用；账单页提示已有订单并展示其原金额与周期。要更换购买选项，应先在订单历史确认取消原收银台。处理中的支付不提供再次付款或取消入口。
- 积分配置按系统实际的微积分精度范围校验，年档积分乘以 12 后也必须可表示。已核对当前 GORM MySQL 方言：这些 Go int 字段实际生成 BIGINT，不应误按 32 位 INT 限制合法套餐。
- Stripe 待支付窗口为一小时，人民币订单仍为原有 30 分钟。
- 一小时指收银台链接有效期。已完成收银台、仍等待银行到账的订单显示「Payment processing」，不按本地时间取消，也不允许同套餐重复生成付款会话；以 Stripe 成功、失败或过期状态为准。
- 超时重试复用订单和 Stripe 幂等键；通知验签后核对订单、支付状态、金额、USD 币种、环境及 Checkout Session。
- 网络断连后重试会复用原请求。Stripe API v1 会缓存部分 HTTP 500 响应，此时重复请求不一定恢复，需要在 Stripe 核查原订单，不应更换幂等键盲目重新收款。
- 尚未取得会话 ID 的订单可以直接取消，不会因取消而创建收银台。创建新会话要求至少剩余 30 分钟有效期，因此未成功准备的旧订单会提前结束准备窗口；已有会话继续按其实际状态处理。
- 手动查单会同时读取 PaymentIntent 状态，补偿延迟支付失败通知丢失的情况，避免已失败订单长期卡在处理中。
- 充值使用共享精确积分账本，保留小数余额和已冻结积分，并记录精确余额快照。创建新订单时，在用户锁内合并检查其他待付款订单的积分额度；只预留可入账容量，不冻结用户可消费余额。
- 数据库事务保证积分与已付状态一起提交，同一订单最多入账一次。支付后关闭页面、通知延迟或重试均可恢复。
- `TIDECANVAS_STRIPE_ENABLED=false` 或后台没有启用 `stripe` 渠道时，不开放新购买。保留凭据即可继续处理已产生订单的付款通知。

当前只有本地模拟支付验证，没有 Stripe 账号、真实密钥或真实交易记录。开户后的 Sandbox 联调仍需完成。

## 1. 开户

到 https://dashboard.stripe.com/register 按实际经营主体填写信息。先核对 https://stripe.com/global 的商户开户支持地区；身份/企业、经营信息及银行资料按控制台要求提供。
网站填写 `https://framelyn.tcmzhan.com`，业务描述如实说明 AI 图片、视频、音频和 3D 创作服务及积分套餐。
可先使用 Sandbox 开发测试；真实收款须完成 Stripe 要求的账户开通流程。

## 2. 配置测试后端

在 Stripe 创建 Sandbox，进入 API keys 获取服务端测试密钥。支持 `sk_test_...` 或满足 Checkout/关联资源操作权限的 `rk_test_...`。托管收银台返回 URL 后由浏览器直接打开，本方案不需要前端 `pk_...`。

把下面四项加入**测试服务器共享 backend 服务**的 environment，值由宿主机 `.env` 注入：

```yaml
TIDECANVAS_STRIPE_ENABLED: "${TIDECANVAS_STRIPE_ENABLED:-false}"
TIDECANVAS_STRIPE_SECRETKEY: "${TIDECANVAS_STRIPE_SECRETKEY:-}"
TIDECANVAS_STRIPE_WEBHOOKSECRET: "${TIDECANVAS_STRIPE_WEBHOOKSECRET:-}"
TIDECANVAS_STRIPE_SITEURL: "${TIDECANVAS_STRIPE_SITEURL:-https://test-framelyn.tcmzhan.com}"
```

测试后端必须为 `TIDECANVAS_ENV=test`；生产必须为 `prod`。启动校验拒绝测试环境使用 live key，以及生产环境使用 test key。密钥只在后端运行时注入，不放进前端、镜像、代码库或聊天。

密钥与域名在读取配置时去掉首尾空白。Stripe 关闭且配置未填写完整时，作为草稿不影响共享后端启动，也不会开放付款；启用前必须通过完整性和环境校验。

新增示例：`deploy/stripe.test.env.example`、`deploy/stripe.prod.env.example`。示例默认关闭收款、密钥留空。生产 siteUrl 要改为 `https://framelyn.tcmzhan.com`。

## 3. 创建 Webhook

进入 Stripe Workbench → Webhooks → Create an event destination：

1. 选择 Your account。
2. 使用 **Snapshot** 格式；API version 选择 **2026-09-30.endive**（与固定的 stripe-go v87.0.0 匹配）。
3. 监听 `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.async_payment_failed`、`checkout.session.expired`。
4. 目标为 Webhook endpoint，填写测试地址：

   `https://test-framelyn.tcmzhan.com/api/billing/stripe/webhook`

5. 把这个 endpoint 的 `whsec_...` 填到测试后端 `TIDECANVAS_STRIPE_WEBHOOKSECRET`。API 密钥和 webhook secret 必须属于同一 Sandbox。

回调接口需先部署上线。已有 Nginx `/api/` 反代可以将它转给 8081 共享后端；回调不使用网站 JWT，依靠 Stripe 原始请求体签名校验。不要在回调路径添加登录跳转或修改请求体。

生产单独创建 endpoint：

`https://framelyn.tcmzhan.com/api/billing/stripe/webhook`

生产使用自己的 live key、生产 webhook secret 和生产 siteUrl。相同服务的生产、测试部署使用各自数据库/环境，不混用 Stripe 配置。

## 4. 后台维护与启用

- Flowlight 管理后台 → 价格管理 → 英文站 USD：填写真实套餐名称、美元金额、全年总价、积分和权益，再上架。免费档为 0；有偿购买金额必须满足 Stripe 限额，代码校验 USD 金额 0.50–999999.99、最多两位小数。
- 支付管理 → 接入渠道：名称 `Stripe`，类型准确填写 `stripe`，启用。回调字段可填上述地址作运维记录；真正的通知地址仍需在 Stripe Workbench 注册。
- 费率字段沿用现有后台展示信息，不会改变 Checkout 应收价；不要将其当作自动计算 Stripe 手续费的设置。
- Stripe 后台启用要接受的支付方式。收银台展示该账号和购买场景可用的方式。本实现关闭 Adaptive Pricing，订单保持 USD。
- 后端填好密钥、签名密钥及 siteUrl 后，将 `TIDECANVAS_STRIPE_ENABLED=true` 并重建 backend 容器。
- 英文站 `GET /api/billing/en/channels` 应返回 `key=stripe,currency=USD`。未满足上述条件时仍显示购买暂未开放。

## 5. 测试与生产发布

在测试站完成真实 Sandbox 流程：选择套餐 → 核对美元总额 → 打开 Stripe → 用测试卡 `4242 4242 4242 4242`、未来到期日及任意三位 CVC 付款。该卡只用于测试环境。

确认以下结果后再开生产：

- 返回账单页自动核验；金额、年付总额、积分和会员等级正确。
- 即使付款后关闭网页，Webhook 仍入账；重放同一通知不会增加第二次积分。
- 取消付款返回原订单；短暂请求失败可从原订单「Prepare checkout」恢复，不需要新订单。
- 回调签名错误不入账；临时到账失败会返回非 2xx，Stripe 可重试。
- 支付管理订单按自身币种显示，后台 CNY / USD 收入分别统计，历史人民币记录不改币种。

更新顺序：共享 backend → 中文前端/后台 → frontend-en。两个分支推送分别构建各自镜像。此次代码本身不提交真实密钥、不启用生产收款、不修改生产服务器。

## 退款与订阅边界

退款仍沿用现有人工流程：在 Stripe 后台完成原路退款，再在 Flowlight 支付管理做「账务退款」标记和积分回收。后台账务退款按钮本身不会调用 Stripe 退钱；本次没有自动退款/争议扣款同步或订阅续费。

## 新增/复用接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/billing/en/channels` | 可用的 USD Stripe 渠道 |
| `POST /api/en/orders` | 创建/恢复同用户、套餐、周期的待支付订单 |
| `GET /api/orders/{id}` | 本人订单及可用支付链接 |
| `POST /api/orders/{id}/checkout` | 为原 Stripe 订单准备/恢复收银台 |
| `POST /api/orders/{id}/verify` | 从 Stripe 核实并幂等入账 |
| `POST /api/orders/{id}/cancel` | 先关闭 Stripe 收银台，再取消本地订单 |
| `POST /api/billing/stripe/webhook` | 原始请求体验签后的付款通知 |

## 验证命令与依据

```sh
CGO_ENABLED=1 go test ./internal/handler/billing ./internal/config
CGO_ENABLED=1 go test ./internal/handler/admin -run 'TestEnglishPricing|TestStripe'
```

英文站：`npm test`、`npm run lint`、`npm run build`、`node tests/stripe-browser.mjs`、`npm run test:pricing`。浏览器测试拦截后端请求；Go 测试使用本地 HTTP 假 Stripe 和隔离数据库，不向 Stripe 发真实请求。

完整付款浏览器回归：`npm run test:stripe`。覆盖下单、恢复、核验、取消、切换账号、取消请求超时/失败、Esc 弹窗恢复和月档/年档切换。

本轮关键并发与回调场景以 `-count=5 -shuffle=on` 重复验证。当前数据库行为验证使用隔离 SQLite，并核对 GORM MySQL 方言生成的字段类型；未使用真实 Stripe Sandbox 或独立 MySQL 实例，不能替代部署环境联调。

官方资料：
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/checkout/fulfillment
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/keys
