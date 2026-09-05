import { ArrowUpRight, ScanSearch, Target, Trophy } from "lucide-react";
import type { AccountSnapshot } from "./account-insights";
import styles from "./analysis.module.css";

const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1).replace(/\.0$/, "")}%`;

export function AccountReportMetrics({ snapshot }: { snapshot: AccountSnapshot }) {
  const share = snapshot.topConcentration;
  const high = snapshot.highPerformanceRate;
  const multiple = snapshot.topPerformanceMultiple;
  const highCount = snapshot.medianViews !== null && snapshot.medianViews > 0
    ? snapshot.works.filter(work => work.views !== null && work.views >= snapshot.medianViews! * 2).length : 0;
  const comparable = snapshot.measuredViews > 1 && snapshot.medianViews !== null && snapshot.medianViews > 0;
  return (
    <div className={styles.reportMetrics}>
      <div className={styles.reportConcentration}>
        <div className={styles.reportDial}>
          <svg viewBox="0 0 120 120" aria-hidden>
            <circle className={styles.reportDialTrack} cx="60" cy="60" r="49" />
            {share !== null && <circle className={styles.reportDialValue} cx="60" cy="60" r="49" pathLength="100" strokeDasharray={`${share} ${100 - share}`} transform="rotate(-90 60 60)" />}
            <circle className={styles.reportDialInner} cx="60" cy="60" r="38" />
          </svg>
          <strong>{percent(share)}</strong>
        </div>
        <div><span><ScanSearch aria-hidden />头部播放贡献</span><h3>{!comparable ? "等待更多样本" : share !== null && share >= 50 ? "头部作品拉动明显" : "播放分布相对分散"}</h3><p>{share === null ? "暂无可比较的播放数据" : `播放最高的一条，占样本总播放的 ${percent(share)}`}</p></div>
      </div>
      <div className={styles.reportMiniMetrics}>
        <div><span><Target aria-hidden />高表现作品</span><strong>{high === null ? "—" : `${high.toFixed(high < 1 ? 2 : high < 10 ? 1 : 0)}%`}</strong>
          <div className={styles.reportSegmentBar} aria-hidden>{Array.from({ length: 12 }, (_, index) => <i key={index} data-filled={high !== null && index < Math.round(high / 100 * 12)} />)}</div>
          <small>{high === null ? "样本不足，暂不比较" : `${highCount} / ${snapshot.measuredViews} 条 · ≥ 2× 中位播放`}</small>
        </div>
        <div><span><Trophy aria-hidden />最高播放 / 日常</span><strong>{multiple === null ? "—" : `${multiple.toFixed(2)}×`}<ArrowUpRight aria-hidden /></strong>
          <div className={styles.reportComparison} aria-hidden><i style={{ width: multiple === null ? "0%" : "100%" }} /><i style={{ width: multiple === null ? "0%" : `${Math.min(100, 100 / multiple)}%` }} /></div>
          <small>{multiple === null ? "样本不足，暂不比较" : "最高播放 vs 样本中位数"}</small>
        </div>
      </div>
      <p className={styles.reportMetricsNote}>仅对比本次 {snapshot.sampleCount} 条样本，不代表行业评分。</p>
    </div>
  );
}
