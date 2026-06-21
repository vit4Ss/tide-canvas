// Pricing (定价) — PLANS, CMP comparison, pricing FAQS (mock).
//
// Faithful to the canonical liuguang design
// (design-ref/liuguang/home-data.js + design-ref/liuguang/pricing.js).
// The liuguang pricing page reorders the home FAQs (drops the first two, then
// appends them at the end) — PRICING_FAQS preserves that display order so the
// page can render it directly.

import type { Plan, ComparisonRow, Faq } from "./types";
import { FAQS } from "./home";

/** Subscription plans. mo = monthly price, yr = per-month price when paid yearly (CNY). */
export const PLANS: Plan[] = [
  {
    name: "体验版", desc: "适合尝鲜与轻度创作", mo: 0, yr: 0, cta: "免费开始", feat: false,
    items: ["每月 100 积分", "基础图片模型", "标准生成队列", "社区作品广场", "512² 标准分辨率"],
  },
  {
    name: "创作者 Pro", desc: "高频创作者的首选", mo: 68, yr: 39, cta: "升级 Pro", feat: true,
    items: ["每月 3,000 积分", "全部图片 + 视频模型", "优先生成队列 · 不限速", "高清放大 / 局部重绘", "商用授权", "4K 超高分辨率"],
  },
  {
    name: "企业版", desc: "团队协作与品牌量产", mo: 268, yr: 199, cta: "联系我们", feat: false,
    items: ["无限积分（公平使用）", "团队席位与协作空间", "API 接入与工作流", "专属客户成功经理", "品牌风格私有模型", "SLA 与发票支持"],
  },
];

/**
 * Plan comparison table. Each row: [capability, 体验版, 创作者 Pro, 企业版].
 * "✓" = supported, "—" = not supported, otherwise a literal value.
 */
export const CMP: ComparisonRow[] = [
  ["每月积分",   "100",   "3,000",      "无限"],
  ["图片模型",   "基础",  "全部",       "全部 + 私有"],
  ["视频模型",   "—",     "全部",       "全部"],
  ["生成速度",   "标准",  "优先不限速", "最高优先"],
  ["最高分辨率", "512²",  "4K",         "4K"],
  ["商用授权",   "—",     "✓",          "✓"],
  ["API 接入",   "—",     "—",          "✓"],
  ["团队协作",   "—",     "—",          "✓"],
];

/**
 * Pricing-page FAQ display order: home FAQs from index 2 onward, then the
 * first two appended (matches design-ref/liuguang/pricing.js renderFaq()).
 */
export const PRICING_FAQS: Faq[] = [...FAQS.slice(2), ...FAQS.slice(0, 2)];
