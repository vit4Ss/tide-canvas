"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, MessageCircle, Trophy } from "lucide-react";
import { buildAccountFeatures, type AccountSnapshot, type AccountWorkDatum } from "./account-insights";
import styles from "./analysis.module.css";

const compact = (value: number) => new Intl.NumberFormat("zh-CN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function representativeMetric(item: AccountWorkDatum, ranking: AccountSnapshot["rankingLabel"]) {
  if (ranking === "播放") return item.views === null ? "播放数据未返回" : `${compact(item.views)} 播放`;
  if (ranking === "互动") return item.hasInteractionData ? `${compact(item.interactions)} 可见互动` : "互动数据未返回";
  if (item.views !== null) return `${compact(item.views)} 播放`;
  return item.hasInteractionData ? `${compact(item.interactions)} 可见互动` : "播放与互动数据未返回";
}

export function AccountVisuals({ snapshot, renderCover, onInspect }: {
  snapshot: AccountSnapshot;
  renderCover: (item: AccountWorkDatum) => ReactNode;
  onInspect: (item: AccountWorkDatum) => void;
}) {
  const features = buildAccountFeatures(snapshot);
  const [activeCell, setActiveCell] = useState<{ day: number; slot: number } | null>(null);
  const focusedCell = activeCell ? features.timing[activeCell.slot][activeCell.day] : null;
  const interactionMax = Math.max(0, ...snapshot.interactionParts.map((part) => part.value));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const segments = features.bands.map((band, index) => {
    const size = features.comparable ? band.count / snapshot.measuredViews * 100 : 0;
    const offset = features.comparable ? features.bands.slice(0, index).reduce((total, item) => total + item.count, 0) / snapshot.measuredViews * 100 : 0;
    return { ...band, size, offset };
  });

  return (
    <div className={styles.accountVisualGrid}>
      <section className={styles.accountVisualPanel}>
        <header className={styles.dataPanelHeader}>
          <div><ChartNoAxesCombined aria-hidden /><span><strong>作品表现分布</strong><small>找出明显高于日常的作品</small></span></div>
          <span>{snapshot.measuredViews} 条有播放数据</span>
        </header>
        <div className={styles.distributionBody}>
          <div className={styles.distributionRing}>
            <svg viewBox="0 0 160 160" role="img" aria-label={features.comparable ? segments.map((part) => `${part.label}${part.count}条`).join("，") : "样本不足，暂不能比较作品表现"}>
              <circle className={styles.ringBase} cx="80" cy="80" r="62" />
              {segments.filter((part) => part.size > 0).map((part) => (
                <circle key={part.key} data-band={part.key} cx="80" cy="80" r="62" pathLength="100" strokeDasharray={`${Math.max(0, part.size - .8)} ${100 - Math.max(0, part.size - .8)}`} strokeDashoffset={-part.offset} transform="rotate(-90 80 80)" />
              ))}
              <circle className={styles.ringInner} cx="80" cy="80" r="48" />
            </svg>
            <div><strong>{snapshot.highPerformanceRate === null ? "—" : `${Math.round(snapshot.highPerformanceRate)}%`}</strong><span>高表现占比</span></div>
          </div>
          <div className={styles.distributionLegend}>
            {segments.map((part) => (
              <div key={part.key} data-band={part.key}><i aria-hidden /><span>{part.label}<small>{part.rule}</small></span><strong>{features.comparable ? part.count : "—"}<small> 条</small></strong></div>
            ))}
          </div>
        </div>
        <p className={styles.visualNote}>{features.comparable
          ? `以本次样本中位播放为基准。${snapshot.sampleCount > snapshot.measuredViews ? `${snapshot.sampleCount - snapshot.measuredViews} 条缺少播放数据，未参与比较。` : "仅比较这个账号本次返回的作品。"}`
          : "至少两条有效播放数据且中位播放大于零，才能建立比较基准。"}</p>
      </section>

      <section className={styles.accountVisualPanel}>
        <header className={styles.dataPanelHeader}>
          <div><Trophy aria-hidden /><span><strong>代表作品</strong><small>{snapshot.rankingLabel === "平台顺序" ? "按平台返回顺序预览" : `按${snapshot.rankingLabel}排序，点击查看差异`}</small></span></div>
          <span>{Math.min(3, snapshot.sampleCount)} 条</span>
        </header>
        {features.top ? (
          <div className={styles.standoutList}>
            {snapshot.rankedWorks.slice(0, 3).map((item, index) => (
              <button type="button" key={item.work.id || item.index} className={styles.standoutWork} onClick={() => onInspect(item)}>
                <span className={styles.standoutRank}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.standoutCover}>{renderCover(item)}</span>
                <span className={styles.standoutCopy}>
                  <strong>{item.work.title || item.work.description || "未命名作品"}</strong>
                  <span>{representativeMetric(item, snapshot.rankingLabel)}
                    {features.comparable && item.views !== null ? ` · ${(item.views / snapshot.medianViews!).toFixed(1)}× 日常` : ""}
                  </span>
                  {snapshot.maxScore > 0 ? <i aria-hidden><b style={{ width: `${item.score / snapshot.maxScore * 100}%` }} /></i> : null}
                </span>
                <ArrowUpRight aria-hidden />
              </button>
            ))}
          </div>
        ) : <p className={styles.visualEmpty}>暂无作品样本。账号资料已保留，获取到作品后将在这里展示。</p>}
      </section>

      <section className={styles.accountVisualPanel}>
        <header className={styles.dataPanelHeader}>
          <div><CalendarDays aria-hidden /><span><strong>发布习惯</strong><small>样本发布时间 · {timezone}</small></span></div>
          <span>{features.timedSamples} 条含具体时间</span>
        </header>
        {features.timedSamples > 0 ? (
          <>
            <div className={styles.publishHeatmap}>
              <span aria-hidden />
              {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
              {features.timing.map((row, slot) => (
                <div className={styles.heatmapRow} key={slot}>
                  <span>{String(slot * 4).padStart(2, "0")}:00</span>
                  {row.map((cell) => {
                    const label = `${WEEKDAYS[cell.day]} ${cell.slot * 4}–${(cell.slot + 1) * 4} 时：${cell.count} 条作品`;
                    return <button type="button" key={cell.day} data-level={cell.count === 0 ? 0 : Math.max(1, Math.ceil(cell.count / features.maxTimingCount * 4))} aria-label={label} title={label} onMouseEnter={() => setActiveCell(cell)} onFocus={() => setActiveCell(cell)} onClick={() => setActiveCell(cell)} />;
                  })}
                </div>
              ))}
            </div>
            <div className={styles.heatmapCaption}>
              <span aria-live="polite">{focusedCell ? `${WEEKDAYS[focusedCell.day]} ${focusedCell.slot * 4}–${(focusedCell.slot + 1) * 4} 时 · ${focusedCell.count} 条` : "点选色块查看发布数量"}</span>
              <span>少<i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" />多</span>
            </div>
            <p className={styles.visualNote}>展示发布习惯，不代表最佳发布时间。仅有日期的作品不计入时段。</p>
          </>
        ) : <p className={styles.visualEmpty}>平台尚未返回具体的发布时间，暂不能判断账号的发布时段。</p>}
      </section>

      <section className={styles.accountVisualPanel}>
        <header className={styles.dataPanelHeader}>
          <div><MessageCircle aria-hidden /><span><strong>互动构成</strong><small>哪些互动获得了用户回应</small></span></div>
          <span>{snapshot.measuredInteractions > 0 ? `${compact(snapshot.totalInteractions)} 次可见互动` : "数据未返回"}</span>
        </header>
        <div className={styles.interactionBreakdown}>
          {snapshot.interactionParts.map((part) => (
            <div key={part.key} data-part={part.key}>
              <span>{part.label}</span>
              <div className={styles.interactionBar}><i style={{ "--bar-size": `${interactionMax > 0 ? part.value / interactionMax * 100 : 0}%` } as CSSProperties} /></div>
              <strong>{part.measured > 0 ? compact(part.value) : "未返回"}</strong>
              <small>{part.measured > 0 ? `${part.measured} 条有数据` : "暂无数据"}</small>
            </div>
          ))}
        </div>
        <p className={styles.visualNote}>{features.completeInteractionSamples < snapshot.sampleCount
          ? "互动数据尚不完整。未返回的指标不计为零，当前数字仅代表已获取的互动。"
          : snapshot.sampleCount > 0 ? "汇总本次作品样本实际返回的互动，不代表账号全部历史互动。" : "获得作品互动数据后，将在这里展示观众的互动偏好。"}</p>
      </section>
    </div>
  );
}
