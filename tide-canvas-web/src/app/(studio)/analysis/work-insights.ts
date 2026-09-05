import type { SocialWorkVO, SocialPlatform, SocialMetricVO } from "@/lib/social-analysis-api";
import { parseMetricNumber } from "./metric-number.js";
import { platformMetrics } from "./platform-metrics.js";

export interface WorkInteractionPart {
  key: keyof SocialMetricVO;
  label: string;
  value: number | null;
  rate: number | null;
}

export interface WorkSnapshot {
  views: number | null;
  interactions: number | null;
  engagementRate: number | null;
  measuredFields: number;
  interactionParts: WorkInteractionPart[];
}

// A work snapshot is a factual view of the counters returned by the platform.
// Missing counters stay null instead of silently becoming zero.
export function buildWorkSnapshot(work: SocialWorkVO, platform: SocialPlatform | undefined = work.platform): WorkSnapshot {
  const views = parseMetricNumber(work.stats.play);
  const parts: WorkInteractionPart[] = platformMetrics(platform).filter((item) => item.interaction)
    .map((item) => ({ key: item.key, label: item.label, value: parseMetricNumber(work.stats[item.key]), rate: null }));
  const measured = parts.filter((item) => item.value !== null);
  const interactions = measured.length
    ? measured.reduce((sum, item) => sum + (item.value ?? 0), 0)
    : null;
  for (const item of parts) {
    item.rate = item.value !== null && views !== null && views > 0
      ? (item.value / views) * 100
      : null;
  }
  return {
    views,
    interactions,
    engagementRate: interactions !== null && views !== null && views > 0
      ? (interactions / views) * 100
      : null,
    measuredFields: measured.length,
    interactionParts: parts,
  };
}
