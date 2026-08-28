"use client";

/* ============================================================================
   用户画像（/admin/users/[id]）— 单用户档案。

   数据一次性来自 GET /api/admin/users/:id/portrait（g1_user_portrait.go），
   页面只做展示、中文标签映射与「画像」推导，不发瀑布请求。

   形态是一份档案，不是仪表盘：深色身份主视觉承接结论，下面用关键指标、
   行为分析与状态侧栏建立阅读顺序。顺序是「结论 → 证据」——先一句人话说清这是谁
   （buildSummary，措辞只用数据支撑得起的说法），再给数字、活跃、创作、
   积分、消费、沉淀。数据为空的分区只留一行灰字，不摆空盒子。

   自绘图形都是纯 CSS：活跃热力是周列日格（.uport-heat）、时段是 24 根细柱
   （.uport-hours）、排行是标签+占比条+数值的列表（.uport-rank）。样式集中在
   admin.css 的 .uport-* 段。
   ============================================================================ */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BadgeDollarSign,
  Clock3,
  Coins,
  Database,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  AdminAlert,
  AdminTable,
  StatusPill,
  type Column,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminUsersApi } from "@/lib/admin-users-api";
import { defaultAvatar, isPlaceholderEmail } from "@/lib/default-avatar";
import { toast } from "@/components/shared/toast";
import type {
  PortraitClaimVO,
  PortraitOrderVO,
  PortraitTxVO,
  PortraitTypeStat,
  UserPortraitVO,
} from "@/types/admin-users";

/* ---- 标签映射：key 未收录时原样展示，后端新增类型无需前端发版 ---------------- */

const CHANGE_TYPE_LABELS: Record<string, string> = {
  recharge: "充值",
  consume: "消耗",
  checkin: "签到",
  reward: "奖励",
  refund: "退款",
  adjust: "人工调整",
  register: "注册赠送",
  signup: "注册赠送",
  activation: "兑换码",
  invite: "邀请奖励",
};

const HANDLER_LABELS: Record<string, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  start_end_to_video: "首尾帧视频",
  reference_to_video: "全能参考视频",
  video_upscale: "视频超分",
  generate_3d: "3D 生成",
  text_to_audio: "音频生成",
  assistant_chat: "AI 助手",
  skill_text_completion: "技能文本",
};

/** 生成方式 → 媒体族（画像结论的「创作倾向」推导用） */
const HANDLER_MEDIA: Record<string, "image" | "video" | "audio" | "3d"> = {
  text_to_image: "image",
  image_to_image: "image",
  text_to_video: "video",
  image_to_video: "video",
  start_end_to_video: "video",
  reference_to_video: "video",
  video_upscale: "video",
  generate_3d: "3d",
  text_to_audio: "audio",
};
const MEDIA_LABELS = { image: "图片", video: "视频", audio: "音频", "3d": "3D" } as const;

const ORDER_STATUS: Record<number, { label: string; tone: "green" | "gray" | "amber" | "red" }> = {
  0: { label: "待支付", tone: "amber" },
  1: { label: "已支付", tone: "green" },
  2: { label: "已取消", tone: "gray" },
  3: { label: "已退款", tone: "red" },
};

const changeTypeLabel = (key: string) => CHANGE_TYPE_LABELS[key] ?? key;
const handlerLabel = (key: string) => HANDLER_LABELS[key] ?? (key || "—");

