"use client";

import { BarChart3, Hash, Layers, ListVideo, Radio, ScanSearch } from "lucide-react";
import type { CSSProperties } from "react";
import type { SocialInspectVO, SocialPlatformDetails, SocialWorkVO } from "@/lib/social-analysis-api";
import { platformVocabulary } from "./platform-metrics.js";
import { parseMetricNumber } from "./metric-number.js";
import styles from "./analysis.module.css";

function fieldText(field: NonNullable<SocialPlatformDetails["fields"]>[number]) {
  const n = field.format === "count" ? parseMetricNumber(field.value) : null;
  return n === null ? field.value : n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

export function PlatformFacts({ details, title }: { details?: SocialPlatformDetails; title: string }) {
  if (!details?.fields?.length && !details?.tags?.length && !details?.languages?.length) return null;
  return <section className={styles.platformFacts}>
    <header className={styles.dataPanelHeader}><div><ScanSearch aria-hidden /><span><strong>{title}</strong><small>平台公开资料 · 本次快照</small></span></div></header>
    {!!details.fields?.length && <dl className={styles.platformFieldGrid}>{details.fields.map((field) => <div key={field.key} data-numeric={field.format === "count"}><dt>{field.label}</dt><dd>{fieldText(field)}</dd></div>)}</dl>}
    {!!details.tags?.length && <div className={styles.platformTagList} aria-label="平台返回的标签"><Hash aria-hidden />{details.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
    {!!details.languages?.length && <p className={styles.visualNote}>字幕语言：{details.languages.join("、")}。轨道信息不等于已提取字幕全文。</p>}
  </section>;
}

function timeLabel(seconds: number) {
  const n = Math.floor(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

export function PlatformWorkDetails({ work }: { work: SocialWorkVO }) {
  const chapters = work.details?.chapters || [];
  return <>
    {work.description && <details className={styles.platformFullText}><summary>{work.platform === "xiaohongshu" ? "查看笔记正文" : "查看作品完整文案"}</summary><p>{work.description}</p></details>}
    <PlatformFacts details={work.details} title={work.platform === "xiaohongshu" ? "笔记档案" : "作品档案"} />
    {chapters.length > 0 && <section className={styles.platformFacts}>
      <header className={styles.dataPanelHeader}><div><ListVideo aria-hidden /><span><strong>{work.platform === "bilibili" ? "分 P 目录" : "视频章节"}</strong><small>平台提供的原始目录</small></span></div><span>{chapters.length} 项</span></header>
      <ol className={styles.platformChapters}>{chapters.map((chapter, index) => <li key={`${index}-${chapter.title}`}><span>{String(index + 1).padStart(2, "0")}</span><strong>{chapter.title || `第 ${index + 1} 部分`}</strong><time>{chapter.start !== undefined ? timeLabel(chapter.start) : chapter.duration || "—"}</time></li>)}</ol>
    </section>}
  </>;
}

export function PlatformAccountPanels({ result }: { result: SocialInspectVO }) {
  const words = platformVocabulary(result.platform);
  const tagCounts = new Map<string, number>();
  const formats = new Map<string, number>();
  for (const work of result.works) {
    const tags = new Set(work.details?.tags || []);
    const category = work.details?.fields?.find((item) => item.key === "category")?.value;
    if (category) tags.add(category);
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    const kind = work.mediaType === "image" ? "图文 / 图集" : work.mediaType === "video" ? "视频" : "类型未返回";
    formats.set(kind, (formats.get(kind) || 0) + 1);
  }
  const tags = [...tagCounts].sort((a, b) => b[1] - a[1]);
  const tagged = result.works.filter((work) => work.details?.tags?.length || work.details?.fields?.some((item) => item.key === "category")).length;
  return <>
    <PlatformFacts details={result.profile?.details} title={`${words.account}档案`} />
    {result.works.length > 0 && <div className={styles.platformDistribution}>
      <section className={styles.platformFacts}>
        <header className={styles.dataPanelHeader}><div><Layers aria-hidden /><span><strong>内容形式</strong><small>{result.works.length} 条公开{words.works}样本</small></span></div></header>
        <div className={styles.formatSpectrum} role="img" aria-label={[...formats].map(([name, count]) => `${name} ${count} 条`).join("，")}>{[...formats].map(([name, count], i) => <i key={name} data-tone={i} style={{ flexGrow: count }} />)}</div>
        <div className={styles.formatLegend}>{[...formats].map(([name, count]) => <div key={name}><Radio aria-hidden /><span>{name}</span><strong>{count}</strong><small>{(count / result.works.length * 100).toFixed(0)}%</small></div>)}</div>
        <p className={styles.visualNote}>按实际作品类型区分；图文不套用视频时长或播放指标。</p>
      </section>
      <section className={styles.platformFacts}>
        <header className={styles.dataPanelHeader}><div><BarChart3 aria-hidden /><span><strong>{words.tags}</strong><small>{tagged} 条样本带有分类 / 话题</small></span></div></header>
        {tags.length ? <div className={styles.topicBars}>{tags.slice(0, 8).map(([name, count]) => <div key={name}><span title={name}>{name}</span><i style={{ "--topic-width": `${count / result.works.length * 100}%` } as CSSProperties} /><strong>{count} 条</strong></div>)}</div> : <p className={styles.visualEmpty}>本次样本未返回分类或话题标签，暂不推断主题占比。</p>}
        {tags.length > 8 && <details className={styles.platformAllTags}><summary>全部 {tags.length} 个分类与话题</summary><div className={styles.platformTagList}>{tags.map(([name, count]) => <span key={name}>{name} · {count}</span>)}</div></details>}
        {tags.length > 0 && <p className={styles.visualNote}>一条作品可包含多个话题，按作品去重计数，不代表粉丝兴趣分布。</p>}
      </section>
    </div>}
  </>;
}
