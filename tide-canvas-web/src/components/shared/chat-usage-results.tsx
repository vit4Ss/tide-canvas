"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronUp, CircleAlert, Copy, Database, Fingerprint, ReceiptText } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { usageCachePercent, usageDateParts, usageDecimal, usageDuration, usagePercent, usagePoints, usageProtocol, usageStatuses, usageTime, type ChatUsagePage, type ChatUsageRow } from "@/lib/chat-usage";
import styles from "./chat-usage-panel.module.css";

const number = (value: number) => value.toLocaleString("zh-CN");
const pointNumber = usageDecimal;

function MetricValue({ value, unit }: { value: string; unit: string }) {
  return <strong className={styles.metricValue} data-long={value.length > 18 || undefined}><span className={styles.metricNumber} style={{ "--number-scale": Math.max(.7, Math.min(1, 14 / value.length)) } as CSSProperties}>{value}</span>{value !== "—" && <small>{unit}</small>}</strong>;
}

export function UsageOverview({ data, loading }: { data?: ChatUsagePage; loading: boolean }) {
  const summary = data?.summary;
  const input = summary?.inputTokens ?? 0;
  const output = summary?.outputTokens ?? 0;
  const total = input + output;
  const cachePercent = usageCachePercent(input, summary?.cachedInputTokens ?? 0);
  const inputShare = total > 0 ? input / total * 100 : null;
  return <div className={styles.overview} data-long-points={pointNumber(summary?.points).length > 18 || undefined} aria-label="当前筛选范围的用量合计" aria-busy={loading}>
    <div className={styles.tokenMetric}>
      <div className={styles.tokenSummary}><span className={styles.metricLabel}>Token 总用量<span>输入 + 输出</span></span><MetricValue value={summary ? number(total) : "—"} unit="tokens" />
        <div className={styles.tokenComposition} aria-label="输入与输出 Token 构成">
          <div><span><i />输入</span><b>{summary ? number(input) : "—"}</b><small>{inputShare == null ? "暂无占比" : `${usagePercent(inputShare)}%`}</small></div>
          <div><span><i />输出</span><b>{summary ? number(output) : "—"}</b><small>{inputShare == null ? "暂无占比" : `${usagePercent(100 - inputShare)}%`}</small></div>
        </div>
      </div>
      <div className={styles.tokenVisual} aria-hidden>
        <svg viewBox="0 0 140 140"><circle className={styles.dialGuide} cx="70" cy="70" r="65" /><circle className={styles.dialTrack} cx="70" cy="70" r="53" />{total > 0 && <><circle className={styles.dialOutput} cx="70" cy="70" r="53" /><circle className={styles.dialInput} cx="70" cy="70" r="53" pathLength="100" strokeDasharray={`${inputShare} 100`} transform="rotate(-90 70 70)" /></>}</svg>
        <span><small>输入占比</small><b>{inputShare == null ? "—" : `${usagePercent(inputShare)}%`}</b></span>
      </div>
    </div>
    <div className={styles.metric}><span className={styles.metricLabel}>实扣积分</span><MetricValue value={summary ? pointNumber(summary.points) : "—"} unit="积分" /><span className={styles.metricFoot}>已减退款，不含冻结额度</span></div>
    <div className={styles.metric}><span className={styles.metricLabel}>调用次数</span><MetricValue value={summary ? number(summary.calls) : "—"} unit="次" /><span className={styles.metricFoot}>{summary?.pending ? <span className={styles.pendingNote}><i />{number(summary.pending)} 笔待结算 / 核对</span> : "统计已受理的调用"}</span></div>
    <div className={`${styles.metric} ${styles.cacheMetric}`}><span className={styles.metricLabel}>缓存占输入</span><div className={styles.cacheReadout}><MetricValue value={usagePercent(cachePercent)} unit="%" /><div className={styles.cacheRing} style={{ "--cache-deg": `${(cachePercent ?? 0) * 3.6}deg` } as CSSProperties} aria-hidden /></div><span className={styles.metricFoot}>{summary ? `${number(summary.cachedInputTokens)} 缓存 Token` : "仅统计已核实的用量"}</span></div>
  </div>;
}

function StateBadge({ status }: { status: string }) {
  const state = usageStatuses[status] ?? { label: status, tone: "muted" };
  return <span className={`${styles.badge} ${styles[state.tone]}`}><i aria-hidden />{state.label}</span>;
}

