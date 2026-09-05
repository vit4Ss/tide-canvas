import type { SocialInspectVO, SocialWorkVO, SocialMetricVO } from "@/lib/social-analysis-api";
import { parseMetricNumber } from "./metric-number.js";
import { platformMetrics } from "./platform-metrics.js";
import { parsePublicationDate } from "./publication-date.js";

export { parseMetricNumber } from "./metric-number.js";

function publishedTimestamp(value?: string): number | null {
  return parsePublicationDate(value)?.timestamp ?? null;
}

export interface AccountWorkDatum {
  work: SocialWorkVO;
  index: number;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  favorites: number | null;
  interactions: number;
  hasInteractionData: boolean;
  engagementRate: number | null;
  publishedAtMs: number | null;
  score: number;
}

export interface AccountSnapshot {
  works: AccountWorkDatum[];
  rankedWorks: AccountWorkDatum[];
  rankingLabel: "播放" | "互动" | "平台顺序";
  maxScore: number;
  sampleCount: number;
  measuredViews: number;
  totalViews: number | null;
  averageViews: number | null;
  medianViews: number | null;
  medianEngagementRate: number | null;
  highPerformanceRate: number | null;
  topPerformanceMultiple: number | null;
  totalInteractions: number;
  measuredInteractions: number;
  averageInteractions: number | null;
  engagementRate: number | null;
  viewToFollowerRate: number | null;
  topConcentration: number | null;
  measuredPublished: number;
  publishSpanDays: number | null;
  postsPerWeek: number | null;
  firstPublishedAt: number | null;
  lastPublishedAt: number | null;
  interactionParts: Array<{
    key: keyof SocialMetricVO;
    label: string;
    value: number;
    measured: number;
  }>;
}

export function buildAccountSnapshot(result: SocialInspectVO): AccountSnapshot {
  const followers = parseMetricNumber(result.profile?.followers);
  const works = result.works.map((work, index): AccountWorkDatum => {
    const views = parseMetricNumber(work.stats.play);
    const rawLikes = parseMetricNumber(work.stats.like);
    const rawComments = parseMetricNumber(work.stats.comment);
    const rawShares = parseMetricNumber(work.stats.share);
    const rawFavorites = parseMetricNumber(work.stats.favorite);
    const measured = platformMetrics(result.platform).filter((item) => item.interaction).map((item) => parseMetricNumber(work.stats[item.key]));
    const interactions = measured.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const hasInteractionData = measured.some((value) => value !== null);
    return {
      work,
      index,
      views,
      likes: rawLikes,
      comments: rawComments,
      shares: rawShares,
      favorites: rawFavorites,
      interactions,
      hasInteractionData,
      engagementRate: views && views > 0 && hasInteractionData ? (interactions / views) * 100 : null,
      publishedAtMs: publishedTimestamp(work.publishedAt),
      score: 0,
    };
  });
  const viewValues = works.flatMap((item) => item.views === null ? [] : [item.views]);
  const totalViews = viewValues.length ? viewValues.reduce((sum, value) => sum + value, 0) : null;
  const totalInteractions = works.reduce((sum, item) => sum + item.interactions, 0);
  const measuredInteractions = works.filter((item) => item.hasInteractionData).length;
  // 互动率的分子只计入同时具有播放数据的作品；否则「有互动、无播放」的脏
  // 样本会被错误除进另一批作品的播放量，得到虚高的百分比。
  const engagementWorks = works.filter((item) => item.views !== null && item.views > 0 && item.hasInteractionData);
  const engagementViews = engagementWorks.reduce((sum, item) => sum + (item.views ?? 0), 0);
  const interactionsWithMeasuredViews = engagementWorks.reduce(
    (sum, item) => sum + item.interactions,
    0,
  );
  const rankingByViews = viewValues.some((value) => value > 0);
  const rankingByInteractions = !rankingByViews && totalInteractions > 0;
  for (const item of works) item.score = rankingByViews ? item.views ?? 0 : rankingByInteractions ? item.interactions : 0;
  const rankedWorks = [...works].sort((a, b) => b.score - a.score || a.index - b.index);
  const sortedViews = [...viewValues].sort((a, b) => a - b);
  const midpoint = Math.floor(sortedViews.length / 2);
  const medianViews = sortedViews.length
    ? sortedViews.length % 2
      ? sortedViews[midpoint]
      : (sortedViews[midpoint - 1] + sortedViews[midpoint]) / 2
    : null;
  const engagementRates = works.flatMap((item) => item.engagementRate === null ? [] : [item.engagementRate]).sort((a, b) => a - b);
  const engagementMidpoint = Math.floor(engagementRates.length / 2);
  const medianEngagementRate = engagementRates.length
    ? engagementRates.length % 2
      ? engagementRates[engagementMidpoint]
      : (engagementRates[engagementMidpoint - 1] + engagementRates[engagementMidpoint]) / 2
    : null;
  const timestamps = works.flatMap((item) => {
    const value = publishedTimestamp(item.work.publishedAt);
    return value === null ? [] : [value];
  }).sort((a, b) => a - b);
  const firstPublishedAt = timestamps[0] ?? null;
  const lastPublishedAt = timestamps.at(-1) ?? null;
  const publishSpanDays = firstPublishedAt !== null && lastPublishedAt !== null && timestamps.length > 1
    ? Math.max(1, (lastPublishedAt - firstPublishedAt) / 86_400_000 + 1)
    : null;
  const averageViews = totalViews === null ? null : totalViews / viewValues.length;
  return {
    works,
    rankedWorks,
    rankingLabel: rankingByViews ? "播放" : rankingByInteractions ? "互动" : "平台顺序",
    maxScore: Math.max(0, ...works.map((item) => item.score)),
    sampleCount: works.length,
    measuredViews: viewValues.length,
    totalViews,
    averageViews,
    medianViews,
    medianEngagementRate,
    highPerformanceRate: medianViews && medianViews > 0 && viewValues.length > 1
      ? (viewValues.filter((value) => value >= medianViews * 2).length / viewValues.length) * 100
      : null,
    topPerformanceMultiple: medianViews && medianViews > 0 && viewValues.length > 1
      ? Math.max(...viewValues) / medianViews
      : null,
    totalInteractions,
    measuredInteractions,
    averageInteractions: measuredInteractions ? totalInteractions / measuredInteractions : null,
    engagementRate: engagementViews > 0 ? (interactionsWithMeasuredViews / engagementViews) * 100 : null,
    viewToFollowerRate: averageViews !== null && followers && followers > 0 ? (averageViews / followers) * 100 : null,
    topConcentration: viewValues.length > 1 && totalViews && totalViews > 0 && rankedWorks[0]?.views != null
      ? ((rankedWorks[0].views ?? 0) / totalViews) * 100
      : null,
    measuredPublished: timestamps.length,
    publishSpanDays,
    postsPerWeek: publishSpanDays ? (timestamps.length / publishSpanDays) * 7 : null,
    firstPublishedAt,
    lastPublishedAt,
    interactionParts: platformMetrics(result.platform).filter((part) => part.interaction).map((part) => ({
      key: part.key, label: part.label,
      value: works.reduce((sum, item) => sum + (parseMetricNumber(item.work.stats[part.key]) ?? 0), 0),
      measured: works.filter((item) => parseMetricNumber(item.work.stats[part.key]) !== null).length,
    })),
  };
}

