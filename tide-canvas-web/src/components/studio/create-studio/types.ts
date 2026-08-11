/* 创作台 CreateStudio 的共享类型 — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   ArtworkType / MeshHues 与全局规范类型同形，统一从规范位置再导出
   （@/types/artwork 的 ArtworkType；@/lib/mesh 的 MeshHues，经 artwork 转出口）。 */

import type { ArtworkType, MeshHues } from "@/types/artwork";

export type { ArtworkType, MeshHues };

export type ToolKey =
  | "t2i" | "i2i" | "edit"
  | "t2v" | "i2v" | "flf" | "ref"
  | "t2a" | "sfx"
  | "t2_3d" | "i2_3d" | "mv2_3d";
export type ToolMode = "t2i" | "i2i" | "t2v" | "t2a" | "t2_3d";

export interface ToolCfg {
  mode: ToolMode;
  label: string;
  head: string;
  drop: boolean;
  ph: string;
}

/* typed reference uploads per tool (create.js UPLOADS) */
export type SlotType = "image" | "video" | "audio";
export interface SlotDef {
  k: string;
  label: string;
  type: SlotType;
  max: number;
  hint: string;
}

export interface ModelMeta {
  tag: string;
  by: string;
  desc: string;
}

/* ── upload-file model ────────────────────────────────────────────────────── */

export interface UploadFile {
  g?: string; // thumbnail: a CSS gradient (mock) OR a real image URL (上传中=本地 blob 预览)
  n: string; // name
  s?: string; // size label (image)
  d?: string; // duration label (video/audio)
  url?: string; // real asset URL (local upload / 资产库) sent to the backend as a reference
  key?: string; // 稳定标识:上传中占位→完成/失败的定位;缺省回退 url/name
  uploading?: boolean; // 本地上传进行中(还没拿到 url)
  progress?: number; // 上传进度 0–100(uploading 时展示)
}

export type SlotData = Record<string, UploadFile[]>;

export type ThreeDViewType =
  | "front" | "left" | "right" | "back"
  | "top" | "bottom" | "left_front" | "right_front";

export interface ThreeDViewImage {
  viewType: ThreeDViewType;
  viewImageUrl: string;
}

export interface ThreeDAsset {
  type: string;
  url: string;
  previewImageUrl?: string;
}

/* ── result / history models (hue triplets back the mesh placeholders) ───── */

export interface ResultCell {
  i: number;
  /** hue triplet → mesh() for the loading-placeholder background. */
  hues: MeshHues;
  /** real result image URL (real generations); when set it replaces the mesh placeholder. */
  url?: string;
}

export interface HistItem {
  id: string;
  /** run/task group key — every image of one generation shares it (feed grouping). */
  run: string;
  /** ISO timestamp of the run (for the feed header). */
  ts?: string;
  /** aspect ratio of the run (e.g. "16:9"), used to size loading placeholders. */
  ratio?: string;
  hues: MeshHues;
  type: ArtworkType;
  title: string;
  prompt: string;
  model: string;
  /** real result image URL (real generations). */
  url?: string;
  /** 3D generation keeps every returned format on one history card. */
  assets?: ThreeDAsset[];
  previewImageUrl?: string;
  /** Suno 分轨：clip_id 供延长/翻唱引用；trackTitle 是 Suno 起的歌名。 */
  clipId?: string;
  /** 该任务是「上传登记」(extras.task=upload):其 clip 延长时须发 upload_extend */
  clipUpload?: boolean;
  trackTitle?: string;
  /** Suno 歌曲封面（上游生成）与时长(秒)，SongCard 歌曲行展示用。 */
  trackCover?: string;
  trackDur?: number;
  /** reconstructed run settings (for restoring this result to the panel). */
  params?: RunParams;
}

/** One generation run = a feed block (header + a row of its result images). */
export interface HistRun {
  run: string;
  ts?: string;
  ratio?: string;
  title: string;
  prompt: string;
  model: string;
  type: ArtworkType;
  params?: RunParams;
  items: HistItem[];
}

