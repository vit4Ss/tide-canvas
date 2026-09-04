import type { SocialInspectVO, SocialWorkVO } from "@/lib/social-analysis-api";
import { parseMetricNumber } from "./metric-number.js";

export { parseMetricNumber } from "./metric-number.js";

function publishedTimestamp(value?: string): number | null {
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.valueOf();
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
    key: "like" | "comment" | "share" | "favorite";
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
    const interactions = (rawLikes ?? 0) + (rawComments ?? 0) + (rawShares ?? 0) + (rawFavorites ?? 0);
    const hasInteractionData = [rawLikes, rawComments, rawShares, rawFavorites].some((value) => value !== null);
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
    interactionParts: [
      {
        key: "like",
        label: "点赞",
        value: works.reduce((sum, item) => sum + (item.likes ?? 0), 0),
        measured: works.filter((item) => item.likes !== null).length,
      },
      {
        key: "comment",
        label: "评论",
        value: works.reduce((sum, item) => sum + (item.comments ?? 0), 0),
        measured: works.filter((item) => item.comments !== null).length,
      },
      {
        key: "share",
        label: "分享",
        value: works.reduce((sum, item) => sum + (item.shares ?? 0), 0),
        measured: works.filter((item) => item.shares !== null).length,
      },
      {
        key: "favorite",
        label: "收藏",
        value: works.reduce((sum, item) => sum + (item.favorites ?? 0), 0),
        measured: works.filter((item) => item.favorites !== null).length,
      },
    ],
  };
}