export function UsageRows({ row, admin, expanded, onToggle }: { row: ChatUsageRow; admin: boolean; expanded: boolean; onToggle: () => void }) {
  const detailId = useId();
  const expandRef = useRef<HTMLButtonElement>(null);
  const date = usageDateParts(row.createTime);
  const pending = row.status === "pending" || row.status === "billing_pending";
  const refunded = Number(row.refundedPoints ?? 0) > 0;
  return <tbody className={`${styles.recordGroup} ${expanded ? styles.expandedGroup : ""}`} data-long-cost={usagePoints(row).length > 15 || undefined}>
    <tr className={styles.row}>
      <td className={styles.modelCell}><span className={styles.modelMark} aria-hidden>{row.model.slice(0, 1).toUpperCase()}</span><div><button type="button" className={styles.modelButton} title={row.modelName || row.model} aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={onToggle}>{row.modelName || row.model}</button><span className={styles.modelMeta}><code title={row.model}>{row.model}</code></span><span className={styles.protocol}>{usageProtocol(row.requestPath)}<span className={styles.mode}>{row.stream ? "流式" : "非流式"}</span></span></div></td>
      {admin && <td className={styles.operatorCell} data-label="用户 / 供应商"><code>{row.userId}</code><small>{row.providerName || "—"}{row.providerName && row.providerName !== row.billingProviderName ? " · 备用" : ""}</small></td>}
      <td className={styles.tokenCell} data-label="Token 用量"><div><span title="输入 Token（含缓存）"><span className={styles.tokenDirection}>输入</span><b>{row.usageKnown ? number(row.inputTokens) : "—"}</b></span><span title="输出 Token（含推理）"><span className={styles.tokenDirection}>输出</span><b>{row.usageKnown ? number(row.outputTokens) : "—"}</b></span></div><small><Database size={11} aria-hidden />缓存 {row.usageKnown ? number(row.cachedInputTokens) : "未返回"}</small></td>
      <td className={styles.costCell} data-label="实扣积分"><strong className={pending ? styles.pendingCost : ""}>{usagePoints(row)}</strong><small>{pending ? `预留 ${pointNumber(row.reservedPoints)}` : refunded ? `已退 ${pointNumber(row.refundedPoints!)}` : "积分"}</small></td>
      <td className={styles.durationCell} data-label="响应耗时"><span>{usageDuration(row.durationMs)}</span><small>首字 {usageDuration(row.firstTokenMs)}</small></td>
      <td className={styles.timeCell} data-label="调用时间"><time dateTime={row.createTime} title={usageTime(row.createTime)}>{date.time}<small>{date.date}</small></time></td>
      <td className={styles.stateCell}><StateBadge status={row.status} /></td>
      <td className={styles.expandCell}><button ref={expandRef} type="button" className={styles.expand} aria-label={`${expanded ? "收起" : "查看"} ${row.model} 调用详情`} aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={onToggle}><span>{expanded ? "收起" : "账单"}</span><ChevronDown size={15} aria-hidden /></button></td>
    </tr>
    {expanded && <tr className={styles.detailRow}><td colSpan={admin ? 8 : 7}><div id={detailId}><UsageDetail row={row} admin={admin} onClose={() => { onToggle(); requestAnimationFrame(() => expandRef.current?.focus()); }} /></div></td></tr>}
  </tbody>;
}

function TokenBreakdown({ label, total, subset, subsetLabel, known, output = false }: { label: string; total: number; subset: number; subsetLabel: string; known: boolean; output?: boolean }) {
  const ratio = known ? usageCachePercent(total, subset) : null;
  return <div className={`${styles.tokenBreakdown} ${output ? styles.outputBreakdown : ""}`}>
    <div className={styles.breakdownLabel}>{output ? <ArrowUpRight size={15} aria-hidden /> : <ArrowDownLeft size={15} aria-hidden />}<span>{label}</span><small>Token</small></div>
    <strong>{known ? number(total) : "—"}</strong>
    <div className={styles.subsetTrack} aria-hidden><i style={{ width: `${ratio ?? 0}%` }} /></div>
    <dl><div><dt>其中{subsetLabel}</dt><dd>{known ? number(subset) : "—"}</dd></div></dl>
    <p>{ratio == null ? known ? "暂无可计算的占比" : "尚未返回可靠用量" : `占${label} ${usagePercent(ratio)}%，已包含在上方总量中`}</p>
  </div>;
}