/** Visual summaries use the same snapshot as the report and history replay. */
export function buildAccountFeatures(snapshot: AccountSnapshot) {
  const comparable = snapshot.measuredViews > 1 && snapshot.medianViews !== null && snapshot.medianViews > 0;
  const bands = [
    { key: "high", label: "高于日常", rule: "≥ 2× 中位播放", count: 0 },
    { key: "regular", label: "日常区间", rule: "0.6–2× 中位播放", count: 0 },
    { key: "low", label: "低于日常", rule: "< 0.6× 中位播放", count: 0 },
  ];
  if (comparable) {
    for (const item of snapshot.works) {
      if (item.views === null) continue;
      const multiple = item.views / snapshot.medianViews!;
      bands[multiple >= 2 ? 0 : multiple >= .6 ? 1 : 2].count += 1;
    }
  }

  const timing = Array.from({ length: 6 }, (_, slot) =>
    Array.from({ length: 7 }, (_, day) => ({ slot, day, count: 0 })),
  );
  let timedSamples = 0;
  for (const item of snapshot.works) {
    // A date without a time is not a midnight publication. Leave it out.
    if (!parsePublicationDate(item.work.publishedAt)?.hasTime || item.publishedAtMs === null) continue;
    const date = new Date(item.publishedAtMs);
    const day = (date.getDay() + 6) % 7;
    const slot = Math.floor(date.getHours() / 4);
    timing[slot][day].count += 1;
    timedSamples += 1;
  }
  const maxTimingCount = Math.max(0, ...timing.flat().map((cell) => cell.count));
  const completeInteractionSamples = snapshot.works.filter((item) =>
    snapshot.interactionParts.every((part) => parseMetricNumber(item.work.stats[part.key]) !== null),
  ).length;
  const top = snapshot.rankedWorks[0] ?? null;
  const headline = !comparable ? "样本还在积累，先了解已有作品"
    : snapshot.topConcentration !== null && snapshot.topConcentration >= 50 ? "播放表现集中在头部作品"
    : snapshot.topPerformanceMultiple !== null && snapshot.topPerformanceMultiple >= 2 ? "部分作品明显高于日常表现"
    : "头部作品与日常表现接近";
  const takeaway = !comparable
    ? "获得至少两条有播放量、且中位播放大于零的作品后，可比较表现差异。"
    : snapshot.topConcentration !== null && snapshot.topConcentration >= 50
      ? `播放最高的一条贡献了本次样本 ${snapshot.topConcentration.toFixed(1)}% 的播放，值得优先对照它的选题、标题与开场。`
      : bands[0].count > 0
        ? `${bands[0].count} 条作品达到日常中位播放的两倍以上，可以对比这些作品的共同点。`
        : "当前样本没有达到中位播放两倍的作品，可以从表现靠前的作品寻找小幅优化方向。";

  return { comparable, bands, timing, timedSamples, maxTimingCount, completeInteractionSamples, headline, takeaway, top };
}
