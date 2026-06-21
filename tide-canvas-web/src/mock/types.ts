// Shared TypeScript interfaces for the liuguang mock data.
//
// The design (design-ref/liuguang/*) is 100% mock. Pages import these typed
// modules now and swap to the real API later. Covers/avatars are stored as raw
// hue triplets (`MeshHues`); pages derive the CSS gradient at render time via
// `mesh()` from "@/lib/mesh" — gradient strings are NOT hardcoded here.

import type { MeshHues } from "./cover";

export type { MeshHues };

/* ── Artworks (作品广场 feed) ────────────────────────────────────────────── */

export type ArtworkType = "image" | "video";

/** Liuguang category labels (Chinese, as authored in the design). */
export type ArtworkCategory =
  | "插画"
  | "动漫"
  | "摄影"
  | "3D"
  | "人像"
  | "科幻"
  | "国风"
  | "设计"
  | "视频";

export interface Artwork {
  /** Stable id (a1, a2, …). */
  id: string;
  /** Raw hue triplet for the mesh cover; derive CSS via mesh(...cover). */
  cover: MeshHues;
  /** Relative tile height — drives masonry rhythm. */
  h: number;
  type: ArtworkType;
  cat: ArtworkCategory;
  model: string;
  title: string;
  author: string;
  likes: number;
  /** Generation params (present on the richer app/data.jsx feed). */
  prompt?: string;
  negPrompt?: string;
  steps?: number;
  sampler?: string;
  cfgScale?: number;
  size?: string;
  /** English title, available on the richer feed. */
  titleEn?: string;
}

/* ── Model marketplace (模型市场) ───────────────────────────────────────── */

export type ModelBadge = "hot" | "new" | null;

export interface MarketModel {
  /** Raw hue triplet for the mesh cover. */
  cover: MeshHues;
  name: string;
  /** Base model family — SDXL | Flux | ... (used by base filter). */
  base: string;
  /** Total runs (compact-format with fmt() at render). */
  runs: number;
  ver: string;
  tags: string[];
  badge: ModelBadge;
}

/* ── Home page sections ─────────────────────────────────────────────────── */

/** Capability bento tile. size: "big" | "wide" | "" (default). */
export interface Cap {
  /** Title. */
  t: string;
  /** Description. */
  d: string;
  /** Glyph icon. */
  ico: string;
  size: "big" | "wide" | "";
  /** Raw hue triplet for the cover. */
  cover: MeshHues;
}

/** "How it works" step. */
export interface Step {
  ico: string;
  t: string;
  d: string;
}

/** Featured creator. */
export interface Creator {
  name: string;
  tag: string;
  works: number;
  /** Raw hue triplet for the avatar. */
  cover: MeshHues;
}

/** Testimonial / social proof card. */
export interface Testimonial {
  /** Quote. */
  q: string;
  name: string;
  role: string;
  /** Star rating 1–5. */
  stars: number;
  /** Raw hue triplet for the avatar. */
  cover: MeshHues;
}

/** FAQ item (question + answer). */
export interface Faq {
  q: string;
  a: string;
}

/* ── Pricing (定价) ─────────────────────────────────────────────────────── */

export interface Plan {
  name: string;
  desc: string;
  /** Monthly price (CNY). */
  mo: number;
  /** Yearly price per-month (CNY). */
  yr: number;
  /** CTA label. */
  cta: string;
  /** Featured / most-popular plan. */
  feat: boolean;
  items: string[];
}

/**
 * One comparison-table row. Index 0 is the capability label; the remaining
 * entries align to the plan columns (体验版 / 创作者 Pro / 企业版).
 */
export type ComparisonRow = [
  label: string,
  free: string,
  pro: string,
  enterprise: string,
];
