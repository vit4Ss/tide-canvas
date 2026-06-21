// Cover helpers for the mock data.
//
// Mock entities store only a raw hue triplet (`MeshHues`). Pages derive the CSS
// mesh-gradient at render time. The gradient generator itself lives in
// "@/lib/mesh" (shared, already in the repo) — we re-export it here so mock
// consumers have one import surface and never hardcode gradient strings.

import { mesh } from "@/lib/mesh";

/** Raw hue triplet [h1, h2, h3] stored on every cover/avatar. */
export type MeshHues = [h1: number, h2: number, h3: number];

/** Build the CSS `background` value from a stored hue triplet. */
export function coverBg(hues: MeshHues): string {
  return mesh(hues[0], hues[1], hues[2]);
}

/** Re-export the raw generator for callers that have loose hue args. */
export { mesh };

/**
 * Compact count formatter used by feeds/cards:
 * 4820 -> "4.8k", 12400 -> "12k", 980 -> "980".
 * Ported from the design's `fmt`.
 */
export function fmt(n: number): string {
  if (n >= 10000) return (n / 1000).toFixed(0) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return "" + n;
}
