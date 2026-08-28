"use client";

/* ============================================================================
   用户画像（/admin/users/[id]）— 单用户全维度档案页。

   数据一次性来自 GET /api/admin/users/:id/portrait（g1_user_portrait.go），
   页面只做展示、中文标签映射与「画像特征」推导，不发瀑布请求。

   设计遵循后台工作台语言（PRODUCT.md：数据即层级、克制的强调、密度是尊重）：
   Panel + .adm-kpis 指标条 + AdminTable；活跃热力是周列日格（.uport-heat），
   时段分布是 24 根细柱（.uport-hours）——纯 CSS 词汇，不引图表库。页面专属
   样式集中在 admin.css 的 .uport-* 段。
   ============================================================================ */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  AdminAlert,
  AdminTable,
  Panel,
  StatCardGrid,
  StatusPill,
  type Column,
  TableSkeleton,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminUsersApi } from "@/lib/admin-users-api";
import { defaultAvatar, isPlaceholderEmail } from "@/lib/default-avatar";
import { toast } from "@/components/shared/toast";
import type {
  PortraitClaimVO,
  PortraitLoginVO,
  PortraitModelVO,
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

/** 生成方式 → 媒体族（画像标签的「创作倾向」推导用） */
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

/* ---- 画像特征推导 ------------------------------------------------------------
   每条标签都有明确阈值，宁缺毋滥（最多 6 个）；只有「近期失败率偏高」这类
   需要运营盯的信号才用 warn 色，其余保持中性。 */

interface Trait { text: string; warn?: boolean }

function deriveTraits(d: UserPortraitVO): Trait[] {
  const traits: Trait[] = [];
  const g = d.generation;

  // 创作强度（近 30 天任务量）
  if (g.total30 >= 100) traits.push({ text: "重度创作者" });
  else if (g.total30 >= 20) traits.push({ text: "稳定创作者" });
  else if (g.total30 >= 1) traits.push({ text: "轻度使用" });
  else if (g.total > 0) traits.push({ text: "沉睡用户" });
  else traits.push({ text: "尚未开始创作" });

  // 创作倾向：某一媒体族占比 ≥60% 且样本 ≥10 才下结论
  const mediaCount: Record<string, number> = {};
  let handlerTotal = 0;
  for (const h of g.byHandler) {
    const media = HANDLER_MEDIA[h.key];
    if (!media) continue;
    mediaCount[media] = (mediaCount[media] ?? 0) + h.count;
    handlerTotal += h.count;
  }
  if (handlerTotal >= 10) {
    const top = Object.entries(mediaCount).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / handlerTotal >= 0.6) {
      traits.push({ text: `偏${MEDIA_LABELS[top[0] as keyof typeof MEDIA_LABELS]}创作` });
    } else if (Object.keys(mediaCount).length >= 2) {
      traits.push({ text: "多模态混用" });
    }
  }

  // 时段习惯：样本 ≥20 次才下结论
  const hourTotal = d.activity.hourly.reduce((s, v) => s + v, 0);
  if (hourTotal >= 20) {
    const night = d.activity.hourly.slice(0, 7).reduce((s, v) => s + v, 0);
    const daytime = d.activity.hourly.slice(9, 19).reduce((s, v) => s + v, 0);
    if (night / hourTotal >= 0.3) traits.push({ text: "夜间活跃" });
    else if (daytime / hourTotal >= 0.7) traits.push({ text: "日间活跃" });
  }

  // 付费与权益路径
  if (d.commerce.paidOrderCount > 0) traits.push({ text: "付费用户" });
  else if (d.commerce.claimPoints > 0) traits.push({ text: "兑换码用户" });
  if (d.commerce.checkinStreak >= 5) traits.push({ text: `连签 ${d.commerce.checkinStreak} 天` });

  // 产出沉淀
  if (d.assets.workCount >= 50) traits.push({ text: "高产作品" });

  // 风险信号：近 30 天样本 ≥10 且失败率 ≥30%
  if (g.total30 >= 10 && g.failed30 / g.total30 >= 0.3) {
    traits.push({ text: `近期失败率 ${Math.round((g.failed30 / g.total30) * 100)}%`, warn: true });
  }

  // warn 信号永远保留，中性标签按推导顺序（信息价值降序）截断
  const warns = traits.filter((t) => t.warn);
  return [...traits.filter((t) => !t.warn).slice(0, 6 - warns.length), ...warns];
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
      <div className="uport-axis" style={{ justifyContent: "flex-end" }}>
        <span className="uport-heat-legend">
          少
          <i className="uport-heat-cell" />
          <i className="uport-heat-cell l1" />
          <i className="uport-heat-cell l2" />
          <i className="uport-heat-cell l3" />
          <i className="uport-heat-cell l4" />
          多
        </span>
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

function RatioBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="uport-ratio">
      <span className="uport-ratio-track">
        <span className="uport-ratio-fill" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, display: "block" }} />
      </span>
      <b>{fmtNum(value)}</b>
    </span>
  );
}