function UsageDetail({ row, admin, onClose }: { row: ChatUsageRow; admin: boolean; onClose: () => void }) {
  const [copyState, setCopyState] = useState("");
  const pending = row.status === "pending" || row.status === "billing_pending";
  const notice = row.status === "pending" ? "调用仍在处理中，预留积分不代表最终扣费。"
    : row.status === "billing_pending" ? "本次费用待核对，核对完成后展示最终扣费。"
      : row.status === "failed" ? "本次调用失败，请结合错误标识排查请求。"
        : row.status === "released" ? "本次调用的预留额度已释放。"
          : row.status === "partial" ? "本次调用仅部分完成，请核对返回内容和实际扣费。" : "";
  return <div className={styles.detail}>
    <div className={styles.detailTitle}><h3><ReceiptText size={16} aria-hidden />调用账单</h3><span>{usageTime(row.createTime)} · 北京时间</span></div>
    {notice && <div className={`${styles.detailNotice} ${styles[usageStatuses[row.status]?.tone ?? "muted"]}`}><CircleAlert size={15} aria-hidden /><span>{notice}{row.errorCode && <code>{row.errorCode}</code>}</span></div>}
    <div className={styles.detailGrid}>
      <div className={styles.usageBreakdown}><h4>用量构成</h4><div className={styles.breakdownGrid}><TokenBreakdown label="输入" total={row.inputTokens} subset={row.cachedInputTokens} subsetLabel="缓存" known={row.usageKnown} /><TokenBreakdown label="输出" total={row.outputTokens} subset={row.reasoningTokens} subsetLabel="推理" known={row.usageKnown} output /></div></div>
      <div className={styles.billingBreakdown}><h4>{pending ? "结算状态" : "实际消耗"}</h4><strong className={styles.billTotal}>{usagePoints(row)}{!pending && <small>积分</small>}</strong><dl><div><dt>{pending ? "预留积分" : "原始扣费"}</dt><dd>{pointNumber(pending ? row.reservedPoints : row.points)} 积分</dd></div><div><dt>已退款</dt><dd>{pointNumber(row.refundedPoints ?? "0")} 积分</dd></div></dl><p>{pending ? "实际消耗将在结算后确定。" : "按调用时的单价结算，已扣除退款。"}</p></div>
    </div>
    <div className={styles.pricingLine}><span>积分 / 1M Token</span><span>输入 <b>{pointNumber(row.pricing?.inputPointsPerMillion)}</b></span><span>输出 <b>{pointNumber(row.pricing?.outputPointsPerMillion)}</b></span><span>缓存 <b>{pointNumber(row.pricing?.cachedInputPointsPerMillion ?? row.pricing?.inputPointsPerMillion)}</b></span><small>{row.pricing ? `已含倍率 ×${row.priceMultiplier || "1"}` : "未记录历史单价"}</small></div>
    <details className={styles.requestDetails} open={admin}>
      <summary><Fingerprint size={16} aria-hidden /><span>请求信息</span><small>模型、调用编号与接入信息</small><ChevronDown size={16} aria-hidden /></summary>
    <dl className={styles.requestFacts}><div><dt>模型 ID</dt><dd><code>{row.model}</code></dd></div><div><dt>模型名称</dt><dd>{row.modelName || row.model}</dd></div><div><dt>调用编号</dt><dd><code>{row.id}</code><button type="button" className={styles.copyButton} aria-label="复制调用编号" onClick={async () => setCopyState(await copyText(row.id) ? "已复制" : "复制失败，请选中编号复制")}>{copyState === "已复制" ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}</button><span role="status">{copyState}</span></dd></div><div><dt>API Key</dt><dd><code>{row.keyHint || "默认 Key"}</code><span>v{row.keyRevision}</span></dd></div><div><dt>入站接口</dt><dd><code>{row.requestPath}</code></dd></div>{row.errorCode && <div><dt>错误标识</dt><dd className={styles.error}>{row.errorCode}</dd></div>}{admin && <><div><dt>来源 IP</dt><dd>{row.clientIP || "—"}</dd></div><div><dt>实际供应商 / 计价供应商</dt><dd>{row.providerName || "—"} / {row.billingProviderName || "—"}</dd></div><div><dt>接入地址 ID / 上游 HTTP</dt><dd>{row.endpointId && row.endpointId !== "0" ? row.endpointId : "—"} / {row.upstreamStatus || "未收到响应"}</dd></div></>}</dl>
    </details>
    <div className={styles.detailEnd}><p>耗时统计上游处理过程，未测量的值显示为「—」。</p><button type="button" className={styles.quietButton} onClick={onClose}>收起账单<ChevronUp size={15} aria-hidden /></button></div>
  </div>;
}
