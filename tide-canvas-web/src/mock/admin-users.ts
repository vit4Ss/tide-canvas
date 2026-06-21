// ============================================================================
// 用户管理 (Users) mock data — ported 1:1 from design-ref/liuguang/admin.js
// V.users(). Mock only (matching the rest of the liuguang design).
//
//   - USER_KPIS         → the 5 top KPI cards (总用户 / 付费会员 / …)
//   - USER_FILTERS      → 用户列表 filter chips (全部 / 免费 / Pro 会员 / …)
//   - USER_ROWS         → the 用户列表 table rows (derived exactly as admin.js did
//                          from NAMES.slice(0,8) + per-index expressions)
//   - ROLE_FILTERS / ROLE_ROWS  → 角色管理 panel
//   - PERMISSION_*      → 权限矩阵 (rows=modules, cols=roles, on/off grid)
// ============================================================================

import { adminSwatch, type Kpi, type PillTone } from "@/mock/admin";

/* The shared NAMES pool from admin.js (used for the user list). */
const NAMES = [
  "夜航 NightSail",
  "KENJI",
  "砚 Yan",
  "Mira",
  "Studio 3F",
  "OceanLab",
  "Vega",
  "稻田 Paddy",
  "Aria Chen",
  "L.Wong",
];

/* ──────────────────────────────────────────────────────────────────────────
   KPI cards (kpis([...]) in admin.js)
   ──────────────────────────────────────────────────────────────────────── */

export const USER_KPIS: Kpi[] = [
  { k: "总用户", v: "5,218,904", d: "+12,304 今日", dir: "up" },
  { k: "付费会员", v: "352,118", d: "+1.9%", dir: "up" },
  { k: "今日新增", v: "12,304", d: "+3.2%", dir: "up" },
  { k: "活跃率 DAU/MAU", v: "12.7%", d: "+0.4%", dir: "up" },
  { k: "封禁 / 风控", v: "1,206", dir: "down" },
];

/* ──────────────────────────────────────────────────────────────────────────
   用户列表 (user table)
   ──────────────────────────────────────────────────────────────────────── */

export const USER_FILTERS = ["全部", "免费", "Pro 会员", "企业", "风控"] as const;

/** A single row of the 用户列表 table. */
export interface UserRow {
  name: string;
  /** Deterministic avatar gradient (adminSwatch of the name). */
  avatar: string;
  email: string;
  /** 免费 | Pro 会员 | 企业 (cycles by index, as admin.js did). */
  level: string;
  levelTone: PillTone;
  /** 积分余额. */
  credits: number;
  /** 本月消耗. */
  monthlySpend: number;
  lastActive: string;
  /** true = 正常, false = 已封禁. */
  active: boolean;
}

const LEVELS = ["免费", "Pro 会员", "企业"] as const;
const LEVEL_TONES: PillTone[] = ["gray", "blue", "amber"];
const LAST_ACTIVE = ["2 分钟前", "1 小时前", "今天", "昨天", "3 天前", "今天", "5 小时前", "刚刚"];

// admin.js: NAMES.slice(0,8).map((n,i) => …) with row i===4 banned.
export const USER_ROWS: UserRow[] = NAMES.slice(0, 8).map((n, i) => ({
  name: n,
  avatar: adminSwatch(n),
  email: `u_${1000 + i * 137}@mail.com`,
  level: LEVELS[i % 3],
  levelTone: LEVEL_TONES[i % 3],
  credits: 9000 - i * 820,
  monthlySpend: 1800 - i * 180,
  lastActive: LAST_ACTIVE[i],
  active: i !== 4,
}));

/* ──────────────────────────────────────────────────────────────────────────
   角色管理 (roles)
   ──────────────────────────────────────────────────────────────────────── */

/** A backend/operations role row. */
export interface RoleRow {
  name: string;
  /** true → append a 系统 tag (super-admin, can't be deleted). */
  system: boolean;
  members: number;
  scope: string;
}

export const ROLE_ROWS: RoleRow[] = [
  { name: "超级管理员", system: true, members: 2, scope: "全部" },
  { name: "运营", system: false, members: 6, scope: "内容 + 用户" },
  { name: "内容审核", system: false, members: 9, scope: "内容" },
  { name: "财务", system: false, members: 3, scope: "商业" },
  { name: "客服", system: false, members: 14, scope: "只读" },
  { name: "只读访客", system: false, members: 5, scope: "查看" },
];

/* ──────────────────────────────────────────────────────────────────────────
   权限矩阵 (permission matrix — rows=modules, cols=roles)
   ──────────────────────────────────────────────────────────────────────── */

export const PERMISSION_MODULES = [
  "用户管理",
  "作品管理",
  "灵感管理",
  "日志",
  "模型管理",
  "积分",
  "价格",
  "支付",
  "营销",
  "配置",
] as const;

export const PERMISSION_ROLES = ["超管", "运营", "审核", "财务", "客服"] as const;

/**
 * The on/off grid — `PERMISSION_MATRIX[moduleIndex][roleIndex]`. Ported from the
 * inline predicate in admin.js:
 *   on = ci===0 || (ci===1 && ri<9) || (ci===2 && ri<3)
 *        || (ci===3 && (ri===5||ri===6||ri===7)) || (ci===4 && ri===0)
 */
export const PERMISSION_MATRIX: boolean[][] = PERMISSION_MODULES.map((_, ri) =>
  PERMISSION_ROLES.map((__, ci) =>
    ci === 0 ||
    (ci === 1 && ri < 9) ||
    (ci === 2 && ri < 3) ||
    (ci === 3 && (ri === 5 || ri === 6 || ri === 7)) ||
    (ci === 4 && ri === 0),
  ),
);
