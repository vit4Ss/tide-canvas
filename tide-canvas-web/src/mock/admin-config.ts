// ============================================================================
// 配置管理 (/admin/config) mock data — ported 1:1 from admin.js V.config().
//
// Three blocks:
//  - 基础配置: 站点信息 / 开关 / 生成默认值 (cfg-grid of cfg-cards)
//  - API 密钥: third-party access keys (table + 轮换/吊销 + keyModal)
//  - 权限与角色: backend admins (table + 编辑/禁用 + memberModal)
// ============================================================================

import { adminSwatch } from "@/mock/admin";
import type { Kpi, PillTone } from "@/mock/admin";

export { adminSwatch };

/* ── KPI strip ──────────────────────────────────────────────────────────── */

export const CONFIG_KPIS: Kpi[] = [
  { k: "服务可用率", v: "99.98%", d: "近 30 天", dir: "up" },
  { k: "API 密钥", v: "14", dir: "up" },
  { k: "管理员", v: "8", dir: "up" },
  { k: "待生效变更", v: "2", dir: "down" },
];

/* ── 基础配置 — site info / switches / generation defaults ──────────────── */

export interface ConfigTextRow {
  kind: "text";
  label: string;
  /** input type: text | number. */
  type?: "text" | "number";
  value: string;
}
export interface ConfigSelectRow {
  kind: "select";
  label: string;
  value: string;
  options: string[];
}
export interface ConfigSwitchRow {
  kind: "switch";
  label: string;
  on: boolean;
}
export type ConfigRow = ConfigTextRow | ConfigSelectRow | ConfigSwitchRow;

export interface ConfigCard {
  title: string;
  desc: string;
  rows: ConfigRow[];
}

export const BASE_CONFIG_CARDS: ConfigCard[] = [
  {
    title: "站点信息",
    desc: "前台展示的基础品牌信息。",
    rows: [
      { kind: "text", label: "站点名称", type: "text", value: "SCARECROW AI" },
      { kind: "text", label: "备案号", type: "text", value: "粤ICP备2026xxxxx" },
      { kind: "select", label: "默认语言", value: "简体中文", options: ["简体中文", "English"] },
    ],
  },
  {
    title: "开关",
    desc: "影响全站的功能总开关。",
    rows: [
      { kind: "switch", label: "维护模式", on: false },
      { kind: "switch", label: "开放注册", on: true },
      { kind: "switch", label: "游客试用", on: true },
      { kind: "switch", label: "内容安全审核", on: true },
    ],
  },
  {
    title: "生成默认值",
    desc: "创作台的默认参数。",
    rows: [
      { kind: "select", label: "默认模型", value: "GPT Image 2", options: ["GPT Image 2", "Flux.1 Pro"] },
      { kind: "text", label: "默认数量", type: "number", value: "4" },
      { kind: "text", label: "单用户并发", type: "number", value: "3" },
    ],
  },
];

/* ── API 密钥 table ────────────────────────────────────────────────────── */

export interface ConfigApiKey {
  name: string;
  /** Masked key preview, e.g. sk_live_a1b2…f9. */
  key: string;
  /** 权限范围: 全部 | 生成 | 只读 | 导出. */
  scope: string;
  /** 调用量 (M). */
  calls: number;
  enabled: boolean;
}

export const CONFIG_API_KEYS: ConfigApiKey[] = [
  { name: "前台 Web", key: "sk_live_a1b2…f9", scope: "全部", calls: 2.1, enabled: true },
  { name: "移动端", key: "sk_live_c3d4…8e", scope: "生成", calls: 1.7, enabled: true },
  { name: "企业 API", key: "sk_live_e5f6…2a", scope: "只读", calls: 1.3, enabled: true },
  { name: "剪映同步", key: "sk_live_77a8…1c", scope: "导出", calls: 0.9, enabled: false },
];

/* ── 权限与角色 table ──────────────────────────────────────────────────── */

export interface ConfigMember {
  name: string;
  /** 角色. */
  role: string;
  roleTone: PillTone;
  /** 数据范围. */
  scope: string;
  /** 最近登录. */
  lastLogin: string;
  enabled: boolean;
}

const MEMBER_NAMES = ["夜航 NightSail", "KENJI", "砚 Yan", "Mira", "Studio 3F"];
const MEMBER_ROLES = ["超级管理员", "运营", "审核", "财务", "只读"];
const MEMBER_SCOPES = ["全部", "内容 / 用户", "作品审核", "商业", "查看"];

export const CONFIG_MEMBERS: ConfigMember[] = MEMBER_NAMES.map((name, i) => ({
  name,
  role: MEMBER_ROLES[i],
  roleTone: (i === 0 ? "amber" : "gray") as PillTone,
  scope: MEMBER_SCOPES[i],
  lastLogin: `${i + 1} 小时前`,
  enabled: true,
}));

/* ── modal option lists ────────────────────────────────────────────────── */

export const KEY_SCOPE_OPTIONS = ["全部", "生成", "只读", "导出"];
export const MEMBER_ROLE_OPTIONS = [
  "超级管理员",
  "运营",
  "内容审核",
  "财务",
  "客服",
  "只读访客",
];
export const MEMBER_SCOPE_OPTIONS = ["全部", "内容 / 用户", "作品审核", "商业", "查看"];
export const MEMBER_STATUS_OPTIONS = ["启用", "禁用"];
