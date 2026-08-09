// Artwork display model — the shared shape of site feed tiles / modals
// (作品广场 masonry、首页 coverflow、作者主页网格共用；由 work-tile 的
// toArtwork() 从后端 PostVO 适配而来)。
//
// Covers/avatars are raw hue triplets (`MeshHues`); pages derive the CSS
// gradient at render time via `mesh()` from "@/lib/mesh" — gradient strings
// are NOT hardcoded on the record.

import type { MeshHues } from "@/lib/mesh";

export type { MeshHues };

export type ArtworkType = "image" | "video" | "audio" | "3d";

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
  /** Stable id. */
  id: string;
  /** Raw hue triplet for the mesh cover; derive CSS via mesh(...cover). */
  cover: MeshHues;
  /** Real result image URL; when set it overrides the mesh cover. */
  src?: string;
  /** Relative tile height — drives masonry rhythm. */
  h: number;
  type: ArtworkType;
  cat: ArtworkCategory;
  model: string;
  title: string;
  author: string;
  likes: number;
  /** Generation params (optional, shown in detail views). */
  prompt?: string;
  negPrompt?: string;
  steps?: number;
  sampler?: string;
  cfgScale?: number;
  size?: string;
  /** English title, when available. */
  titleEn?: string;
}