export interface RunMeta {
  prompt: string;
  model: string;
  ratio: string;
  spec: string;
  count: number;
  label: string;
  isVid: boolean;
  /** 媒体类型；缺省时按 isVid 推导（兼容旧持久化数据），audio 由此区分 */
  kind?: ArtworkType;
  refThumbs: string[];
  /** Captured inputs used to restore read-only reference pills in the feed. */
  params?: RunParams;
}

/** One visible in-flight generation. Each backend task owns its own progress
 * cells so concurrent submissions never overwrite one another in the feed. */
export interface InflightRun {
  taskId: string;
  /** Captured before the paid POST; used for stable newest-first feed order. */
  startedAt: number;
  /** "submitting" is the optimistic card shown before the server returns a task id. */
  phase?: "submitting" | "processing";
  clientRequestId?: string;
  meta: RunMeta;
  cells: ResultCell[];
  progs: number[];
}

/** A backend generation in flight, persisted so a page refresh can resume it
 *  (the task keeps running server-side). Stored under ACTIVE_RUN_KEY. */
export interface ActiveRun {
  taskId: string; // 后端雪花 ID 序列化为字符串
  /** Confirmed account that owns the task and its recovery storage partition. */
  ownerUserId: string;
  /** Accepted-create journal to commit after ACTIVE_RUN_KEY is verified. */
  journalScope?: string;
  prompt: string;
  model: string;
  ratio: string;
  spec: string;
  count: number;
  isVid: boolean;
  /** 媒体类型；缺省按 isVid 推导（旧快照兼容），audio 由此区分 */
  kind?: ArtworkType;
  label: string;
  hues: MeshHues[];
  refThumbs: string[];
  /** Exact panel settings for this task; required when several runs overlap. */
  params?: RunParams;
  startedAt: number;
}

/** Full panel settings of a generation, captured so 重新编辑 / 再次生成 can restore
 *  or reproduce that exact run rather than whatever the panel currently shows. */
export interface RunParams {
  prompt: string;
  model: string;
  /** Stable catalog row id. Older history may only have the display name. */
  modelId?: string;
  tool: ToolKey;
  curType: ArtworkType;
  ratio: string;
  imgRes: string;
  res: string;
  dur: string;
  quality: string;
  count: number;
  /** 该轮使用的预设技能快照。刷新后的历史至少能从任务 input 恢复 id，
   *  title 会在重新编辑/再次生成前通过公开 API 拉取当前已发布版本补齐。 */
  skill?: { id: string; title?: string };
  /** 参考素材 URL（可选）：slotData 本身不持久化，刷新后靠这些字段把上传槽位
   *  一并恢复，否则 i2i/i2v 的「编辑/重新生成」会卡在“请先上传参考图片”。 */
  imageRefs?: string[];
  firstFrame?: string;
  lastFrame?: string;
  videoRefs?: string[];
  audioRefs?: string[];
  /** 混元生 3D 3.1 参数。单图沿用 imageRefs，多视图保留视角语义。 */
  multiViewImages?: ThreeDViewImage[];
  enablePbr?: boolean;
  faceCount?: number;
  generateType?: "Normal" | "Geometry";
  resultFormat?: "" | "STL" | "USDZ" | "FBX";
  /** 音频（Suno）：自定义模式的歌词/风格/歌名与纯音乐开关 */
  lyrics?: string;
  songStyle?: string;
  songTitle?: string;
  instrumental?: boolean;
  /** 音频（Suno）创作模式与延长/翻唱的原曲引用 */
  musicMode?: MusicMode;
  sourceClipId?: string;
  /** 原曲是上传登记的本地音频(延长须发 upload_extend) */
  sourceIsUpload?: boolean;
  continueAt?: number;
}

/** Suno 音乐创作模式（对齐上游 API：extras.task = extend / cover）。 */
export type MusicMode = "inspire" | "custom" | "extend" | "cover";

/** resultMeta.tracks 的宽松解析（后端 provider_relay 写入的形状）。 */
export type MetaTrack = { clipId: string; title: string; url: string; coverUrl: string; duration: number };
