"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CircleAlert, Clock3, Film, Lightbulb, Loader2, Pencil, RotateCcw, Target } from "lucide-react";
import { skillRunError, type SkillRunAction, type SkillRunVO } from "@/types/skill-run";
import { parseContentReport } from "./content-report";
import styles from "./analysis.module.css";

interface Props {
  run: SkillRunVO;
  text: string;
  image: boolean;
  busy: boolean;
  onAction: (action: SkillRunAction) => void | Promise<unknown>;
  onReEdit: () => void;
  onDismiss: () => void;
  renderMarkdown: (text: string) => ReactNode;
  reportTime: string;
}

export function ContentAnalysisReport({ run, text, image, busy, onAction, onReEdit, onDismiss, renderMarkdown, reportTime }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { takeaways, moments } = useMemo(() => parseContentReport(text, image), [text, image]);
  const moment = moments[Math.min(selectedIndex, moments.length - 1)];
  const active = run.status === "queued" || run.status === "running";
  const succeeded = run.status === "succeeded";
  const failed = run.status === "failed";
  const progress = Math.max(0, Math.min(100, Number.isFinite(run.progress) ? run.progress : 0));
  return (
    <article className={styles.contentAnalysisReport} data-status={run.status}>
      <header className={styles.contentReportStatus}>
        <span><i data-active={active} />{active ? "正在生成报告" : succeeded ? "报告已生成" : failed ? "生成失败" : "已停止"}</span>
        <small>{active ? `${Math.round(progress)}%` : "基于本次素材"}</small>
      </header>
      {active ? <div className={styles.accountReportPending} role="status">
        <Loader2 className={styles.spin} aria-hidden />
        <div><strong>{image ? "正在提炼画面要点" : "正在梳理视频内容"}</strong><p>完成后直接展示关键结论{!image && "和带时间码的片段发现"}，离开页面后仍可从历史记录恢复。</p></div>
        <div className={styles.accountReportProgress} role="progressbar" aria-label="分析进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ transform: `scaleX(${progress / 100})` }} /></div>
      </div> : succeeded ? <>
        {takeaways.length > 0 && <div className={styles.reportTakeaways}>
          {takeaways.map(item => {
            const Icon = item.key === "summary" ? Film : item.key === "hook" ? Target : Lightbulb;
            return <section key={item.key} data-kind={item.key === "reuse" ? "action" : item.key}>
              <span><Icon aria-hidden /></span><div><h4>{item.label}</h4><p>{item.text}</p></div>
            </section>;
          })}
        </div>}
        {!image && (moment ? <section className={styles.reportTimeline} aria-label="视频节奏时间线">
          <header><h3><Clock3 aria-hidden />节奏时间线</h3><small>报告中的时间片段</small></header>
          <div className={styles.momentNavigation} role="group" aria-label="选择时间片段">
            {moments.map((item, index) => <button type="button" key={`${item.start}:${item.end}`} aria-pressed={moment === item} aria-label={`${item.time} ${item.title}`} onClick={() => setSelectedIndex(index)}>
              <i aria-hidden>{String(index + 1).padStart(2, "0")}</i><span>{item.time.split(" — ")[0]}</span>
            </button>)}
          </div>
          <div className={styles.momentDetail} aria-live="polite"><time>{moment.time}</time><h4>{moment.title}</h4><p>{moment.text}</p></div>
        </section> : text && <p className={styles.reportNoTimeline}>这份报告没有可定位的时间片段，可展开完整分析查看已有结论。</p>)}
        {text ? <details className={styles.reportFullDetails} onToggle={event => setExpanded(event.currentTarget.open)}>
          <summary>{takeaways.length ? image ? "完整分析与依据" : "完整文案与分析依据" : "展开完整报告"}<ChevronRight aria-hidden /></summary>
          {expanded && <div className={styles.accountReportContent}>{renderMarkdown(text)}</div>}
        </details> : <p className={styles.reportNoTimeline}>报告已完成，但没有可展示的正文。</p>}
      </> : <div className={styles.accountReportFailure} role="status"><CircleAlert aria-hidden /><div><strong>{failed ? "这次报告未能生成" : "已停止本次分析"}</strong><p>{failed ? skillRunError(run) || "服务暂时不可用，请稍后重试。" : "可以重新运行这次分析。"}</p></div></div>}
      <div className={styles.accountReportFooter}>
        <span>{reportTime && `${succeeded ? "生成于" : "更新于"} ${reportTime}`}{run.pointCost && run.pointCost > 0 ? ` · 使用 ${run.pointCost} 积分` : ""}</span>
        <div>
          {active && <button type="button" disabled={busy} onClick={() => void onAction("cancel")}>停止生成</button>}
          {(failed || run.status === "cancelled") && <button type="button" disabled={busy} onClick={() => void onAction("retry")}><RotateCcw aria-hidden />重新生成</button>}
          {!active && <button type="button" disabled={busy} onClick={onReEdit}><Pencil aria-hidden />重新编辑</button>}
          {!active && <button type="button" disabled={busy} onClick={onDismiss}>关闭报告</button>}
        </div>
      </div>
    </article>
  );
}
