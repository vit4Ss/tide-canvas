// ============================================================================
// 邮件配置 (/admin/email) mock data — ported 1:1 from admin.js V.email().
//
// Blocks:
//  - KPI strip (今日发送 / 送达率 / 打开率 / 退信·投诉)
//  - SMTP 服务 + 发送策略 (cfg-card rows, adm-2col)
//  - 邮件模板 table (filterChips + 新建模板 + tplModal)
// Also exports the tplModal option lists.
// ============================================================================

import type { Kpi, PillTone } from "@/mock/admin";

/* ── KPI strip ──────────────────────────────────────────────────────────── */

export const EMAIL_KPIS: Kpi[] = [
  { k: "今日发送", v: "48,210", d: "+6%", dir: "up" },
  { k: "送达率", v: "99.2%", d: "+0.1%", dir: "up" },
  { k: "打开率", v: "38.4%", d: "+2.1%", dir: "up" },
  { k: "退信 / 投诉", v: "0.6%", d: "-0.1%", dir: "up" },
];

/* ── SMTP 服务 — cfg rows ───────────────────────────────────────────────── */

export interface EmailTextRow {
  kind: "text";
  label: string;
  type?: "text" | "number";
  value: string;
  /** Optional unit suffix (封 …). */
  unit?: string;
}
export interface EmailSelectRow {
  kind: "select";
  label: string;
  value: string;
  options: string[];
}
export interface EmailSwitchRow {
  kind: "switch";
  label: string;
  on: boolean;
}
export interface EmailTagRow {
  kind: "tag";
  label: string;
  value: string;
  tone: PillTone;
}
export interface EmailMutedRow {
  kind: "muted";
  label: string;
  value: string;
}
export type EmailCfgRow =
  | EmailTextRow
  | EmailSelectRow
  | EmailSwitchRow
  | EmailTagRow
  | EmailMutedRow;

export const SMTP_ROWS: EmailCfgRow[] = [
  {
    kind: "select",
    label: "服务商",
    value: "阿里云邮件推送",
    options: ["阿里云邮件推送", "腾讯云 SES", "SendGrid", "自建 SMTP"],
  },
  { kind: "text", label: "SMTP 主机", type: "text", value: "smtp.scarecrow.ai" },
  { kind: "text", label: "端口", type: "number", value: "465" },
  { kind: "select", label: "加密", value: "SSL", options: ["SSL", "TLS", "无"] },
  { kind: "text", label: "发件邮箱", type: "text", value: "no-reply@scarecrow.ai" },
  { kind: "text", label: "发件人名称", type: "text", value: "SCARECROW AI" },
  { kind: "tag", label: "SPF / DKIM", value: "已验证", tone: "green" },
  { kind: "switch", label: "启用发信", on: true },
];

/* ── 发送策略 — cfg rows ────────────────────────────────────────────────── */

export const SEND_POLICY_ROWS: EmailCfgRow[] = [
  { kind: "text", label: "每用户每日上限", type: "number", value: "10", unit: "封" },
  { kind: "text", label: "每分钟发送上限", type: "number", value: "600", unit: "封" },
  { kind: "text", label: "失败重试次数", type: "number", value: "3" },
  { kind: "switch", label: "退信自动拉黑", on: true },
  { kind: "muted", label: "营销邮件免打扰", value: "22:00–8:00" },
  { kind: "switch", label: "备用通道降级", on: true },
];

/* ── 邮件模板 table ────────────────────────────────────────────────────── */

export type EmailTemplateType = "系统" | "营销" | "通知";

export interface EmailTemplate {
  name: string;
  type: EmailTemplateType;
  /** 触发场景. */
  scene: string;
  /** 可用变量, e.g. "{code} {name}". */
  variables: string;
  /** 更新时间. */
  updatedAt: string;
  enabled: boolean;
  /** Default subject + body for the edit modal. */
  subject: string;
  body: string;
}

export const TEMPLATE_TYPE_TONE: Record<EmailTemplateType, PillTone> = {
  系统: "gray",
  营销: "amber",
  通知: "blue",
};

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    name: "注册验证码",
    type: "系统",
    scene: "用户注册",
    variables: "{code} {name}",
    updatedAt: "02-10",
    enabled: true,
    subject: "【SCARECROW AI】您的验证码",
    body: "您好 {name}，您的验证码是 {code}，5 分钟内有效。",
  },
  {
    name: "找回密码",
    type: "系统",
    scene: "密码重置",
    variables: "{link}",
    updatedAt: "02-11",
    enabled: true,
    subject: "【SCARECROW AI】重置您的密码",
    body: "您好，请点击以下链接重置密码：{link}，链接 30 分钟内有效。",
  },
  {
    name: "会员到期提醒",
    type: "通知",
    scene: "到期前 3 天",
    variables: "{plan} {date}",
    updatedAt: "02-12",
    enabled: true,
    subject: "【SCARECROW AI】您的会员即将到期",
    body: "您的 {plan} 会员将于 {date} 到期，续费可享连续优惠。",
  },
  {
    name: "充值成功",
    type: "通知",
    scene: "支付完成",
    variables: "{amount} {balance}",
    updatedAt: "02-13",
    enabled: true,
    subject: "【SCARECROW AI】充值成功",
    body: "您已成功充值 {amount}，当前积分余额 {balance}。",
  },
  {
    name: "限时促销",
    type: "营销",
    scene: "活动推送",
    variables: "{title} {coupon}",
    updatedAt: "02-14",
    enabled: true,
    subject: "【SCARECROW AI】{title}",
    body: "限时活动来了！使用优惠券 {coupon} 立享折扣，名额有限。",
  },
  {
    name: "流失召回",
    type: "营销",
    scene: "7 天未活跃",
    variables: "{name} {gift}",
    updatedAt: "02-15",
    enabled: false,
    subject: "【SCARECROW AI】{name}，我们想您了",
    body: "好久不见 {name}，回来领取专属礼包 {gift} 继续你的创作吧。",
  },
];

/* ── 邮件模板 filter chips + modal option lists ────────────────────────── */

export const TEMPLATE_FILTERS = ["全部", "系统", "营销", "通知"];
export const TEMPLATE_TYPE_OPTIONS = ["系统", "通知", "营销"];
