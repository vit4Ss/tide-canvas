"use client";

/*
 * 当前用户自己的创作画像。数据与后台画像使用同一份聚合接口，但接口由
 * JWT 直接锁定当前账号；页面只展示用户自己的创作、积分、消费和资产数据。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BadgeDollarSign,
  Coins,
  Database,
  Layers3,
  RefreshCw,
  Sparkles,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import { defaultAvatar, isPlaceholderEmail } from "@/lib/default-avatar";
import type {
  PortraitClaimVO,
  PortraitOrderVO,
  PortraitTxVO,
  PortraitTypeStat,
  UserPortraitVO,
} from "@/types/admin-users";
import "./portrait.css";

const HANDLER_LABELS: Record<string, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  start_end_to_video: "首尾帧视频",
  reference_to_video: "参考视频",
  video_upscale: "视频超分",
  generate_3d: "3D 生成",
  text_to_audio: "音频生成",
  assistant_chat: "AI 助手",
  skill_text_completion: "技能文本",
};

const CHANGE_LABELS: Record<string, string> = {
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

const ORDER_STATUS: Record<number, string> = {
  0: "待支付",
  1: "已支付",
  2: "已取消",
  3: "已退款",
};

const fmt = (n: number) => n.toLocaleString("zh-CN");
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const time = (value: string) => (value ? value.replace("T", " ").slice(0, 16) : "—");
const labelFor = (key: string, map: Record<string, string>) => map[key] || key || "—";

function PortraitSection({
  title,
  note,
  icon: Icon,
  children,
}: {
  title: string;
  note?: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="my-port-section">
      <header className="my-port-section-head">
        <span className="my-port-section-icon"><Icon aria-hidden size={16} /></span>
        <h2>{title}</h2>
        {note ? <span>{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

function RankList({ items }: { items: PortraitTypeStat[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (items.length === 0) return <p className="my-port-empty-copy">暂无记录</p>;
  return (
    <div className="my-port-rank-list">
      {items.map((item) => (
        <div className="my-port-rank-row" key={item.key}>
          <span className="my-port-rank-label" title={item.key}>{labelFor(item.key, HANDLER_LABELS)}</span>
          <span className="my-port-rank-track"><i style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} /></span>
          <b>{fmt(item.count)}</b>
          <small>{item.points > 0 ? `${fmt(item.points)} 分` : ""}</small>
        </div>
      ))}
    </div>
  );
}

function ActivityHeatmap({ daily }: { daily: { date: string; count: number }[] }) {
  const max = Math.max(1, ...daily.map((item) => item.count));
  const level = (count: number) => {
    if (!count) return "";
    const ratio = count / max;
    return ratio > 0.75 ? "l4" : ratio > 0.5 ? "l3" : ratio > 0.25 ? "l2" : "l1";
  };
  return (
    <div className="my-port-heat-wrap">
      <div className="my-port-heat-grid" role="img" aria-label="最近 90 天每日生成热力图">
        {daily.map((item) => <i className={`my-port-heat-cell ${level(item.count)}`} key={item.date} title={`${item.date} · ${item.count} 次`} />)}
      </div>
      <div className="my-port-heat-legend"><span>少</span><i /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /><span>多</span></div>
    </div>
  );
}

function HourBars({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly);
  const peak = hourly.indexOf(Math.max(...hourly));
  return (
    <div className="my-port-hours-wrap">
      <div className="my-port-hours" role="img" aria-label={`常用时段约为 ${peak}:00`}>
        {hourly.map((count, hour) => <i className={count > 0 && hour === peak ? "peak" : count === 0 ? "zero" : ""} style={{ height: count ? `${Math.max(8, count / max * 100)}%` : 3 }} key={hour} title={`${hour}:00 · ${count} 次`} />)}
      </div>
      <div className="my-port-hours-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
    </div>
  );
}

function LedgerTable({ rows }: { rows: PortraitTxVO[] }) {
  return (
    <div className="my-port-table-wrap">
      <table className="my-port-table">
        <thead><tr><th>时间</th><th>类型</th><th className="right">变动</th><th>备注</th></tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={`${row.time}-${index}`}>
            <td className="mono">{time(row.time)}</td>
            <td>{labelFor(row.changeType, CHANGE_LABELS)}</td>
            <td className={`right mono ${row.amount > 0 ? "gain" : ""}`}>{signed(row.amount)}</td>
            <td className="muted" title={row.remark}>{row.remark || "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OrdersTable({ rows }: { rows: PortraitOrderVO[] }) {
  return (
    <div className="my-port-table-wrap">
      <table className="my-port-table">
        <thead><tr><th>时间</th><th>订单</th><th>类型</th><th className="right">金额</th><th>状态</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.orderNo}>
            <td className="mono">{time(row.time)}</td>
            <td className="mono truncate">{row.orderNo}</td>
            <td>{row.orderType === "plan" ? "套餐" : "积分包"}</td>
            <td className="right mono">¥{row.amount}</td>
            <td><span className={`my-port-order-status s${row.status}`}>{ORDER_STATUS[row.status] || "未知"}</span></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ClaimsTable({ rows }: { rows: PortraitClaimVO[] }) {
  return (
    <div className="my-port-table-wrap">
      <table className="my-port-table">
        <thead><tr><th>时间</th><th>批次</th><th>兑换码</th><th className="right">积分</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={`${row.time}-${row.codeHint}`}>
            <td className="mono">{time(row.time)}</td>
            <td>{row.batchName || "—"}</td>
            <td className="mono">{row.codeHint}</td>
            <td className="right mono gain">+{fmt(row.points)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function MyPortraitPage() {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [data, setData] = useState<UserPortraitVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!(await ensureSession())) return;
      const result = await authApi.portrait();
      if (!result.success || !result.data) throw new Error(result.message || "画像加载失败");
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  if (loading) return <div className="my-port-page"><div className="my-port-loading"><span /><span /><span /></div></div>;
  if (!data) return <div className="my-port-page"><div className="my-port-error"><strong>{error || "画像暂时不可用"}</strong><button type="button" onClick={() => void load()}><RefreshCw size={14} />重试</button></div></div>;

  const { user, points, activity, generation, models, assets, commerce } = data;
  const successRate = generation.total ? `${Math.round(generation.success / generation.total * 100)}%` : "—";
  const displayName = user.nickname || user.username || "创作者";
  const email = !user.email || isPlaceholderEmail(user.email) ? "未绑定邮箱" : user.email;
  const hasCommerce = commerce.recentOrders.length > 0 || commerce.recentClaims.length > 0 || commerce.paidOrderCount > 0 || commerce.claimCount > 0 || commerce.checkinCount > 0;
  const hasAssets = generation.success > 0 || assets.workCount > 0 || assets.projectCount > 0 || assets.fileCount > 0;

  return (
    <div className="my-port-page">
      <div className="my-port-topbar">
        <span className="my-port-kicker"><Sparkles size={14} aria-hidden />MY CREATIVE PROFILE</span>
        <div><button type="button" onClick={() => void load()}><RefreshCw size={14} />刷新</button><Link href="/account"><ArrowLeft size={14} />我的</Link></div>
      </div>

      <header className="my-port-hero">
        <div className="my-port-hero-orb one" /><div className="my-port-hero-orb two" />
        <div className="my-port-identity">
          <span className="my-port-avatar" style={{ background: `center / cover no-repeat url("${user.avatar || defaultAvatar(user.id)}")` }} />
          <div><div className="my-port-name"><h1>{displayName}</h1><span className="my-port-status">● 正常</span>{user.vipLevel >= 1 ? <span className="my-port-plan">{user.planName || "付费用户"}</span> : null}</div><p>{email} <span>·</span> ID {user.id}</p><small>加入于 {time(user.createTime).slice(0, 10)} · 最近登录 {time(user.lastLoginTime)}</small></div>
        </div>
        <div className="my-port-reading"><span>PORTRAIT NOTE</span><p>{generation.total === 0 ? "你的创作旅程还没有开始。选一个灵感，把第一件作品留在这里。" : `你已经完成 ${fmt(generation.success)} 次生成，${generation.total30 > 0 ? `近 30 天保持了 ${fmt(generation.total30)} 次创作节奏。` : "最近暂未继续创作。"}`}</p><small>{generation.total === 0 ? "从一次创作开始，画像会慢慢长出来。" : `成功率 ${successRate} · 当前积分 ${fmt(points.balance)}`}</small></div>
      </header>

      <div className="my-port-metrics">
        <div><span className="metric-icon violet"><Coins size={16} /></span><small>积分余额</small><strong>{fmt(points.balance)}</strong><em>累计获得 {fmt(points.totalEarned)}</em></div>
        <div><span className="metric-icon cyan"><Sparkles size={16} /></span><small>生成总数</small><strong>{fmt(generation.total)}</strong><em>成功 {fmt(generation.success)} 次</em></div>
        <div><span className="metric-icon green"><Activity size={16} /></span><small>创作成功率</small><strong>{successRate}</strong><em>失败 {fmt(generation.failed)} 次</em></div>
        <div><span className="metric-icon amber"><WalletCards size={16} /></span><small>累计付费</small><strong>¥{commerce.paidAmount || "0.00"}</strong><em>{fmt(commerce.paidOrderCount)} 笔订单</em></div>
      </div>

      <PortraitSection title="活跃度" note="最近 90 天的创作节奏" icon={Activity}>
        {activity.daily.some((item) => item.count > 0) || activity.hourly.some((count) => count > 0) ? <div className="my-port-activity-grid"><div className="my-port-chart"><h3>每日生成</h3><ActivityHeatmap daily={activity.daily} /></div><div className="my-port-chart"><h3>常用时段</h3><HourBars hourly={activity.hourly} /></div></div> : <div className="my-port-empty"><Activity size={20} /><span>近 90 天还没有生成行为</span></div>}
        <div className="my-port-foot-stats"><span><b>{activity.activeDays30}</b> 天创作</span><span><b>{activity.loginDays30}</b> 天登录</span></div>
      </PortraitSection>

      <PortraitSection title="创作偏好" note={generation.total ? `成功 ${fmt(generation.success)} · 失败 ${fmt(generation.failed)} · 取消 ${fmt(generation.cancelled)}` : "还没有生成记录"} icon={Layers3}>
        {generation.total === 0 ? <div className="my-port-empty"><Sparkles size={20} /><span>还没有任何生成记录，下一件作品等你开始</span><Link href="/studio">去创作 <ArrowLeft size={14} /></Link></div> : <div className="my-port-preference-grid"><div><h3>按生成方式</h3><RankList items={generation.byHandler} /></div><div><h3>模型使用</h3>{models.length ? <div className="my-port-rank-list">{models.map((model) => <div className="my-port-rank-row" key={model.model}><span className="my-port-rank-label" title={model.model}>{model.model}</span><span className="my-port-rank-track"><i style={{ width: `${Math.max(4, model.count / Math.max(1, ...models.map((item) => item.count)) * 100)}%` }} /></span><b>{fmt(model.count)}</b><small>{Math.round(model.success / model.count * 100)}% 成功</small></div>)}</div> : <p className="my-port-empty-copy">暂无模型记录</p>}</div></div>}
      </PortraitSection>

      <div className="my-port-two-col">
        <PortraitSection title="积分流水" note={`获得 ${fmt(points.totalEarned)} · 消耗 ${fmt(points.totalSpent)}`} icon={Coins}>
          {points.byType.length ? <RankList items={points.byType.map((item) => ({ ...item, key: labelFor(item.key, CHANGE_LABELS) }))} /> : <p className="my-port-empty-copy">暂无积分流水</p>}
          {points.transactions.length ? <><h3 className="my-port-subhead">最近流水</h3><LedgerTable rows={points.transactions} /></> : null}
        </PortraitSection>
        <PortraitSection title="消费与权益" note={hasCommerce ? `兑换 ${fmt(commerce.claimCount)} 次 · 签到 ${fmt(commerce.checkinCount)} 次` : "还没有消费记录"} icon={BadgeDollarSign}>
          {!hasCommerce ? <div className="my-port-empty"><BadgeDollarSign size={20} /><span>没有订单、兑换与签到记录</span></div> : <><div className="my-port-benefits"><div><small>兑换码</small><b>{fmt(commerce.claimCount)} 次</b><span>+{fmt(commerce.claimPoints)} 分</span></div><div><small>签到</small><b>{fmt(commerce.checkinCount)} 次</b><span>最长 {fmt(commerce.checkinStreak)} 天</span></div><div><small>付费订单</small><b>{fmt(commerce.paidOrderCount)} 笔</b><span>¥{commerce.paidAmount || "0.00"}</span></div></div>{commerce.recentOrders.length ? <><h3 className="my-port-subhead">最近订单</h3><OrdersTable rows={commerce.recentOrders} /></> : null}{commerce.recentClaims.length ? <><h3 className="my-port-subhead">最近兑换</h3><ClaimsTable rows={commerce.recentClaims} /></> : null}</>}
        </PortraitSection>
      </div>

      <PortraitSection title="资产沉淀" note="你的作品与上传素材" icon={Database}>
        {hasAssets ? <div className="my-port-assets"><div><b>{fmt(assets.workCount)}</b><span>作品</span></div><div><b>{fmt(assets.projectCount)}</b><span>项目</span></div><div><b>{fmt(assets.fileCount)}</b><span>上传素材</span></div><div><b>{fmt(generation.success)}</b><span>生成素材</span></div></div> : <div className="my-port-empty"><Database size={20} /><span>还没有沉淀资产，作品会在这里留下</span><Link href="/assets">打开资产库 <ArrowLeft size={14} /></Link></div>}
      </PortraitSection>
    </div>
  );
}
