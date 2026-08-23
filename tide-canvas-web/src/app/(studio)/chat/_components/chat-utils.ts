/* ============================================================================
   /chat — shared constants, types and pure helpers.

   Extracted verbatim from page.tsx (structure-only refactor): the composer
   chip label maps, the reference-media policy/types, small pure helpers, and
   the lightbox item types. No behavior changes.
   ========================================================================== */

import { resolveModelSwatch } from "@/lib/model-brand";
import type { MusicParams } from "@/lib/music-modes";

/* ── composer chips: model + options come from 模型管理 config (studio-models). ── */

/** config mode value → Chinese label for the 模式 chip. */
export const MODE_LABEL: Record<string, string> = {
  t2i: "文生图",
  i2i: "图生图",
  t2v: "文生视频",
  i2v: "图生视频",
  keyframe: "首尾帧",
  omni_ref: "全能参考",
  t2a: "音乐生成",
  sfx: "音效生成",
};

/** config mode value → one-line hint shown in the 模式 dropdown. */
export const MODE_HINT: Record<string, string> = {
  t2i: "文字生成图片",
  i2i: "参考图生成图片",
  t2v: "文字生成视频",
  i2v: "参考图生成视频",
  keyframe: "首尾帧生成视频",
  omni_ref: "多参考生成视频",
  t2a: "文字生成音乐",
  sfx: "文字生成音效",
};

/** 画质档位文案（与创作台 create-studio.tsx / 画布 quality-ratio.ts 同一套措辞）。 */
export const QUALITY_LABEL: Record<string, string> = { low: "低画质", medium: "标准画质", high: "高画质" };

/** 音乐创作模式 → 下拉里的一句话说明（与创作台四模式语义一致）。 */
export const MUSIC_MODE_HINT: Record<string, string> = {
  inspire: "只写描述，Suno 自动写词",
  custom: "按你填写的歌词演唱",
  extend: "从原曲结尾继续延长",
  cover: "以新的风格翻唱原曲",
};

/** 音乐自定义/延长/翻唱在描述留空时的用户气泡兜底文案。 */
export function musicTurnSummary(p: MusicParams): string {
  if (p.musicMode === "custom") {
    const t = p.songTitle.trim() || p.lyrics.trim().split("\n")[0]?.slice(0, 30) || "";
    return t ? `自定义歌词 · ${t}` : "自定义歌词生成";
  }
  return p.musicMode === "extend" ? "延长原曲" : "翻唱原曲";
}

/** swatch 样式+字形：后台配置 icon > 品牌官方 logo（自动匹配）> 首字母渐变。
 *  与创作台共用 model-brand.ts 的 resolveModelSwatch，保证两处选择器不漂移。 */
export function swatchOf(m?: {
  name: string;
  modelKey?: string;
  config?: { icon?: string } | null;
}): { style: React.CSSProperties; glyph: string } {
  return resolveModelSwatch({ name: m?.name || "", modelKey: m?.modelKey, icon: m?.config?.icon });
}
export function typeTag(type: string): string {
  return type === "video" ? "VID" : type === "audio" ? "AUD" : type === "text" ? "TXT" : "IMG";
}

/* ── reference media (P2: 文件参考) ──────────────────────────────────────────── */

export type RefKind = "image" | "video" | "audio" | "file";

/** A composer reference: local blob preview while uploading, hosted url after. */
export interface RefItem {
  key: string; // stable local key (race-guard + revoke)
  id?: string; // owned File id when the reference came from upload storage
  kind: RefKind;
  blobUrl: string; // local object URL for instant preview
  url?: string; // hosted URL after upload (sent to the backend)
  name?: string; // 原始文件名(预览标题用)
  uploading: boolean;
  failed?: boolean;
}

/** A reference policy: which kinds, how many, and (optional) per-file size cap. */
export interface RefPolicy {
  kinds: RefKind[];
  max: number;
  /** per-file size limit in MB (0 / undefined = unlimited). */
  maxSizeMB?: number;
  /** allowed file extensions (lowercase, no dot); undefined/empty = any. */
  exts?: string[];
  /** file-picker accept attribute; undefined = no restriction. */
  accept?: string;
}

/** Which reference kinds + how many a given generation mode accepts. Modes not
 *  listed (t2i / t2v) take no reference media. */
export const REF_POLICY: Record<string, RefPolicy> = {
  i2i: { kinds: ["image"], max: 6 },
  i2v: { kinds: ["image"], max: 1 },
  keyframe: { kinds: ["image"], max: 2 },
  omni_ref: { kinds: ["image", "video", "audio"], max: 6 },
};

/** Hard cap on attachments per message — mirrors the backend DTO validation. */
export const MAX_ATTACHMENTS = 12;

/** Classify a File into a reference kind by MIME type. Non-media files
 *  (doc/xlsx/pdf/zip …) are "file" — media-only modes将其过滤掉。 */
export function fileKind(file: File): RefKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return "file";
}

/** The accept attribute for a media mode's file picker. */
export function acceptFor(kinds: RefKind[]): string {
  return kinds.filter((k) => k !== "file").map((k) => `${k}/*`).join(",");
}

/** Lowercased filename extension without the dot ("" when absent). */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Normalize an admin-configured format list (lowercase, strip dots, dedup);
 *  undefined when empty → 不限制. */
export function normalizeFormats(raw?: string[]): string[] | undefined {
  if (!raw?.length) return undefined;
  const out = Array.from(new Set(raw.map((f) => f.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)));
  return out.length ? out : undefined;
}

/* ── lightbox (P5) ─────────────────────────────────────────────────────────── */

/** Lightbox state: a set of media items with a current index. kind 决定预览方式:
    图片→img、视频→video、音频→audio 播放器、文件→内嵌预览 + 下载兜底。 */
export type LightboxKind = "image" | "video" | "audio" | "doc";
export type LightboxItem = { url: string; kind: LightboxKind; name?: string };

/** 文件名(取 URL 末段,去查询串;解码失败回退原串)——文件预览标题用。 */
export function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url, "http://x").pathname;
    return decodeURIComponent(path.split("/").pop() || "") || "文件";
  } catch {
    return "文件";
  }
}

/** 可内嵌预览(iframe)的文档扩展名;其余只给下载。 */
export function isInlineDoc(url: string): boolean {
  return /\.(pdf|txt|md|csv|json|log|html?)($|\?)/i.test(url);
}
