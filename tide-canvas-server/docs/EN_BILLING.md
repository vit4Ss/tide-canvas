# Framelyn 独立美元套餐

英文站与中文站共用后端、用户和积分账户，套餐价格分别维护。
`plan.market` 区分 `cn` / `en`，对应 `CNY` / `USD`。
既有套餐与订单迁移后仍为 `cn` / `CNY`，不换算任何已有金额。

## 后台使用

Flowlight 后台 → 价格管理 → **英文站 · USD**。

- 独立维护名称、月价、全年总价、每月积分、权益、会员等级、排序和上下架。
- 英文站名称、描述、按钮和权益填写英文；代码全站唯一，建议使用 `en_pro` 等前缀。
- 新增英文套餐默认下架。填写真实美元价格后再手动上架。
- 美元价格保留最多两位小数。年付字段是一整年的总金额，不是月均价。
- 方案对比、FAQ、促销活动分别使用 `pricing.compare.en`、`pricing.faq.en`、`pricing.promo.en`，不复用中文配置。
- 两个站点切换时，尚未保存的表单需确认后才能丢弃。

不自动复制人民币价格、不按汇率推导美元价格，也不创建虚构的已上架套餐。
免费注册赠送仍由共享注册赠送配置控制；免费套餐的展示积分应与该配置一致。

## 接口

英文公开定价：`GET /api/billing/en/{plans,channels,compare,faq,promo}`。
英文后台：`/api/admin/en/plans` 和 `/api/admin/en/pricing/{compare,faq,promo}`，
继承原价格管理权限。中文接口保持原路径，仅操作中文套餐。

英文下单入口为 `POST /api/en/orders`。当前易支付接入是人民币链路，
美元收款已接入 Stripe Checkout，一次性支付、不自动续费。后端 Stripe 配置未完成、未启用，或后台未启用 stripe 渠道时，英文渠道列表返回空数组，不创建付费订单。
人民币下单接口也拒绝英文套餐；人民币支付校验不能结算美元订单。

套餐和订单 VO 返回 `market` 与 `currency`。英文前端只接受 `en` / `USD`
套餐；遇到旧后端、错误目录或人民币支付渠道时，不回退到人民币购买流程。
历史订单始终按订单自己的币种显示，缺少币种的旧订单按 CNY 处理。

## 发布顺序

1. 发布共享后端，启动时迁移 `plan`、`order` 的市场和币种列。
2. 发布中文前端，使后台出现英文站价格维护入口。
3. 发布英文前端，将 `BILLING_CURRENCY` 设置为 `USD`。
4. 在英文站价格管理中填写并上架套餐。
5. 按 [Stripe 接入与上线](STRIPE.md) 配置 Sandbox 密钥、付款通知和后台 stripe 渠道；联调成功后再启用生产收款。

涉及镜像：`tide-canvas-backend`、`tide-canvas-frontend`、`tide-canvas-frontend-en`。
后端与中文后台来自 `flowingLight`，英文前端来自 `flowlight-en`。

## 验证

```sh
CGO_ENABLED=1 go test ./internal/handler/billing
CGO_ENABLED=1 go test ./internal/handler/admin -run TestEnglishPricing
```

覆盖目录隔离、独立促销/FAQ、币种边界、跨站更新与删除、默认草稿、美元分精度、
旧数据迁移和人民币年付金额。测试使用隔离数据库，不连接真实支付渠道。

## 消费者体验与后台维护

- 英文站改为展示“标准积分包 / 12 倍积分包”的一次性总价；API 的 `monthly` /
  `yearly` 字段保持兼容。英文 Stripe 套餐允许重复购买补充积分，不降低既有会员等级；
  中文站重复购买规则不变。
- `/api/admin/en/pricing/consumer` 维护公开客服邮箱、商用范围、文件保存、退款时限、
  积分有效期与会员权益文案，公开读取 `/api/billing/en/consumer`。默认客服为
  `gudexin748@gmail.com`；未确定的条款不自动生成承诺。
- 这些字段是公开说明，不会自动实现积分到期、文件删除或会员降级。请先确认业务行为。
- 新的 `/api/points/summary` 只返回当前用户的积分汇总，便于核对共享余额，不包含
  文字模型、提示词或调用明细。退款属于积分增加项，预留积分从总余额中扣除展示可用量。
- 作品重命名只更新当前用户已完成任务的 `display_name`；文件重命名只更新当前所有者
  的 `original_name`，不修改存储地址。自动迁移会添加任务名称列。
- 仍需后台上架美元价格、按 Stripe 文档完成真实 Sandbox 联调，并由运营决定是否开启
  共用注册开关。此次前端更新不会自动修改线上配置。