const fmtNum = (n: number) => n.toLocaleString("zh-CN");
const fmtSigned = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));
const fmtBytes = (n: number) => {
  if (n <= 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};
const fmtDateTime = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : "—");
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 距今天数；时间串可能是 RFC3339 或 "YYYY-MM-DD HH:mm:ss"，两种都按本地时间解析 */
function daysSince(s: string): number {
  if (!s) return 0;
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/* ---- 画像推导 ----------------------------------------------------------------
   结论只说数据撑得住的话：占比类结论要够样本量（生成倾向 ≥10 次、时段 ≥20 次），
   风险类要够基数（近 30 天 ≥10 次）。宁可少说一句，也不给运营错误印象。 */

/** 主力媒体族：占比 ≥60% 且样本 ≥10 才下结论 */
function topMedia(byHandler: PortraitTypeStat[]): string | null {
  const count: Record<string, number> = {};
  let total = 0;
  for (const h of byHandler) {
    const media = HANDLER_MEDIA[h.key];
    if (!media) continue;
    count[media] = (count[media] ?? 0) + h.count;
    total += h.count;
  }
  if (total < 10) return null;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  // 没有任何一族过半时不下结论（"多模态混用" 交给特征标签，正文不硬凑）
  if (top && top[1] / total >= 0.6) return MEDIA_LABELS[top[0] as keyof typeof MEDIA_LABELS];
  return null;
}

/** 常用时段：样本 ≥20 次才下结论，按峰值小时归到四个时段 */
function peakSlot(hourly: number[]): string | null {
  const total = hourly.reduce((s, v) => s + v, 0);
  if (total < 20) return null;
  const peak = hourly.indexOf(Math.max(...hourly));
  if (peak < 6) return "凌晨";
  if (peak < 12) return "上午";
  if (peak < 18) return "下午";
  return "晚间";
}

/** 近 30 天失败率（基数不足返回 null，避免用 1/1 说成 100%） */
function failRate30(g: UserPortraitVO["generation"]): number | null {
  if (g.total30 < 10) return null;
  const rate = Math.round((g.failed30 / g.total30) * 100);
  return rate >= 30 ? rate : null;
}

/** 画像结论：两句人话。第一句「是谁 + 在创作什么」，第二句「花了什么 + 留下什么」。 */
function buildSummary(d: UserPortraitVO): string[] {
  const { user, points, activity, generation: g, commerce, assets } = d;
  const regDays = daysSince(user.createTime);
  const paid = user.vipLevel >= 1 || commerce.paidOrderCount > 0;
  const who = `${regDays > 0 ? `注册 ${regDays} 天的` : "今天注册的"}${paid ? `${user.planName || "付费"}用户` : "免费用户"}`;

  const first: string[] = [who];
  if (g.total === 0) {
    first.push("至今没有发起过生成");
  } else if (g.total30 === 0) {
    first.push(`累计生成 ${fmtNum(g.total)} 次，近 30 天已停止使用`);
  } else {
    const rate = g.total > 0 ? Math.round((g.success / g.total) * 100) : 0;
    first.push(`近 30 天生成 ${fmtNum(g.total30)} 次（累计成功率 ${rate}%）`);
    const media = topMedia(g.byHandler);
    if (media) first.push(`以${media}为主`);
    const slot = peakSlot(activity.hourly);
    if (slot) first.push(`常在${slot}使用`);
  }

  const second: string[] = [];
  if (commerce.paidOrderCount > 0) {
    second.push(`累计付费 ¥${commerce.paidAmount || "0.00"}`);
  } else if (commerce.claimPoints > 0) {
    second.push(`靠兑换码获得 ${fmtNum(commerce.claimPoints)} 积分`);
  }
  if (points.totalSpent > 0) second.push(`消耗 ${fmtNum(points.totalSpent)} 积分`);
  else if (points.balance > 0 && g.total === 0) second.push(`账上 ${fmtNum(points.balance)} 积分未动用`);
  if (assets.workCount > 0) second.push(`沉淀 ${fmtNum(assets.workCount)} 件作品`);
  second.push(
    g.total30 > 0
      ? `近 30 天有 ${activity.activeDays30} 天在创作`
      : `近 30 天登录 ${activity.loginDays30} 天`,
  );
  const risk = failRate30(g);
  if (risk !== null) second.push(`失败率 ${risk}%，值得关注`);

  return [`${first.join("，")}。`, `${second.join("，")}。`];
}

/** 补充特征词：结论里说不下、但一眼能看出的标签。宁缺毋滥，最多 5 个。 */
function deriveTraits(d: UserPortraitVO): { text: string; warn?: boolean }[] {
  const traits: { text: string; warn?: boolean }[] = [];
  const g = d.generation;
  if (g.total30 >= 100) traits.push({ text: "重度创作者" });
  else if (g.total30 >= 20) traits.push({ text: "稳定创作者" });
  else if (g.total30 >= 1) traits.push({ text: "轻度使用" });
  else if (g.total > 0) traits.push({ text: "沉睡用户" });
  else traits.push({ text: "尚未开始创作" });

  if (d.commerce.checkinStreak >= 5) traits.push({ text: `连签 ${d.commerce.checkinStreak} 天` });
  if (d.assets.workCount >= 50) traits.push({ text: "高产作品" });
  if (d.community.followers >= 50) traits.push({ text: "社区影响力" });
  if (d.activity.recentLogins.some((l) => l.success !== 1)) traits.push({ text: "有登录失败", warn: true });

  return traits.slice(0, 5);
}

/* ---- 片段组件 ---------------------------------------------------------------- */

/** 分区：细线起头 + 标题，右侧可挂说明与去处链接 */
function Section({
  title,
  note,
  link,
  className,
  children,
}: {
  title: string;
  note?: string;
  link?: { href: string; text: string };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`uport-sec${className ? ` ${className}` : ""}`}>
      <div className="uport-sec-head">
        <h2>{title}</h2>
        {note ? <span className="uport-sec-note">{note}</span> : null}
        {link ? <Link className="uport-sec-link" href={link.href}>{link.text} →</Link> : null}
      </div>
      {children}
    </section>
  );
}