/** 分区小标题：右侧可挂一条去处链接（如「完整流水」） */
function SubHead({ children, link }: { children: React.ReactNode; link?: { href: string; text: string } }) {
  return (
    <div className="uport-subhead">
      <span>{children}</span>
      {link ? <Link href={link.href}>{link.text} →</Link> : null}
    </div>
  );
}

/** 表格区的空态：一行居中的说明文字，不用大空态组件挤占双栏格 */
function EmptyLine({ text }: { text: string }) {
  return (
    <div className="muted" style={{ padding: "20px 0", textAlign: "center", fontSize: 12.5, border: "1px dashed var(--border)", borderRadius: "var(--r-lg)" }}>
      {text}
    </div>
  );
}

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

  /* ---- 列定义 ---------------------------------------------------------------- */

  const txColumns: Column<PortraitTxVO>[] = [
    { header: "时间", width: "22%", className: "mono", cell: (r) => fmtDateTime(r.time) },
    { header: "类型", width: "14%", cell: (r) => changeTypeLabel(r.changeType) },
    {
      header: "变动", width: "14%", align: "right", className: "mono",
      cell: (r) => <span style={{ color: r.amount >= 0 ? "var(--ok)" : "var(--text)" }}>{fmtSigned(r.amount)}</span>,
    },
    { header: "余额", width: "14%", align: "right", className: "mono", cell: (r) => fmtNum(r.balance) },
    {
      header: "备注", width: "36%",
      cell: (r) => <span className="muted" title={r.remark || undefined}>{r.remark || "—"}</span>,
    },
  ];

  const typeColumns: Column<PortraitTypeStat>[] = [
    { header: "类型", width: "40%", cell: (r) => changeTypeLabel(r.key) },
    { header: "笔数", width: "26%", align: "right", className: "mono", cell: (r) => fmtNum(r.count) },
    { header: "积分合计", width: "34%", align: "right", className: "mono", cell: (r) => fmtSigned(r.points) },
  ];

  const loginColumns: Column<PortraitLoginVO>[] = [
    { header: "时间", width: "26%", className: "mono", cell: (r) => fmtDateTime(r.time) },
    { header: "动作", width: "18%", cell: (r) => (r.action === "register" ? "注册" : r.action === "logout" ? "登出" : "登录") },
    { header: "方式", width: "18%", cell: (r) => (r.channel === "code" ? "验证码" : r.channel === "password" ? "密码" : r.channel || "—") },
    {
      header: "结果", width: "14%",
      cell: (r) => <StatusPill tone={r.success === 1 ? "green" : "red"}>{r.success === 1 ? "成功" : "失败"}</StatusPill>,
    },
    { header: "IP", width: "24%", className: "mono", cell: (r) => r.ip || "—" },
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
        <Panel title="用户画像" sub="正在加载…"><TableSkeleton /></Panel>
        <Panel title="活跃度"><TableSkeleton /></Panel>
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
  const traits = deriveTraits(data);
  const successRate = generation.total > 0 ? `${Math.round((generation.success / generation.total) * 100)}%` : "—";
  const failNote30 = generation.total30 > 0
    ? `近 30 天失败率 ${Math.round((generation.failed30 / generation.total30) * 100)}%`
    : "近 30 天无任务";
  const maxModelCount = Math.max(1, ...models.map((m) => m.count));
  const maxHandlerPoints = Math.max(1, ...generation.byHandler.map((h) => h.points));

  const handlerColumns: Column<PortraitTypeStat>[] = [
    { header: "生成方式", width: "32%", cell: (r) => handlerLabel(r.key) },
    { header: "次数", width: "20%", align: "right", className: "mono", cell: (r) => fmtNum(r.count) },
    { header: "积分消耗（成功口径）", width: "48%", cell: (r) => <RatioBar value={r.points} max={maxHandlerPoints} /> },
  ];

  const modelColumns: Column<PortraitModelVO>[] = [
    { header: "模型", width: "30%", cell: (r) => <span title={r.model}>{r.model}</span> },
    { header: "次数", width: "26%", cell: (r) => <RatioBar value={r.count} max={maxModelCount} /> },
    {
      header: "成功率", width: "12%", align: "right", className: "mono",
      cell: (r) => (r.count > 0 ? `${Math.round((r.success / r.count) * 100)}%` : "—"),
    },
    { header: "积分", width: "14%", align: "right", className: "mono", cell: (r) => fmtNum(r.points) },
    { header: "最近使用", width: "18%", className: "mono muted", cell: (r) => fmtDateTime(r.lastUsed) },
  ];

  return (
    <div className="adm-page">
      {/* ── 档案头：身份、画像标签、关键指标 ── */}
      <Panel
        title="用户画像"
        sub="单用户全维度档案 · 数据实时聚合"
        tools={
          <>
            <button type="button" className="adm-btn ghost" onClick={() => void load()}>
              <RefreshCw aria-hidden size={15} /> 刷新
            </button>
            <Link href="/admin/users" className="adm-btn ghost">
              <ArrowLeft aria-hidden size={15} /> 返回列表
            </Link>
          </>
        }
      >
        <div className="uport-id">
          <span
            className="av"
            style={{ background: `center / cover no-repeat url("${user.avatar || defaultAvatar(user.id)}")` }}
          />
          <div className="uport-id-main">
            <div className="uport-id-name">
              <strong>{user.username || user.nickname || "—"}</strong>
              {user.nickname && user.nickname !== user.username ? <span className="muted">{user.nickname}</span> : null}
              <StatusPill tone={user.role === 9 ? "blue" : "gray"}>{user.role === 9 ? "管理员" : "普通用户"}</StatusPill>
              <StatusPill tone={user.vipLevel >= 1 ? "blue" : "gray"}>{user.planName || "免费"}</StatusPill>
              <StatusPill tone={user.status === 1 ? "green" : "red"}>{user.status === 1 ? "正常" : "已封禁"}</StatusPill>
            </div>
            <div className="uport-id-meta mono">
              <button type="button" className="uport-copy" onClick={() => void copyUserId()} title="点击复制用户 ID">
                ID {user.id}
              </button>
              <span>{email}</span>
              {user.phone ? <span>{user.phone}</span> : null}
            </div>
            <div className="uport-id-meta">
              <span>注册于 {fmtDateTime(user.createTime)}</span>
              <span>最近登录 {fmtDateTime(user.lastLoginTime)}</span>
              {user.remark?.trim() ? <span title={user.remark}>备注：{user.remark.trim()}</span> : null}
            </div>
          </div>
        </div>

        {/* 画像特征：从行为数据推导，阈值见 deriveTraits；风险信号用 warn 色 */}
        <div className="uport-traits" aria-label="画像特征">
          {traits.map((t) => (
            <span key={t.text} className={`uport-trait${t.warn ? " warn" : ""}`}>{t.text}</span>
          ))}
        </div>

        <StatCardGrid
          items={[
            { k: "积分余额", v: fmtNum(points.balance) },
            { k: "累计消耗", v: fmtNum(points.totalSpent), d: `近 30 天 ${fmtNum(points.spent30)}` },
            { k: "生成总数", v: fmtNum(generation.total), d: `近 30 天 ${fmtNum(generation.total30)}` },
            { k: "生成成功率", v: successRate, d: failNote30 },
            { k: "近 30 天活跃", v: `${activity.activeDays30} 天`, d: `登录 ${activity.loginDays30} 天` },
            { k: "累计付费", v: `¥${commerce.paidAmount}`, d: `${fmtNum(commerce.paidOrderCount)} 笔` },
          ]}
        />
      </Panel>

      {/* ── 活跃度 ── */}
      <Panel title="活跃度" sub="生成行为的时间分布（近 90 天）">
        <div className="uport-grid" style={{ marginBottom: 20 }}>
          <div>
            <SubHead>每日生成</SubHead>
            {activity.daily.some((d) => d.count > 0)
              ? <ActivityHeatmap daily={activity.daily} />
              : <EmptyLine text="近 90 天没有生成行为" />}
          </div>
          <div>
            <SubHead>常用时段</SubHead>
            {activity.hourly.some((v) => v > 0)
              ? <HourBars hourly={activity.hourly} />
              : <EmptyLine text="暂无时段数据" />}
          </div>
        </div>
        <SubHead>最近登录</SubHead>
        {activity.recentLogins.length === 0
          ? <EmptyLine text="暂无登录记录（生成账号首次登录后出现）" />
          : <AdminTable<PortraitLoginVO> rows={activity.recentLogins} rowKey={(r, i) => `${r.time}-${i}`} columns={loginColumns} label="最近登录" />}
      </Panel>

      {/* ── 生成行为与模型排行 ── */}
      <Panel
        title="生成行为"
        sub={`成功 ${fmtNum(generation.success)} · 失败 ${fmtNum(generation.failed)} · 取消 ${fmtNum(generation.cancelled)}${generation.processing > 0 ? ` · 进行中 ${fmtNum(generation.processing)}` : ""}`}
      >
        <div className="uport-grid">
          <div>
            <SubHead>按生成方式</SubHead>
            {generation.byHandler.length === 0
              ? <EmptyLine text="还没有生成记录" />
              : <AdminTable<PortraitTypeStat> rows={generation.byHandler} rowKey={(r) => r.key} columns={handlerColumns} label="生成方式统计" />}
          </div>
          <div>
            <SubHead>模型使用排行{models.length > 0 ? `（Top ${models.length}）` : ""}</SubHead>
            {models.length === 0
              ? <EmptyLine text="还没有模型使用记录" />
              : <AdminTable<PortraitModelVO> rows={models} rowKey={(r) => r.model} columns={modelColumns} label="模型使用排行" />}
          </div>
        </div>
      </Panel>

      {/* ── 积分资产 ── */}
      <Panel
        title="积分资产"
        sub={`累计获得 ${fmtNum(points.totalEarned)} · 累计消耗 ${fmtNum(points.totalSpent)}${points.refundCount > 0 ? ` · 退款 ${fmtNum(points.refundCount)} 笔` : ""}`}
      >
        <div className="uport-grid">
          <div>
            <SubHead>类型构成（全部历史）</SubHead>
            {points.byType.length === 0
              ? <EmptyLine text="暂无积分流水" />
              : <AdminTable<PortraitTypeStat> rows={points.byType} rowKey={(r) => r.key} columns={typeColumns} label="积分类型构成" />}
          </div>
          <div>
            <SubHead link={{ href: `/admin/points?userId=${user.id}`, text: "完整流水" }}>
              最近流水（{points.transactions.length} 条）
            </SubHead>
            {points.transactions.length === 0
              ? <EmptyLine text="暂无积分流水" />
              : <AdminTable<PortraitTxVO> rows={points.transactions} rowKey={(r, i) => `${r.time}-${i}`} columns={txColumns} label="最近积分流水" />}
          </div>
        </div>
      </Panel>

      {/* ── 消费与权益 ── */}
      <Panel
        title="消费与权益"
        sub={`兑换码 ${fmtNum(commerce.claimCount)} 次 / +${fmtNum(commerce.claimPoints)} 积分 · 签到 ${fmtNum(commerce.checkinCount)} 次 / +${fmtNum(commerce.checkinPoints)} 积分${commerce.lastCheckin ? ` · 最近签到 ${commerce.lastCheckin}` : ""}`}
      >
        <div className="uport-grid">
          <div>
            <SubHead>最近订单</SubHead>
            {commerce.recentOrders.length === 0
              ? <EmptyLine text="暂无订单" />
              : <AdminTable<PortraitOrderVO> rows={commerce.recentOrders} rowKey={(r) => r.orderNo} columns={orderColumns} label="最近订单" />}
          </div>
          <div>
            <SubHead>最近兑换</SubHead>
            {commerce.recentClaims.length === 0
              ? <EmptyLine text="暂无兑换记录" />
              : <AdminTable<PortraitClaimVO> rows={commerce.recentClaims} rowKey={(r) => r.time + r.codeHint} columns={claimColumns} label="最近兑换" />}
          </div>
        </div>
      </Panel>

      {/* ── 资产与社区 ── */}
      <Panel title="资产与社区" sub="产出沉淀与社区参与">
        <StatCardGrid
          items={[
            { k: "作品", v: fmtNum(assets.workCount) },
            { k: "项目", v: fmtNum(assets.projectCount) },
            { k: "上传素材", v: fmtNum(assets.fileCount), d: `占用 ${fmtBytes(assets.storageUsed)}` },
            { k: "技能运行", v: fmtNum(assets.skillRunCount) },
            { k: "评论 / 点赞", v: `${fmtNum(community.commentCount)} / ${fmtNum(community.likeCount)}` },
            { k: "粉丝 / 关注", v: `${fmtNum(community.followers)} / ${fmtNum(community.following)}` },
          ]}
        />
      </Panel>
    </div>
  );
}