/** 空数据：一行灰字。空盒子只会让低活跃用户的档案变成一片虚线框。 */
const None = ({ text }: { text: string }) => <p className="uport-none">{text}</p>;

const Caption = ({ children }: { children: React.ReactNode }) => (
  <div className="uport-cap">{children}</div>
);

/** 数字条：无边框，靠细竖线分隔——数值本身就是层级，不需要再套盒子 */
function Figures({ items, className }: { items: { k: string; v: string; d?: string }[]; className?: string }) {
  return (
    <dl className={`uport-figures${className ? ` ${className}` : ""}`}>
      {items.map((i) => (
        <div key={i.k}>
          <dt>{i.k}</dt>
          <dd>{i.v}</dd>
          {i.d ? <span>{i.d}</span> : null}
        </div>
      ))}
    </dl>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: "violet" | "cyan" | "amber" | "green";
}) {
  return (
    <div className={`uport-metric ${tone}`}>
      <div className="uport-metric-top">
        <span>{label}</span>
        <span className="uport-metric-icon"><Icon aria-hidden size={16} /></span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

/** 排行：标签 + 占比条 + 数值。比表格轻，也不会在窄栏里横向滚动。 */
function RankList({
  items,
}: {
  items: { key: string; label: string; value: number; note?: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="uport-rank">
      {items.map((i) => (
        <li key={i.key}>
          <span className="uport-rank-label" title={i.label}>{i.label}</span>
          <span className="uport-rank-bar" aria-hidden>
            <i style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </span>
          <b>{fmtNum(i.value)}</b>
          <em>{i.note ?? ""}</em>
        </li>
      ))}
    </ul>
  );
}

/* ---- 活跃热力：周为列、7 行（一~日），与格网共轨道的月份标签 ----------------- */

function ActivityHeatmap({ daily }: { daily: { date: string; count: number }[] }) {
  if (daily.length === 0) return null;
  // 首日向前补齐到周一，末日向后补齐到周日；补的格子标 future/blank 不上色
  const first = new Date(`${daily[0].date}T00:00:00`);
  const leading = (first.getDay() + 6) % 7; // 周一=0
  const cells: ({ date: string; count: number } | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...daily,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const max = Math.max(1, ...daily.map((d) => d.count));
  const level = (count: number) => {
    if (count <= 0) return "";
    const r = count / max;
    return r > 0.75 ? "l4" : r > 0.5 ? "l3" : r > 0.25 ? "l2" : "l1";
  };
  // 月份标签挂在「该月第一次出现」的周列上
  const monthOfWeek = weeks.map((week) => {
    const firstDay = week.find(Boolean);
    return firstDay ? Number(firstDay.date.slice(5, 7)) : 0;
  });
  const total = daily.reduce((s, d) => s + d.count, 0);

  return (
    <div>
      <div className="uport-heat" role="img" aria-label={`近 ${daily.length} 天共生成 ${total} 次`}>
        <div className="uport-heat-week" aria-hidden>
          {WEEKDAYS.map((w, i) => <span key={w}>{i % 2 === 0 ? w : ""}</span>)}
        </div>
        <div className="uport-heat-body">
          <div className="uport-heat-months" aria-hidden>
            {monthOfWeek.map((m, i) => (
              <span key={i}>{m > 0 && m !== monthOfWeek[i - 1] && (i > 0 || weeks.length < 6) ? `${m}月` : ""}</span>
            ))}
          </div>
          <div className="uport-heat-grid">
            {weeks.map((week, wi) =>
              week.map((day, di) => (
                <i
                  key={`${wi}-${di}`}
                  className={`uport-heat-cell ${day ? level(day.count) : "future"}`}
                  title={day ? `${day.date} · ${day.count} 次生成` : undefined}
                />
              )),
            )}
          </div>
        </div>
      </div>
      <div className="uport-heat-legend">
        少
        <i className="uport-heat-cell" />
        <i className="uport-heat-cell l1" />
        <i className="uport-heat-cell l2" />
        <i className="uport-heat-cell l3" />
        <i className="uport-heat-cell l4" />
        多
      </div>
    </div>
  );
}

function HourBars({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly);
  const peak = hourly.indexOf(Math.max(...hourly));
  const total = hourly.reduce((s, v) => s + v, 0);
  return (
    <div>
      <div className="uport-hours" role="img" aria-label={total > 0 ? `最常用时段 ${peak}:00 前后` : "暂无时段数据"}>
        {hourly.map((v, h) => (
          <i
            key={h}
            className={v <= 0 ? "zero" : total > 0 && h === peak ? "peak" : ""}
            style={{ height: v > 0 ? `${Math.max(8, (v / max) * 100)}%` : 2 }}
            title={`${h}:00–${h + 1}:00 · ${v} 次`}
          />
        ))}
      </div>
      <div className="uport-axis" aria-hidden>
        <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  );
}

/* ---- 页面 -------------------------------------------------------------------- */

export default function AdminUserPortraitPage() {
  const params = useParams<{ id: string }>();
  const userId = typeof params?.id === "string" ? params.id : "";
  const [data, setData] = useState<UserPortraitVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      await useAuthStore.getState().ensureSession();
      const res = await adminUsersApi.portrait(userId);
      if (res.success && res.data) setData(res.data);
      else setError(res.message || "加载用户画像失败");
    } catch {
      setError("加载用户画像失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // setTimeout(0) 与列表页同口径：effect 内不同步 setState（react-hooks/set-state-in-effect）
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // 浏览器标签页标题跟随档案主体，多开对比用户时能分清；卸载时还原进来前的标题
  useEffect(() => {
    if (!data?.user) return;
    const previous = document.title;
    document.title = `${data.user.username || data.user.nickname || data.user.id} · 用户画像`;
    return () => { document.title = previous; };
  }, [data]);

  const copyUserId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(userId);
      toast.success("用户 ID 已复制");
    } catch {
      toast.error("复制失败，请手动选择");
    }
  }, [userId]);

  /* ---- 列定义（表格只留给真正多列的流水；统计一律走排行列表） ---------------- */

  const txColumns: Column<PortraitTxVO>[] = [
    { header: "时间", width: "26%", className: "mono", cell: (r) => fmtDateTime(r.time) },
    { header: "类型", width: "18%", cell: (r) => changeTypeLabel(r.changeType) },
    {
      header: "变动", width: "18%", align: "right", className: "mono",
      cell: (r) => <span style={{ color: r.amount >= 0 ? "var(--ok)" : "var(--text)" }}>{fmtSigned(r.amount)}</span>,
    },
    {
      header: "备注", width: "38%",
      cell: (r) => <span className="muted" title={r.remark || undefined}>{r.remark || "—"}</span>,
    },
  ];

  const orderColumns: Column<PortraitOrderVO>[] = [
    { header: "时间", width: "22%", className: "mono", cell: (r) => fmtDateTime(r.time) },
    { header: "订单号", width: "26%", className: "mono", cell: (r) => <span title={r.orderNo}>{r.orderNo}</span> },
    { header: "类型", width: "18%", cell: (r) => (r.orderType === "plan" ? `套餐${r.cycle === "yearly" ? "·年付" : r.cycle === "monthly" ? "·月付" : ""}` : "积分包") },
    { header: "金额", width: "14%", align: "right", className: "mono", cell: (r) => `¥${r.amount}` },
    {
      header: "状态", width: "20%",
      cell: (r) => {
        const s = ORDER_STATUS[r.status] ?? { label: `状态${r.status}`, tone: "gray" as const };
        return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
      },
    },
  ];

  const claimColumns: Column<PortraitClaimVO>[] = [
    { header: "时间", width: "28%", className: "mono", cell: (r) => fmtDateTime(r.time) },
    { header: "批次", width: "34%", cell: (r) => r.batchName || "—" },
    { header: "兑换码", width: "22%", className: "mono", cell: (r) => r.codeHint },
    { header: "积分", width: "16%", align: "right", className: "mono", cell: (r) => `+${fmtNum(r.points)}` },
  ];

  if (loading) {
    return (
      <div className="adm-page">
        <div className="uport" aria-busy="true">
          <span className="sr-only" role="status">正在加载用户画像</span>
          <div className="uport-head">
            <div className="skel" style={{ width: 56, height: 56, borderRadius: 10 }} />
            <div style={{ flex: 1 }}>
              <div className="skel" style={{ height: 18, width: 200, borderRadius: 4 }} />
              <div className="skel" style={{ height: 12, width: 320, borderRadius: 4, marginTop: 10 }} />
            </div>
          </div>
          <div className="skel" style={{ height: 44, borderRadius: 6, marginTop: 20 }} />
          <div className="skel" style={{ height: 64, borderRadius: 6, marginTop: 20 }} />
          <div className="skel" style={{ height: 140, borderRadius: 6, marginTop: 24 }} />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="adm-page">
        <AdminAlert
          tone="error"
          title={error || "用户不存在"}
          action={
            <button type="button" className="adm-btn ghost" onClick={() => void load()}>
              <RefreshCw aria-hidden size={15} /> 重试
            </button>
          }
        >
          也可能该用户已被删除；返回列表确认。
        </AdminAlert>
        <div style={{ marginTop: 12 }}>
          <Link href="/admin/users" className="adm-btn ghost" style={{ display: "inline-flex" }}>
            <ArrowLeft aria-hidden size={15} /> 返回用户列表
          </Link>
        </div>
      </div>
    );
  }

  const { user, points, activity, generation, models, assets, commerce, community } = data;
  const email = !user.email || isPlaceholderEmail(user.email) ? "未绑定邮箱" : user.email;
  const summary = buildSummary(data);
  const traits = deriveTraits(data);
  const successRate = generation.total > 0 ? `${Math.round((generation.success / generation.total) * 100)}%` : "—";
  const hasActivity = activity.daily.some((d) => d.count > 0);
  const hasHours = activity.hourly.some((v) => v > 0);
  const failedLogins = activity.recentLogins.filter((l) => l.success !== 1).length;
  const hasCommerce =
    commerce.recentOrders.length > 0 || commerce.recentClaims.length > 0 ||
    commerce.checkinCount > 0 || commerce.paidOrderCount > 0;
  const hasAssets =
    assets.workCount > 0 || assets.projectCount > 0 || assets.fileCount > 0 ||
    assets.storageUsed > 0 || assets.skillRunCount > 0 ||
    community.commentCount > 0 || community.likeCount > 0 ||
    community.followers > 0 || community.following > 0;
  const detailNeedsFullWidth =
    points.transactions.length > 0 || commerce.recentOrders.length > 0 || commerce.recentClaims.length > 0;
  const storagePercent = assets.storageQuota > 0
    ? Math.min(100, Math.round((assets.storageUsed / assets.storageQuota) * 100))
    : 0;
  const paidAmount = commerce.paidAmount || "0.00";

  return (
    <div className="adm-page uport-page">
      <div className="uport">
        <div className="uport-hero">
          <div className="uport-hero-nav">
            <span className="uport-kicker"><Sparkles aria-hidden size={14} /> USER PORTRAIT</span>
            <div className="uport-acts">
              <button type="button" className="uport-hero-btn" onClick={() => void load()}>
                <RefreshCw aria-hidden size={14} /> 刷新
              </button>
              <Link href="/admin/users" className="uport-hero-btn">
                <ArrowLeft aria-hidden size={14} /> 返回列表
              </Link>
            </div>
          </div>
          <header className="uport-head">
            <span
              className="uport-av"
              style={{ background: `center / cover no-repeat url("${user.avatar || defaultAvatar(user.id)}")` }}
            />
            <div className="uport-head-main">
              <div className="uport-name">
                <h1>{user.username || user.nickname || "—"}</h1>
                {user.nickname && user.nickname !== user.username ? <span>{user.nickname}</span> : null}
                <StatusPill tone={user.status === 1 ? "green" : "red"}>{user.status === 1 ? "正常" : "已封禁"}</StatusPill>
                {user.role === 9 ? <StatusPill tone="blue">管理员</StatusPill> : null}
                {user.vipLevel >= 1 ? <StatusPill tone="blue">{user.planName || "付费"}</StatusPill> : null}
              </div>
              <div className="uport-meta">
                <button type="button" className="uport-copy mono" onClick={() => void copyUserId()} title="点击复制用户 ID">
                  ID {user.id}
                </button>
                <span>{email}</span>
                {user.phone ? <span className="mono">{user.phone}</span> : null}
              </div>
              {user.remark?.trim() ? <div className="uport-remark">备注：{user.remark.trim()}</div> : null}
            </div>
          </header>
          <div className="uport-lede">
            <span className="uport-lede-label">PROFILE READ</span>
            {summary.map((s) => <p key={s}>{s}</p>)}
            {traits.length > 0 ? (
              <div className="uport-traits" aria-label="画像特征">
                {traits.map((t) => (
                  <span key={t.text} className={`uport-trait${t.warn ? " warn" : ""}`}>{t.text}</span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <section className="uport-metrics" aria-label="关键指标">
          <MetricCard icon={Coins} tone="violet" label="积分余额" value={fmtNum(points.balance)} detail={`累计获得 ${fmtNum(points.totalEarned)}`} />
          <MetricCard icon={Sparkles} tone="cyan" label="生成总数" value={fmtNum(generation.total)} detail={`近 30 天 ${fmtNum(generation.total30)}`} />
          <MetricCard icon={Activity} tone="green" label="创作成功率" value={successRate} detail={`失败 ${fmtNum(generation.failed)} 次`} />
          <MetricCard icon={BadgeDollarSign} tone="amber" label="累计付费" value={`¥${paidAmount}`} detail={`${fmtNum(commerce.paidOrderCount)} 笔订单`} />
        </section>

        <div className="uport-layout">
          <main className="uport-main">

        {/* ── 活跃度 ── */}
        <Section title="活跃度" note="最近 90 天的创作节奏" className="uport-card uport-activity-sec">
          {hasActivity || hasHours ? (
            <div className="uport-activity">
              <div className="uport-chart-panel">
                <Caption>每日生成 · 近 90 天</Caption>
                {hasActivity ? <ActivityHeatmap daily={activity.daily} /> : <None text="近 90 天没有生成行为" />}
              </div>
              <div className="uport-chart-panel">
                <Caption>常用时段</Caption>
                {hasHours ? <HourBars hourly={activity.hourly} /> : <None text="暂无时段数据" />}
              </div>
            </div>
          ) : (
            <div className="uport-empty-state"><Activity aria-hidden size={20} /><span>近 90 天没有生成行为</span></div>
          )}
          <div className="uport-activity-foot">
            <span><strong>{activity.activeDays30}</strong> 天创作</span>
            <span><strong>{activity.loginDays30}</strong> 天登录</span>
            {failedLogins > 0 ? <span className="uport-cap-warn"><strong>{failedLogins}</strong> 次登录失败</span> : null}
          </div>
        </Section>

        {/* ── 创作 ── */}
        <Section
          title="创作偏好"
          note={
            generation.total > 0
              ? `成功 ${fmtNum(generation.success)} · 失败 ${fmtNum(generation.failed)} · 取消 ${fmtNum(generation.cancelled)}${generation.processing > 0 ? ` · 进行中 ${fmtNum(generation.processing)}` : ""}`
              : undefined
          }
          className="uport-card uport-create-sec"
        >
          {generation.total === 0 ? (
            <div className="uport-empty-state"><Sparkles aria-hidden size={20} /><span>还没有任何生成记录</span></div>
          ) : (
            <div className="uport-two">
              <div>
                <Caption>按生成方式</Caption>
                <RankList
                  items={generation.byHandler.map((h) => ({
                    key: h.key,
                    label: handlerLabel(h.key),
                    value: h.count,
                    note: h.points > 0 ? `${fmtNum(h.points)} 分` : "",
                  }))}
                />
              </div>
              <div>
                <Caption>模型使用</Caption>
                {models.length === 0 ? (
                  <None text="还没有模型使用记录" />
                ) : (
                  <RankList
                    items={models.map((m) => ({
                      key: m.model,
                      label: m.model,
                      value: m.count,
                      note: m.count > 0 ? `成功 ${Math.round((m.success / m.count) * 100)}%` : "",
                    }))}
                  />
                )}
              </div>
            </div>
          )}
        </Section>

            <div className="uport-detail-grid">
        {/* ── 积分 ── */}
        <Section
          title="积分流水"
          note={`累计获得 ${fmtNum(points.totalEarned)} · 消耗 ${fmtNum(points.totalSpent)}${points.refundCount > 0 ? ` · 退款 ${fmtNum(points.refundCount)} 笔` : ""}`}
          link={{ href: `/admin/points?userId=${user.id}`, text: "完整流水" }}
          className={`uport-card${detailNeedsFullWidth ? " uport-detail-full" : ""}`}
        >
          {points.byType.length === 0 && points.transactions.length === 0 ? (
            <div className="uport-empty-state"><Coins aria-hidden size={20} /><span>暂无积分流水</span></div>
          ) : (
            <>
              {points.byType.length > 0 ? (
                <>
                  <Caption>类型构成（全部历史）</Caption>
                  <RankList
                    items={points.byType.map((t) => ({
                      key: t.key,
                      label: changeTypeLabel(t.key),
                      value: t.count,
                      note: `${fmtSigned(t.points)} 分`,
                    }))}
                  />
                </>
              ) : null}
              {points.transactions.length > 0 ? (
                <>
                  <Caption>最近流水</Caption>
                  <AdminTable<PortraitTxVO>
                    rows={points.transactions}
                    rowKey={(r, i) => `${r.time}-${i}`}
                    columns={txColumns}
                    label="最近积分流水"
                  />
                </>
              ) : null}
            </>
          )}
        </Section>

        {/* ── 消费与权益 ── */}
        <Section
          title="消费与权益"
          note={
            hasCommerce
              ? `兑换码 ${fmtNum(commerce.claimCount)} 次 / +${fmtNum(commerce.claimPoints)} 分 · 签到 ${fmtNum(commerce.checkinCount)} 次 / +${fmtNum(commerce.checkinPoints)} 分${commerce.lastCheckin ? ` · 最近签到 ${commerce.lastCheckin}` : ""}`
              : undefined
          }
          className={`uport-card uport-commerce-sec${detailNeedsFullWidth ? " uport-detail-full" : ""}`}
        >
          {!hasCommerce ? (
            <div className="uport-empty-state"><BadgeDollarSign aria-hidden size={20} /><span>没有订单、兑换与签到记录</span></div>
          ) : (
            <>
              <div className="uport-benefit-strip">
                <div><span>兑换码</span><strong>{fmtNum(commerce.claimCount)} 次</strong><small>+{fmtNum(commerce.claimPoints)} 分</small></div>
                <div><span>签到</span><strong>{fmtNum(commerce.checkinCount)} 次</strong><small>+{fmtNum(commerce.checkinPoints)} 分</small></div>
                <div><span>付费订单</span><strong>{fmtNum(commerce.paidOrderCount)} 笔</strong><small>¥{paidAmount}</small></div>
              </div>
              {commerce.recentOrders.length > 0 ? (
                <>
                  <Caption>最近订单</Caption>
                  <AdminTable<PortraitOrderVO>
                    rows={commerce.recentOrders}
                    rowKey={(r) => r.orderNo}
                    columns={orderColumns}
                    label="最近订单"
                  />
                </>
              ) : null}
              {commerce.recentClaims.length > 0 ? (
                <>
                  <Caption>最近兑换</Caption>
                  <AdminTable<PortraitClaimVO>
                    rows={commerce.recentClaims}
                    rowKey={(r) => r.time + r.codeHint}
                    columns={claimColumns}
                    label="最近兑换"
                  />
                </>
              ) : null}
            </>
          )}
        </Section>

            </div>

          </main>

          <aside className="uport-aside">
            <section className="uport-side-card uport-side-signals">
              <div className="uport-side-title"><ShieldCheck aria-hidden size={17} /><span>用户信号</span></div>
              <p className="uport-side-intro">从行为数据提炼的状态标签</p>
              <div className="uport-signal-list">
                {traits.length > 0 ? traits.map((t) => (
                  <div className={`uport-signal${t.warn ? " warn" : ""}`} key={t.text}>
                    <span className="uport-signal-dot" />{t.text}
                  </div>
                )) : <None text="暂时没有足够的行为信号" />}
              </div>
            </section>

            <section className="uport-side-card">
              <div className="uport-side-title"><Clock3 aria-hidden size={17} /><span>账户时间线</span></div>
              <div className="uport-facts">
                <div><span>注册时间</span><strong>{fmtDateTime(user.createTime)}</strong></div>
                <div><span>最近登录</span><strong>{fmtDateTime(user.lastLoginTime)}</strong></div>
                <div><span>近 30 天活跃</span><strong>{activity.activeDays30} 天 / 登录 {activity.loginDays30} 天</strong></div>
              </div>
            </section>

            <section className="uport-side-card uport-login-card">
              <div className="uport-side-title">
                <span>最近登录</span>
                {failedLogins > 0 ? <em>{failedLogins} 次失败</em> : <small>最近 6 次</small>}
              </div>
              {activity.recentLogins.length === 0 ? <None text="暂无登录记录" /> : (
                <ul className="uport-logs">
                  {activity.recentLogins.slice(0, 6).map((l, i) => (
                    <li key={`${l.time}-${i}`}>
                      <span className={`uport-login-dot${l.success !== 1 ? " fail" : ""}`} />
                      <span className="uport-login-detail">
                        <b>{l.action === "register" ? "注册" : l.action === "logout" ? "登出" : "登录"} · {l.channel === "code" ? "验证码" : l.channel === "password" ? "密码" : l.channel || "—"}</b>
                        <small className="mono">{fmtDateTime(l.time)}</small>
                      </span>
                      <span className="mono uport-login-ip">{l.ip || "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </aside>
        </div>

        <section className="uport-wide-card uport-side-card uport-assets-card">
          <div className="uport-side-title"><Database aria-hidden size={17} /><span>资产沉淀</span><small>产出资产与社区参与</small></div>
          {hasAssets ? (
            <>
              <Figures className="uport-figures-side" items={[
                { k: "作品", v: fmtNum(assets.workCount) },
                { k: "项目", v: fmtNum(assets.projectCount) },
                { k: "上传素材", v: fmtNum(assets.fileCount) },
                { k: "技能运行", v: fmtNum(assets.skillRunCount) },
                { k: "评论 / 点赞", v: `${fmtNum(community.commentCount)} / ${fmtNum(community.likeCount)}` },
                { k: "粉丝 / 关注", v: `${fmtNum(community.followers)} / ${fmtNum(community.following)}` },
              ]} />
              <div className="uport-storage">
                <div><span>存储空间</span><b>{fmtBytes(assets.storageUsed)}{assets.storageQuota > 0 ? ` / ${fmtBytes(assets.storageQuota)}` : ""}</b></div>
                <div className="uport-storage-track"><i style={{ width: `${storagePercent}%` }} /></div>
              </div>
            </>
          ) : (
            <div className="uport-empty-state"><Database aria-hidden size={20} /><span>还没有沉淀资产或社区活动</span></div>
          )}
        </section>
      </div>
    </div>
  );
}
