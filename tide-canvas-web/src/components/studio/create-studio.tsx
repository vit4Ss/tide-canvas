"use client";

/* ============================================================================
   创作台 · CreateStudio — React port of design-ref/创作台.html
   (<aside class="ws-panel"> control panel + <main class="ws-stage"> center
   stage + 生成历史 strip) and design-ref/liuguang/create.js.

   Renders ONLY the panel + stage (the (studio) layout owns the ws-rail and
   imports flux/pages/studio.css). Exact liuguang class names are used so the
   already-imported CSS applies unchanged.

   Faithful to the design: type-switched fields (图片 ↔ 视频), 分辨率/清晰度/时长
   pills, typed reference-upload slots (参考图 / 原图 / 首尾帧 / 参考视频·音频) with
   a preview modal, resolution-based cost, a 【风格】 result header and a paginated
   生成历史 strip.

   Generation / AI 优化 are SIMULATED client-side (mock progress intervals →
   mesh-cover result cards) — the real API is a later phase. Covers are stored
   as MeshHues hue triplets so result/history cards can open the shared
   <WorkModal/> (which derives CSS via coverBg()).

   Handoff: reads sessionStorage 'flux_prompt' / 'flux_model' on mount to
   prefill the prompt / model (mirrors create.js + work-modal.tsx).
   ========================================================================== */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Artwork, ArtworkType, MeshHues } from "@/mock";
import { CREATE_MODELS, coverBg, mesh } from "@/mock";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { AiTaskStatus } from "@/types/ai";
import { AssetsBrowser, type PickedAsset } from "@/components/studio/assets-browser";
import { useAuthStore } from "@/stores/use-auth-store";
import WorkModal from "@/components/site/work-modal";
import { toast } from "@/components/shared/toast";
import styles from "@/app/(studio)/studio/create.module.css";

/* ── constants (ported 1:1 from create.js) ───────────────────────────────── */

const RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;
const IMG_RES = ["1K", "2K", "4K"] as const;
const VIDEO_RES = ["720p", "1080p", "4K"] as const;
const VIDEO_DUR = ["5s", "10s", "15s"] as const;

const QUALITY_LABEL: Record<string, string> = { low: "低画质", medium: "标准画质", high: "高画质" };

const IMG_RES_COST: Record<string, number> = { "1K": 8, "2K": 14, "4K": 30 };
const RES_COST: Record<string, number> = { "720p": 30, "1080p": 50, "4K": 90 };
const DUR_SEC: Record<string, number> = { "5s": 5, "10s": 10, "15s": 15 };

const IDEAS = [
  "赛博朋克城市夜景，霓虹倒影，电影感，8K",
  "青绿山水工笔，石青石绿设色，宋代院体",
  "液态金属机器人，纯白工作室布光，C4D 渲染",
  "黄昏侧颜人像，85mm f/1.4，柯达胶片颗粒",
  "深海发光水母，慢镜头，4K 微距，蓝紫光束",
] as const;

type ToolKey = "t2i" | "i2i" | "edit" | "t2v" | "i2v" | "flf" | "ref";
type ToolMode = "t2i" | "i2i" | "t2v";

interface ToolCfg {
  mode: ToolMode;
  label: string;
  head: string;
  drop: boolean;
  ph: string;
}

const TOOLS: Record<ToolKey, ToolCfg> = {
  t2i: { mode: "t2i", label: "文生图", head: "生成图片", drop: false, ph: "描述你想要的画面，越具体越好…\n例：赛博朋克城市夜景，霓虹倒影，电影感，8K 超写实" },
  i2i: { mode: "i2i", label: "图生图", head: "图生图", drop: true, ph: "上传参考图，再描述想要的改动…\n例：保留构图，改成赛博朋克霓虹风格" },
  edit: { mode: "i2i", label: "改图", head: "改图 · 扩图", drop: true, ph: "上传图片，描述要修改或扩展的部分…\n例：把背景扩展为开阔的雪山草原" },
  t2v: { mode: "t2v", label: "文生视频", head: "生成视频", drop: false, ph: "描述镜头与运动…\n例：金色麦田，强风掠过，慢镜头航拍，电影调色" },
  i2v: { mode: "t2v", label: "图生视频", head: "图生视频", drop: true, ph: "上传首帧图片，再描述运动…\n例：人物缓缓回头，发丝随风飘动，电影质感" },
  flf: { mode: "t2v", label: "首尾帧", head: "首尾帧生成", drop: true, ph: "上传首帧与尾帧，描述过渡…\n例：从清晨到日落的平滑时间流逝" },
  ref: { mode: "t2v", label: "全能参考", head: "全能参考", drop: true, ph: "上传参考图（人物 / 风格 / 动作），描述想要的视频…\n例：参考人物形象，生成其在雪山奔跑的镜头" },
};

const MODES_BY_TYPE: Record<ArtworkType, ToolKey[]> = {
  image: ["t2i", "i2i"],
  video: ["t2v", "i2v", "flf", "ref"],
};

/* typed reference uploads per tool (create.js UPLOADS) */
type SlotType = "image" | "video" | "audio";
interface SlotDef {
  k: string;
  label: string;
  type: SlotType;
  max: number;
  hint: string;
}

const UPLOADS: Partial<Record<ToolKey, SlotDef[]>> = {
  i2i: [{ k: "img", label: "参考图片", type: "image", max: 4, hint: "上传图片，作为生成参考" }],
  edit: [{ k: "img", label: "原图", type: "image", max: 1, hint: "上传需要修改 / 扩展的图片" }],
  i2v: [{ k: "first", label: "首帧图片", type: "image", max: 1, hint: "上传作为视频首帧的图片" }],
  flf: [
    { k: "first", label: "首帧", type: "image", max: 1, hint: "上传起始画面" },
    { k: "last", label: "尾帧", type: "image", max: 1, hint: "上传结束画面" },
  ],
  ref: [
    { k: "img", label: "参考图片", type: "image", max: 4, hint: "上传图片（人物 / 风格 / 场景）" },
    { k: "video", label: "参考视频", type: "video", max: 3, hint: "最多 3 段，总时长 ≤ 15 秒。支持 mp4 / mov。" },
    { k: "audio", label: "参考音频", type: "audio", max: 3, hint: "最多 3 段，总时长 ≤ 15 秒。支持 wav / mp3。" },
  ],
};

const SLOT_ICON: Record<SlotType, ReactNode> = {
  image: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5L5 20" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="5" width="13" height="14" rx="2.5" />
      <path d="M16 10l5-3v10l-5-3z" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 24 24">
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </svg>
  ),
};

/* per-result floating toolbar (hover a finished image). The first three load the
   image into a tool's reference slot (作为垫图 / 生成视频 / 精细编辑); the rest are
   one-click edit ops wired to dedicated backend handlers (扩图 / 高清放大 /
   移除背景 / 物体移除). The `real` flag drives styling only — all are functional. */
interface CellTool {
  act: string;
  label: string;
  real: boolean;
  icon: ReactNode;
}
const CELL_TOOLS: CellTool[] = [
  {
    act: "pad",
    label: "作为垫图",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3l8 4-8 4-8-4 8-4z" />
        <path d="M4 12l8 4 8-4" />
        <path d="M4 16.5l8 4 8-4" />
      </svg>
    ),
  },
  {
    act: "video",
    label: "生成视频",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="13" height="14" rx="2.5" />
        <path d="M16 10l5-3v10l-5-3z" />
      </svg>
    ),
  },
  {
    act: "edit",
    label: "精细编辑",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3z" />
        <path d="M13.5 6.5l3 3" />
      </svg>
    ),
  },
  {
    act: "expand",
    label: "扩图",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
      </svg>
    ),
  },
  {
    act: "hd",
    label: "高清放大",
    real: true,
    icon: <span className="hd-glyph">HD</span>,
  },
  {
    act: "rmbg",
    label: "移除背景",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="6" cy="6" r="2.6" />
        <circle cx="6" cy="18" r="2.6" />
        <path d="M8.4 7.6L20 18M8.4 16.4L20 6" />
      </svg>
    ),
  },
  {
    act: "rmobj",
    label: "物体移除",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M5.5 15.5l5-5 5 5-3.5 3.5H9l-3.5-3.5z" />
        <path d="M10.5 10.5l5-5a2 2 0 0 1 3 0l1.5 1.5a2 2 0 0 1 0 3l-5 5" />
        <path d="M8.5 19H20" />
      </svg>
    ),
  },
];

interface ModelMeta {
  tag: string;
  by: string;
  desc: string;
}

const MODEL_META: Record<string, ModelMeta> = {
  "GPT Image 2": { tag: "HD", by: "OpenAI", desc: "万能画风 · 超清细节" },
  "Flux.1 Pro": { tag: "PRO", by: "Black Forest", desc: "写实质感 · 精准构图" },
  "Midjourney v6": { tag: "ART", by: "Midjourney", desc: "艺术氛围 · 电影光影" },
  "Nano Banana 2": { tag: "NEW", by: "Google", desc: "极速出图 · 风格百变" },
  "SDXL Lightning": { tag: "4×", by: "Stability", desc: "秒级生成 · 开源高效" },
  "即梦 3.0": { tag: "CN", by: "字节跳动", desc: "中文语义 · 国风擅长" },
  "Seedance 2.0": { tag: "VID", by: "字节跳动", desc: "视听双绝 · 镜头流畅" },
  "可灵 Kling 1.6": { tag: "VID", by: "快手", desc: "长镜头 · 物理真实" },
};

const DEFAULT_META: ModelMeta = { tag: "AI", by: "模型", desc: "高质量生成" };

/** map a backend AiModelVO.type to a short display tag. */
function typeTag(type: string): string {
  return type === "video"
    ? "VID"
    : type === "audio"
      ? "AUD"
      : type === "text"
        ? "TXT"
        : "IMG";
}

/** derive a ModelMeta for a studio model purely from its model-management config:
 *  the right-side tag prefers 预计耗时, then 消耗积分, then the media-type tag; the
 *  subtitle is the 描述 (or capabilities when no description is set). */
function metaOfStudio(m: StudioModelVO): ModelMeta {
  const c = m.config;
  const est = c?.estSeconds ?? 0;
  const cost = parseFloat(m.pointCost) || 0;
  const tag = est > 0 ? `~${est}s` : cost > 0 ? `${cost} 积分` : typeTag(m.type);
  return {
    tag,
    by: "",
    desc: m.desc || (c?.capabilities?.length ? c.capabilities.join(" · ") : "高质量生成"),
  };
}

/** true when an icon value is an image URL (vs. an emoji / short glyph). */
function isIconUrl(icon: string): boolean {
  return /^(https?:)?\/\//.test(icon) || icon.startsWith("/");
}

/** map a config mode value (t2i/i2i/t2v/i2v/keyframe/omni_ref) to a studio ToolKey. */
const MODE_TO_TOOL: Record<string, ToolKey> = {
  t2i: "t2i",
  i2i: "i2i",
  t2v: "t2v",
  i2v: "i2v",
  keyframe: "flf",
  omni_ref: "ref",
};

/** studio ToolKey → backend generation handler name (internal/handler/ai handlerRegistry). */
const TOOL_TO_HANDLER: Record<ToolKey, string> = {
  t2i: "text_to_image",
  i2i: "image_to_image",
  edit: "image_to_image",
  t2v: "text_to_video",
  i2v: "image_to_video",
  flf: "start_end_to_video",
  ref: "reference_to_video",
};

/** display label for a ratio value (auto → 自适应). */
function ratioLabel(r: string): string {
  return r === "auto" ? "自适应" : r;
}

/** meta lookup by display name, optionally backed by the real models map. */
function metaOf(name: string, metaMap?: Record<string, ModelMeta>): ModelMeta {
  return metaMap?.[name] || MODEL_META[name] || DEFAULT_META;
}

/** deterministic per-model swatch gradient (create.js modelSwatch). */
function modelSwatch(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${(h + 50) % 360} 80% 52%))`;
}

/** first A-Z / CJK char (create.js modelInitial). */
function modelInitial(name: string): string {
  const m = name.replace(/[^A-Za-z一-龥]/g, "");
  return m.charAt(0) || "A";
}

/** stable hue seed from a prompt (create.js generate()). */
function promptHue(prompt: string): number {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) h = (h * 31 + prompt.charCodeAt(i)) % 360;
  return h;
}

/** backend generation handler → media type for 生成历史 cards. */
const HIST_HANDLER_TYPE: Record<string, ArtworkType> = {
  text_to_image: "image",
  image_to_image: "image",
  text_to_video: "video",
  image_to_video: "video",
  start_end_to_video: "video",
  reference_to_video: "video",
  // one-click image-edit ops (per-result toolbar)
  remove_bg: "image",
  remove_object: "image",
  upscale: "image",
  outpaint: "image",
};

/** backend generation handler → studio ToolKey (reverse of TOOL_TO_HANDLER). */
const HIST_HANDLER_TOOL: Record<string, ToolKey> = {
  text_to_image: "t2i",
  image_to_image: "i2i",
  text_to_video: "t2v",
  image_to_video: "i2v",
  start_end_to_video: "flf",
  reference_to_video: "ref",
  // edit ops restore into the 改图 tool (i2i family)
  remove_bg: "edit",
  remove_object: "edit",
  upscale: "edit",
  outpaint: "edit",
};

/** one-click edit op → its backend handler name (per-result toolbar buttons). */
const EDIT_OP_HANDLER: Record<string, string> = {
  rmbg: "remove_bg",
  rmobj: "remove_object",
  hd: "upscale",
  expand: "outpaint",
};

/** parse a stored task input (object or JSON string) into a plain record. */
function parseTaskInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") return input as Record<string, unknown>;
  if (typeof input === "string") {
    try {
      const o = JSON.parse(input || "{}");
      return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** reconstruct the 创作台 RunParams from a task's handler + stored input, so a
 *  history item (or the restored last result) can be re-edited / re-generated. */
function paramsFromTask(handler: string, modelName: string, input: unknown): RunParams {
  const inp = parseTaskInput(input);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v ?? ""), 10) || 0);
  const type: ArtworkType = HIST_HANDLER_TYPE[handler] ?? "image";
  const reso = str(inp.clarity) || str(inp.resolution);
  return {
    prompt: str(inp.prompt),
    model: modelName,
    tool: HIST_HANDLER_TOOL[handler] ?? "t2i",
    curType: type,
    ratio: str(inp.aspectRatio) || str(inp.aspect_ratio) || str(inp.ratio) || "1:1",
    imgRes: type === "image" ? reso || "2K" : "2K",
    res: type === "video" ? reso || "1080p" : "1080p",
    dur: str(inp.duration) || "5s",
    quality: str(inp.quality),
    count: Math.max(1, num(inp.batchCount) || 1),
  };
}

/** deterministic mesh-hue triplet from a string id (cover fallback when no url). */
function huesFromId(id: string): MeshHues {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return [h, (h + 80) % 360, (h + 200) % 360];
}

function isHttpUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//.test(u.trim());
}

/** deterministic reference-thumb gradient (create.js refGrad). */
function refGrad(seed: number): string {
  const h = (seed * 61 + 30) % 360;
  return `linear-gradient(135deg, hsl(${h} 58% 52%), hsl(${(h + 44) % 360} 62% 36%))`;
}

/* ── upload-file model ────────────────────────────────────────────────────── */

interface UploadFile {
  g?: string; // thumbnail: a CSS gradient (mock) OR a real image URL
  n: string; // name
  s?: string; // size label (image)
  d?: string; // duration label (video/audio)
  url?: string; // real asset URL (local upload / 资产库) sent to the backend as a reference
}

/** background value for a slot thumbnail: a real URL → cover image, else the
 *  gradient string is used as-is. */
function thumbBg(g?: string): string {
  if (!g) return "var(--surface-2)";
  return /^(https?:|data:)/.test(g) ? `center / cover no-repeat url("${g}")` : g;
}

type SlotData = Record<string, UploadFile[]>;

/* ── result / history models (carry hue triplets so cards open WorkModal) ── */

interface ResultCell {
  i: number;
  /** hue triplet → coverBg() for the modal, mesh() for the card bg. */
  hues: MeshHues;
  /** real result image URL (real generations); when set it replaces the mesh placeholder. */
  url?: string;
}

interface HistItem {
  id: string;
  hues: MeshHues;
  type: ArtworkType;
  title: string;
  prompt: string;
  model: string;
  /** real result image URL (real generations). */
  url?: string;
  /** reconstructed run settings (for restoring this result to the panel). */
  params?: RunParams;
}

interface RunMeta {
  prompt: string;
  model: string;
  ratio: string;
  spec: string;
  count: number;
  label: string;
  isVid: boolean;
  refThumbs: string[];
}

/** A backend generation in flight, persisted so a page refresh can resume it
 *  (the task keeps running server-side). Stored under ACTIVE_RUN_KEY. */
interface ActiveRun {
  taskId: number;
  prompt: string;
  model: string;
  ratio: string;
  spec: string;
  count: number;
  isVid: boolean;
  label: string;
  hues: MeshHues[];
  refThumbs: string[];
  startedAt: number;
}

const ACTIVE_RUN_KEY = "studio_active_run";

/** Full panel settings of a generation, captured so 重新编辑 / 再次生成 can restore
 *  or reproduce that exact run rather than whatever the panel currently shows. */
interface RunParams {
  prompt: string;
  model: string;
  tool: ToolKey;
  curType: ArtworkType;
  ratio: string;
  imgRes: string;
  res: string;
  dur: string;
  quality: string;
  count: number;
}

let histSeq = 0;
const PAGE_SIZE = 24; // items per page in the workspace history (create.js)

/* ── component ───────────────────────────────────────────────────────────── */

export default function CreateStudio() {
  /* panel state */
  const [curType, setCurType] = useState<ArtworkType>("image");
  const [tool, setTool] = useState<ToolKey>("t2i");
  const [model, setModel] = useState<string>("GPT Image 2");
  const [modelOpen, setModelOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<string>(RATIOS[0]);
  const [count, setCount] = useState(1);
  const [imgRes, setImgRes] = useState<string>("2K");
  const [res, setRes] = useState<string>("1080p");
  const [dur, setDur] = useState<string>("5s");
  const [quality, setQuality] = useState<string>("");

  /* typed reference uploads (per slot key) + preview modal target */
  const [slotData, setSlotData] = useState<SlotData>({});
  const [preview, setPreview] = useState<{ k: string; i: number } | null>(null);
  /* reference-image source flow: 来源选择菜单 / 资产库弹窗 / 本地上传 */
  const [srcMenu, setSrcMenu] = useState<string | null>(null); // slot key whose 来源 menu is open
  const [assetPick, setAssetPick] = useState<string | null>(null); // slot key the asset picker fills
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localTargetRef = useRef<string | null>(null); // slot key awaiting a local file pick

  /* real studio models for the current type (public, no auth), each carrying its
     per-model config; the picker + option pills are derived from this list. */
  const [studioList, setStudioList] = useState<StudioModelVO[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const ensureSession = useAuthStore((s) => s.ensureSession);

  /* stage state */
  const [busy, setBusy] = useState(false);
  const [cells, setCells] = useState<ResultCell[]>([]);
  const [progs, setProgs] = useState<number[]>([]);
  const [doneSet, setDoneSet] = useState<Record<number, boolean>>({});
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  // full settings of the last started run (for 重新编辑 / 再次生成) + a one-shot
  // flag that fires generate() after those settings are restored to the panel.
  const lastRunRef = useRef<RunParams | null>(null);
  // synchronous in-flight latch: `busy` state is set asynchronously (and, for the
  // one-click edit ops, only after a network round-trip), so it cannot prevent a
  // rapid double-click from firing two backend tasks. This ref is flipped true
  // before any await and cleared wherever the run settles (every setBusy(false)).
  const genInFlightRef = useRef(false);
  const [pendingGen, setPendingGen] = useState(false);
  // ensures the stage is seeded with the last past result at most once per mount.
  const stageSeededRef = useRef(false);

  /* history — the user's REAL generation tasks (aiApi.listTasks), newest first.
     Loaded post-mount (see loadHistory); empty until then. No mock seed. */
  const [hist, setHist] = useState<HistItem[]>([]);
  const [histFilter, setHistFilter] = useState<"all" | "image" | "video">("all");
  const [histPage, setHistPage] = useState(1);

  /* shared work-detail modal */
  const [active, setActive] = useState<Artwork | null>(null);
  /* full-image lightbox (click a finished result to zoom) */
  const [lightbox, setLightbox] = useState<string | null>(null);

  const ticksRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // bumped on every reset/cancel so in-flight poll callbacks from a stale run bail out.
  const runIdRef = useRef(0);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  /* ── derived ─────────────────────────────────────────────────────────── */

  const cfg = TOOLS[tool];
  const hasResults = cells.length > 0;
  const isVideo = curType === "video";
  const slots = UPLOADS[tool] ?? null;

  /* ── studio models → picker names/meta + selected model's config ───────── */
  const noBackend = studioList.length === 0;
  const modelNames = useMemo(
    () => (studioList.length ? studioList.map((m) => m.name) : CREATE_MODELS),
    [studioList],
  );
  const modelMeta = useMemo(() => {
    const map: Record<string, ModelMeta> = {};
    for (const m of studioList) map[m.name] = metaOfStudio(m);
    return map;
  }, [studioList]);
  const meta = metaOf(model, modelMeta);

  // icon configured per model (emoji or image URL) for the picker swatch.
  const iconByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of studioList) if (m.config?.icon) map[m.name] = m.config.icon;
    return map;
  }, [studioList]);
  // resolve a swatch's style + glyph: image-URL icon → cover bg; emoji → glyph on
  // the model's gradient; none → initial letter on the gradient.
  const swatchFor = (name: string): { style: CSSProperties; content: string } => {
    const icon = iconByName[name];
    if (icon && isIconUrl(icon)) {
      return { style: { background: `center/cover no-repeat url("${icon}")` }, content: "" };
    }
    return { style: { background: modelSwatch(name) }, content: icon || modelInitial(name) };
  };

  const mCfg = useMemo(
    () => studioList.find((m) => m.name === model)?.config ?? null,
    [studioList, model],
  );

  // dynamic option lists: a model's configured options only; when the backend
  // returned no models at all, fall back to the built-in defaults so the panel
  // is never empty. An empty configured list hides that control entirely.
  const ratioOpts = mCfg?.ratios?.length ? mCfg.ratios : noBackend ? [...RATIOS] : [];
  const resOpts = mCfg?.resolutions?.length
    ? mCfg.resolutions
    : noBackend
      ? isVideo
        ? [...VIDEO_RES]
        : [...IMG_RES]
      : [];
  const durOpts = mCfg?.durations?.length ? mCfg.durations : noBackend ? [...VIDEO_DUR] : [];
  const qualOpts = mCfg?.qualities ?? [];
  const ideaOpts = mCfg?.ideas?.length ? mCfg.ideas : noBackend ? [...IDEAS] : [];
  const batchOpts =
    mCfg?.batchOptions && mCfg.batchOptions.length ? mCfg.batchOptions : [1, 2, 3, 4];
  const batchMin = Math.min(...batchOpts);
  const batchMax = Math.max(...batchOpts);

  // tool/mode tabs: when the model configures modes, show only those; otherwise
  // (or no backend) show all modes for the current type.
  const configuredTools = (mCfg?.modes ?? [])
    .map((m) => MODE_TO_TOOL[m])
    .filter(Boolean) as ToolKey[];
  const modeKeys = configuredTools.length
    ? MODES_BY_TYPE[curType].filter((k) => configuredTools.includes(k))
    : MODES_BY_TYPE[curType];

  // cost (create.js updateCost): video = round(resCost*durSec/5); image = imgResCost*count.
  const cost = isVideo
    ? Math.round(((RES_COST[res] || 50) * (DUR_SEC[dur] || 5)) / 5)
    : (IMG_RES_COST[imgRes] || 14) * count;

  const allDone = hasResults && Object.keys(doneSet).length >= cells.length;

  const filteredHist = useMemo(
    () => (histFilter === "all" ? hist : hist.filter((h) => h.type === histFilter)),
    [hist, histFilter],
  );
  const histPages = Math.max(1, Math.ceil(filteredHist.length / PAGE_SIZE));
  const curPage = Math.min(histPage, histPages);
  const pageItems = filteredHist.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);


  /* ── prompt / model handoff (mount) ──────────────────────────────────── */

  useEffect(() => {
    // accept a prompt / model handoff from "生成同款" (create.js + work-modal),
    // and an asset handoff from the 资产库 preview (作为垫图 / 生成视频 / 精细编辑).
    // Reading sessionStorage is an external-system read that can only run on the
    // client post-mount (avoids a hydration mismatch from a lazy initializer),
    // so setting state here is the intended pattern despite the lint heuristic.
    try {
      // asset handoff: load a picked image into the matching tool's slot.
      const rawAsset = sessionStorage.getItem("studio_use_asset");
      if (rawAsset) {
        sessionStorage.removeItem("studio_use_asset");
        try {
          const { url, op } = JSON.parse(rawAsset) as { url?: string; op?: string };
          const route: Record<string, [ArtworkType, ToolKey, string, string]> = {
            pad: ["image", "i2i", "img", "已作为垫图载入图生图 · 描述想要的改动"],
            video: ["video", "i2v", "first", "已载入图生视频首帧 · 描述运动"],
            edit: ["image", "edit", "img", "已载入改图 · 描述要精修的部分"],
          };
          const r = route[op || "pad"] || route.pad;
          if (url) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setCurType(r[0]);
            setTool(r[1]);
            setSlotData({ [r[2]]: [{ g: url, url, n: "垫图", s: "" }] });
            toast.success(r[3]);
          }
        } catch {
          /* malformed handoff */
        }
      }

      const p = sessionStorage.getItem("flux_prompt");
      const m = sessionStorage.getItem("flux_model");
      if (!p && !m) return;
      if (p) {
        setPrompt(p);
        sessionStorage.removeItem("flux_prompt");
      }
      if (m) {
        setModel(m);
        sessionStorage.removeItem("flux_model");
      }
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, []);

  // load the studio models for the current type (public endpoint). Each carries
  // its per-model config; the picker + option pills derive from this list. On
  // empty/failure the built-in fallback lists keep the panel usable. Selection is
  // preserved if the chosen model still exists (so a refetch never resets it).
  const reloadModels = useCallback(async () => {
    try {
      const res = await marketApi.studioModels(curType);
      const list = res.success && Array.isArray(res.data) ? res.data : [];
      setStudioList(list);
      if (list.length) {
        const names = list.map((m) => m.name);
        setModel((cur) => (names.includes(cur) ? cur : names[0]));
      }
    } catch {
      setStudioList([]);
    }
  }, [curType]);

  useEffect(() => {
    reloadModels();
  }, [reloadModels]);

  // 生成历史: load the user's REAL generation tasks (persisted server-side). Each
  // SUCCESS task with a result URL becomes a card; a batch task (resultMeta.urls)
  // expands into one card per image. No mock seed — survives refresh.
  const loadHistory = useCallback(async () => {
    try {
      await ensureSession();
      const res = await aiApi.listTasks({ pageNum: 1, pageSize: 100 });
      const records = res.success && res.data ? res.data.records : [];
      const items: HistItem[] = [];
      for (const t of records) {
        let urls: string[] = [];
        const meta =
          typeof t.resultMeta === "string"
            ? (() => {
                try {
                  return JSON.parse(t.resultMeta || "{}");
                } catch {
                  return {};
                }
              })()
            : t.resultMeta;
        const rawUrls = (meta as { urls?: unknown })?.urls;
        if (Array.isArray(rawUrls)) urls = rawUrls.filter(isHttpUrl);
        if (!urls.length && isHttpUrl(t.resultUrl)) urls = [t.resultUrl];
        if (!urls.length) continue; // skip failed / urlless tasks (real data only)

        const type = HIST_HANDLER_TYPE[t.handler] ?? "image";
        const params = paramsFromTask(t.handler, t.modelName || "", t.input);
        const title = params.prompt
          ? params.prompt.slice(0, 14) + (params.prompt.length > 14 ? "…" : "")
          : t.modelName || "我的创作";
        urls.forEach((url, idx) =>
          items.push({
            id: `task-${t.id}-${idx}`,
            hues: huesFromId(`${t.id}-${idx}`),
            type,
            title,
            prompt: params.prompt,
            model: t.modelName || "",
            url,
            params,
          }),
        );
      }
      setHist(items);

      // First load only: if the user has past results and nothing is currently
      // generating / being resumed, show their most recent image in the stage
      // instead of the empty default state. First-time users keep the default.
      if (!stageSeededRef.current) {
        stageSeededRef.current = true; // mark attempted, so a later 清空 stays empty
        let resuming = false;
        try {
          resuming = !!localStorage.getItem(ACTIVE_RUN_KEY);
        } catch {
          /* ignore */
        }
        const h = items[0];
        if (h && h.url && !resuming) {
          setRunMeta({
            prompt: h.params?.prompt ?? "",
            model: h.model,
            ratio: h.params?.ratio ?? "1:1",
            spec: "",
            count: 1,
            label: "",
            isVid: h.type === "video",
            refThumbs: [],
          });
          setCells([{ i: 0, hues: h.hues, url: h.url }]);
          setProgs([100]);
          setDoneSet({ 0: true });
          if (h.params) lastRunRef.current = h.params;
        }
      }
    } catch {
      setHist([]);
    }
  }, [ensureSession]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // make admin edits feel live: re-fetch when the tab regains focus / becomes
  // visible, so returning from 模型管理 reflects the latest per-model config
  // without a manual refresh.
  useEffect(() => {
    const onFocus = () => reloadModels();
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadModels();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadModels]);

  // when the selected model (its config) changes, snap each option control to a
  // value the model actually supports (so a stale ratio/res/quality can't linger).
  useEffect(() => {
    if (!mCfg) return;
    if (mCfg.ratios?.length) setRatio((r) => (mCfg.ratios!.includes(r) ? r : mCfg.ratios![0]));
    if (mCfg.resolutions?.length) {
      if (curType === "image") {
        setImgRes((v) => (mCfg.resolutions!.includes(v) ? v : mCfg.resolutions![0]));
      } else {
        setRes((v) => (mCfg.resolutions!.includes(v) ? v : mCfg.resolutions![0]));
      }
    }
    if (mCfg.durations?.length) setDur((v) => (mCfg.durations!.includes(v) ? v : mCfg.durations![0]));
    setQuality((v) =>
      mCfg.qualities?.length ? (mCfg.qualities.includes(v) ? v : mCfg.qualities[0]) : "",
    );
    if (mCfg.batchOptions?.length) {
      const mn = Math.min(...mCfg.batchOptions);
      const mx = Math.max(...mCfg.batchOptions);
      setCount((c) => Math.min(Math.max(c, mn), mx));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mCfg, curType]);

  // close the model dropdown on outside click (create.js document click).
  useEffect(() => {
    if (!modelOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!modelWrapRef.current?.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [modelOpen]);

  // close the upload preview on Escape (create.js openPreview esc handler).
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  // close the image lightbox on Escape.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // clear any running intervals on unmount.
  useEffect(() => () => ticksRef.current.forEach((t) => clearInterval(t)), []);

  /* ── panel handlers ──────────────────────────────────────────────────── */

  // setTool clears the typed uploads (create.js setTool → slotData = {}).
  const selectTool = (t: ToolKey) => {
    setTool(t);
    setSlotData({});
  };

  const pickType = (t: ArtworkType) => {
    setCurType(t);
    selectTool(MODES_BY_TYPE[t][0]); // renderModes() → setTool(keys[0])
  };

  // AI 优化: rewrite the prompt via the backend (relay text model). Falls back to
  // a clear toast when no text model is configured / the call fails.
  const aiOptimize = async () => {
    const v = prompt.trim();
    if (!v) {
      toast.info("先写一句提示词再优化 ✦");
      promptRef.current?.focus();
      return;
    }
    if (optimizing) return;
    setOptimizing(true);
    try {
      await ensureSession();
      const res = await aiApi.optimizePrompt(v);
      if (res.success && res.data?.prompt) {
        setPrompt(res.data.prompt);
        toast.success("✦ 已用 AI 优化提示词");
      } else {
        toast.error(res.message || "AI 优化失败");
      }
    } catch {
      toast.error("AI 优化失败，请稍后重试");
    } finally {
      setOptimizing(false);
    }
  };

  /* ── typed reference uploads (create.js addFile / removeFile / swap) ──── */

  // adding a reference asset: every slot offers a source choice (本地上传 / 资产库).
  const addFile = (k: string) => {
    const slot = slots?.find((s) => s.k === k);
    if (!slot) return;
    if ((slotData[k] || []).length >= slotMax(slot)) {
      toast.info(slot.label + "最多 " + slotMax(slot) + " 个");
      return;
    }
    setSrcMenu(k);
  };

  // push a real asset (uploaded or picked from 资产库) into a slot, honoring its max.
  const addRealFile = (k: string, file: { url: string; name?: string; size?: string }) => {
    const slot = slots?.find((s) => s.k === k);
    if (!slot) return;
    setSlotData((prev) => {
      const arr = prev[k] || [];
      if (arr.length >= slotMax(slot)) return prev; // silently cap (already warned on open)
      const uf: UploadFile =
        slot.type === "image"
          ? { g: file.url, url: file.url, n: file.name || "参考图", s: file.size || "" }
          : { n: file.name || (slot.type === "video" ? "video.mp4" : "audio.mp3"), d: "", url: file.url };
      return { ...prev, [k]: [...arr, uf] };
    });
  };

  // 本地上传: open the OS file picker for the slot, then upload each chosen file.
  const pickLocal = (k: string) => {
    setSrcMenu(null);
    localTargetRef.current = k;
    const slot = slots?.find((s) => s.k === k);
    const el = fileInputRef.current;
    if (!el) return;
    el.accept = slot?.type === "video" ? "video/*" : slot?.type === "audio" ? "audio/*" : "image/*";
    el.value = "";
    el.click();
  };

  const onLocalFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const k = localTargetRef.current;
    const list = e.target.files;
    if (!k || !list || list.length === 0) return;
    await ensureSession();
    for (const file of Array.from(list)) {
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl) {
        addRealFile(k, {
          url: res.data.fileUrl,
          name: file.name,
          size: (file.size / 1024 / 1024).toFixed(1) + " MB",
        });
      } else {
        toast.error("上传失败：" + (res.message || file.name));
      }
    }
    e.target.value = "";
  };

  // 资产库: open the full assets browser as a picker dialog for this slot.
  const openAssets = (k: string) => {
    setSrcMenu(null);
    setAssetPick(k);
  };

  const chooseAsset = (a: PickedAsset) => {
    const k = assetPick;
    setAssetPick(null);
    if (k) addRealFile(k, { url: a.url, name: a.name });
  };

  const removeFile = (k: string, i: number) =>
    setSlotData((prev) => {
      const arr = (prev[k] || []).slice();
      arr.splice(i, 1);
      return { ...prev, [k]: arr };
    });

  const swapFlf = () =>
    setSlotData((prev) => {
      if (!(prev.first || prev.last)) return prev;
      toast.success("已交换首尾帧");
      return { ...prev, first: prev.last, last: prev.first };
    });

  const slotTypeOf = (k: string): SlotType =>
    slots?.find((s) => s.k === k)?.type ?? "image";

  // reference-asset limits configured per mode in 模型管理 (0 / unset = no limit):
  //   i2i 图生图 → top-level maxRefImages/maxRefImageSizeMB
  //   i2v 图生视频 → refLimits i2v.*
  //   ref 全能参考 → refLimits omniRef.{image|video|audio}*
  // (flf 首尾帧 uses fixed first/last boxes, so its config isn't applied here.)
  const refLimitFor = (s: SlotDef): { count: number; size: number } => {
    const rl = mCfg?.refLimits ?? {};
    if (tool === "i2i" && s.type === "image") {
      return { count: mCfg?.maxRefImages ?? 0, size: mCfg?.maxRefImageSizeMB ?? 0 };
    }
    if (tool === "i2v" && s.type === "image") {
      return { count: rl["i2v.imageCount"] ?? 0, size: rl["i2v.imageSizeMB"] ?? 0 };
    }
    if (tool === "ref") {
      if (s.type === "image") return { count: rl["omniRef.imageCount"] ?? 0, size: rl["omniRef.imageSizeMB"] ?? 0 };
      if (s.type === "video") return { count: rl["omniRef.videoCount"] ?? 0, size: rl["omniRef.videoSizeMB"] ?? 0 };
      if (s.type === "audio") return { count: rl["omniRef.audioCount"] ?? 0, size: rl["omniRef.audioSizeMB"] ?? 0 };
    }
    return { count: 0, size: 0 };
  };
  const slotMax = (s: SlotDef): number => {
    const { count } = refLimitFor(s);
    return count > 0 ? count : s.max;
  };
  const slotHint = (s: SlotDef): string => {
    const { size } = refLimitFor(s);
    if (size <= 0) return s.hint;
    const unit = s.type === "image" ? "单张" : s.type === "video" ? "单段视频" : "单段音频";
    return `${s.hint} · ${unit} ≤ ${size}MB`;
  };

  /* gather reference thumbnails for the result header (create.js rhRefThumbs). */
  const refThumbsForRun = (seed: number): string[] => {
    const imgs: string[] = [];
    Object.values(slotData).forEach((arr) =>
      arr.forEach((f) => {
        if (f.g) imgs.push(f.g);
      }),
    );
    const out = imgs.length
      ? imgs
      : Array.from({ length: 4 }, (_, i) => {
          const h = (seed * 7 + i * 53) % 360;
          return `linear-gradient(135deg, hsl(${h} 50% 46%), hsl(${(h + 38) % 360} 55% 30%))`;
        });
    return out.slice(0, 4);
  };

  const buildWork = (
    hues: MeshHues,
    type: ArtworkType,
    p: string,
    mdl: string,
    url?: string,
  ): Artwork => ({
    id: `gen-${++histSeq}`,
    cover: hues,
    ...(url ? { src: url } : {}),
    h: 1,
    type,
    cat: "设计",
    model: mdl,
    title: (p || "我的创作").slice(0, 14) + (p.length > 14 ? "…" : ""),
    author: "我的创作",
    likes: 0,
    prompt: p,
  });

  const pushHistory = useCallback((item: Omit<HistItem, "id">) => {
    // Compute the id OUTSIDE the updater: a state updater must be pure, and React
    // dev double-invokes it — mutating histSeq inside produced duplicate keys.
    histSeq += 1;
    const id = `h-${histSeq}`;
    setHist((prev) => [{ id, ...item }, ...prev]);
  }, []);

  /* Drive the generating UI + poll a known backend task to completion. Shared by
     a fresh generation AND by the refresh-resume path (same task id either way),
     so an in-flight generation survives a page reload. */
  const driveRun = useCallback(
    (run: ActiveRun) => {
      const { taskId, prompt: p, model: mdl, ratio: r, spec, count: n, isVid, label, hues } = run;
      const myRun = (runIdRef.current += 1);

      const newCells: ResultCell[] = hues.map((h, i) => ({ i, hues: h }));
      setRunMeta({ prompt: p, model: mdl, ratio: r, spec, count: n, label, isVid, refThumbs: run.refThumbs });
      setCells(newCells);
      setDoneSet({});
      setBusy(true);
      setHistPage(1);

      ticksRef.current.forEach((t) => clearInterval(t));
      ticksRef.current = [];
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }

      // progress floor + gentle creep between polls (poll raises it to task.progress).
      const PROG_FLOOR = 6;
      const local = new Array(n).fill(PROG_FLOOR);
      setProgs([...local]);
      newCells.forEach((_, i) => {
        const tick = setInterval(() => {
          local[i] = Math.min(90, local[i] + 1.5);
          setProgs([...local]);
        }, 500);
        ticksRef.current.push(tick);
      });

      const stopTicks = () => {
        ticksRef.current.forEach((t) => clearInterval(t));
        ticksRef.current = [];
      };
      const clearActive = () => {
        try {
          localStorage.removeItem(ACTIVE_RUN_KEY);
        } catch {
          /* storage unavailable */
        }
      };
      const isValidUrl = (u?: string): u is string =>
        !!u && (u.startsWith("https://") || u.startsWith("http://") || u.startsWith("data:"));

      const finish = (urls: string[]) => {
        if (runIdRef.current !== myRun) return;
        stopTicks();
        clearActive();
        setProgs(new Array(n).fill(100));
        setCells((prev) => prev.map((c) => ({ ...c, url: urls[c.i] ?? urls[0] })));
        const done: Record<number, boolean> = {};
        for (let i = 0; i < n; i++) done[i] = true;
        setDoneSet(done);
        setBusy(false);
        newCells.forEach((cell, idx) =>
          pushHistory({
            hues: cell.hues,
            type: isVid ? "video" : "image",
            title: p,
            prompt: p,
            model: mdl,
            url: urls[idx] ?? urls[0],
          }),
        );
        toast.success("生成完成 · 点击作品查看详情");
      };

      const fail = (msg?: string) => {
        if (runIdRef.current !== myRun) return;
        stopTicks();
        clearActive();
        setBusy(false);
        toast.error(msg || "生成失败");
      };

      const poll = async () => {
        if (runIdRef.current !== myRun) return;
        try {
          const res = await aiApi.getTask(taskId);
          if (runIdRef.current !== myRun) return;
          if (!res.success) {
            fail(res.message);
            return;
          }
          const task = res.data;
          if (task.status === AiTaskStatus.SUCCESS) {
            let meta: Record<string, unknown> = {};
            if (typeof task.resultMeta === "string") {
              try {
                meta = JSON.parse(task.resultMeta) || {};
              } catch {
                meta = {};
              }
            } else if (task.resultMeta && typeof task.resultMeta === "object") {
              meta = task.resultMeta as Record<string, unknown>;
            }
            const rawUrls = meta.urls;
            const urls = Array.isArray(rawUrls) ? rawUrls.filter(isValidUrl) : [];
            const all = urls.length ? urls : isValidUrl(task.resultUrl) ? [task.resultUrl] : [];
            if (!all.length) {
              fail("生成结果无效，可能未配置 AI 供应商");
              return;
            }
            finish(all);
          } else if (task.status === AiTaskStatus.FAILED) {
            fail(task.errorMsg);
          } else if (task.status === AiTaskStatus.CANCELLED) {
            if (runIdRef.current !== myRun) return;
            stopTicks();
            clearActive();
            setBusy(false);
          } else {
            // still processing: raise the bar to the real progress (kept as a floor).
            if (typeof task.progress === "number") {
              const pv = Math.min(95, Math.max(PROG_FLOOR, task.progress));
              for (let i = 0; i < n; i++) local[i] = Math.max(local[i], pv);
              setProgs([...local]);
            }
            // deadline checked AFTER reading the task, so a completed task is always
            // picked up even when resumed long after it was started.
            const maxMs = isVid ? 30 * 60 * 1000 : 7 * 60 * 1000;
            if (Date.now() - run.startedAt > maxMs) {
              fail("生成超时，请重试");
              return;
            }
            pollRef.current = setTimeout(poll, 1500);
          }
        } catch {
          fail("网络错误");
        }
      };
      poll();
    },
    [pushHistory],
  );

  // Release the synchronous in-flight latch whenever a run settles (busy → false).
  // This single effect covers every setBusy(false) path (driveRun finish/fail/
  // cancelled, startGeneration failure, the simulation branch); paths that set the
  // latch but never start a run (a thrown one-click op) clear it themselves.
  useEffect(() => {
    if (!busy) genInFlightRef.current = false;
  }, [busy]);

  /* Create a backend task and hand the progress UI + polling to driveRun. Shared
     by the panel generate() and the one-click per-result edit ops, so both go
     through the exact same task-create → persist → drive path. */
  const startGeneration = useCallback(
    async (args: {
      handler: string;
      modelId: string;
      input: Record<string, unknown>;
      meta: Omit<ActiveRun, "taskId" | "startedAt">;
    }) => {
      const myRun = (runIdRef.current += 1);
      setBusy(true);
      try {
        await ensureSession();
        if (runIdRef.current !== myRun) return;
        const res2 = await aiApi.generate({
          handler: args.handler,
          modelId: args.modelId,
          input: args.input,
        });
        if (runIdRef.current !== myRun) return;
        if (!res2.success) {
          setBusy(false);
          toast.error(res2.message || "生成请求失败");
          return;
        }
        const run: ActiveRun = { taskId: res2.data.id, ...args.meta, startedAt: Date.now() };
        try {
          localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
        } catch {
          /* storage unavailable — generation still works, just no refresh-resume */
        }
        driveRun(run);
      } catch {
        setBusy(false);
        toast.error("网络错误");
      }
    },
    [ensureSession, driveRun],
  );

  /* One-click per-result edit op (移除背景 / 物体移除 / 高清放大 / 扩图). Fires a
     real generation on the clicked image with a fixed backend handler — the
     server owns the edit instruction, so the user types nothing. The op always
     runs on an image-edit model (resolved independently of the current panel
     model, which may be a video model), and 高清放大 prefers a 4K-capable one. */
  const oneClickEdit = useCallback(
    async (op: string, imageUrl: string, label: string) => {
      if (busy || genInFlightRef.current) {
        toast.info("正在生成中，请稍候…");
        return;
      }
      const handler = EDIT_OP_HANDLER[op];
      if (!handler || !imageUrl) {
        toast.info("该结果暂无可用图片");
        return;
      }
      // latch synchronously, before the awaits below, so a rapid double-click
      // can't slip a second task through (busy is only set later, inside
      // startGeneration). Cleared on every exit that doesn't hand off to a run.
      genInFlightRef.current = true;
      try {
        await ensureSession();
        // resolve an image-edit-capable model (independent of the current panel
        // type, since the panel may be on 视频 while editing an image result).
        const r = await marketApi.studioModels("image");
        const models = (r.success && r.data ? r.data : []) as StudioModelVO[];
        const editable = models.filter((m) => {
          const c = m.config;
          return (c?.operations?.includes("edits") ?? false) || (c?.modes?.includes("i2i") ?? false);
        });
        const pool = editable.length ? editable : models;
        const is4k = (m: StudioModelVO) =>
          /4k/i.test(m.modelKey || "") || /4k|4K/.test(m.name);
        let pick: StudioModelVO | undefined;
        if (op === "hd") {
          pick = pool.find(is4k) ?? pool.find((m) => model === m.name) ?? pool[0];
        } else {
          pick =
            pool.find((m) => m.name === model) ??
            pool.find((m) => /nano-banana-2$/.test(m.modelKey || "")) ??
            pool.find((m) => /gpt-image-2/.test(m.modelKey || "")) ??
            pool[0];
        }
        const modelId = pick?.modelKey || pick?.id || "";
        if (!modelId) {
          genInFlightRef.current = false;
          toast.error("没有可用的图像编辑模型");
          return;
        }
        // input carries only the source image (+ a human label under prompt for
        // history display; the backend overrides it with the engineered prompt)
        // and, for 高清放大, the 4K resolution hint.
        const input: Record<string, unknown> = {
          imageList: [imageUrl],
          sourceImage: imageUrl,
          prompt: label,
          ...(op === "hd" ? { resolution: "4k", clarity: "4k", quality: "high" } : {}),
        };
        const hsh = promptHue(imageUrl);
        const hues: MeshHues[] = [[hsh, (hsh + 80) % 360, (hsh + 200) % 360]];
        setHistPage(1);
        // a one-click edit is server-driven with no panel params, so clear the
        // last-run snapshot: the result's 再次生成 / 重新编辑 foot actions must not
        // replay the previous (unrelated) panel run.
        lastRunRef.current = null;
        await startGeneration({
          handler,
          modelId,
          input,
          meta: {
            prompt: label,
            model: pick?.name || model,
            ratio: runMeta?.ratio ?? "1:1",
            spec: label,
            count: 1,
            isVid: false,
            label,
            hues,
            refThumbs: [imageUrl],
          },
        });
      } catch {
        genInFlightRef.current = false;
        toast.error("网络错误，请重试");
      }
    },
    [busy, ensureSession, model, runMeta, startGeneration],
  );

  /* ── generation ───────────────────────────────────────────────────────────
     Calls the real backend (/api/ai/generate → poll /api/ai/tasks/:id) when a
     real studio model is selected; falls back to the design-preview simulation
     only when no backend model is available (studioList empty). */

  const generate = useCallback(() => {
    if (busy || genInFlightRef.current) return;
    const p = prompt.trim();
    if (!p) {
      toast.info("先写一句提示词吧 ✦");
      promptRef.current?.focus();
      return;
    }

    // reference assets from the upload slots (real URLs from 本地上传 / 资产库).
    const slotUrls = (key: string) =>
      (slotData[key] || []).map((f) => f.url).filter((u): u is string => !!u);
    const imageRefs = tool === "i2v" ? slotUrls("first") : slotUrls("img");
    const firstFrame = slotUrls("first")[0];
    const lastFrame = slotUrls("last")[0];
    const needsRef = (UPLOADS[tool] ?? []).some((s) => s.type === "image");
    if (needsRef && imageRefs.length === 0 && !firstFrame && !lastFrame) {
      toast.info("请先上传参考图片");
      return;
    }
    const refInput: Record<string, unknown> = {};
    if (imageRefs.length) {
      refInput.imageList = imageRefs;
      refInput.sourceImage = imageRefs[0];
      if (imageRefs.length > 1) refInput.references = imageRefs.slice(1);
    }
    if (tool === "flf") {
      if (firstFrame) refInput.firstFrame = firstFrame;
      if (lastFrame) refInput.lastFrame = lastFrame;
    }
    if (tool === "ref") {
      const vids = slotUrls("video");
      const auds = slotUrls("audio");
      if (vids.length) refInput.videoReferences = vids;
      if (auds.length) refInput.audioReferences = auds;
    }

    // all early-return guards passed → latch synchronously (before any state
    // update / the async startGeneration) so a double-click can't double-fire.
    genInFlightRef.current = true;
    setBusy(true);

    const n = count;
    const isVid = TOOLS[tool].mode === "t2v";
    const label = TOOLS[tool].label;
    const r = ratio;
    const mdl = model;
    const hsh = promptHue(p);
    const spec = isVid ? `${r} · ${res} · ${dur}` : `${r} · ${imgRes}`;
    const hues: MeshHues[] = Array.from(
      { length: n },
      (_, i) => [hsh + i * 36, hsh + i * 36 + 80, hsh + i * 36 + 200] as MeshHues,
    );
    const refThumbs = refThumbsForRun(hsh);

    // snapshot the exact settings of this run for 重新编辑 / 再次生成.
    lastRunRef.current = {
      prompt: p, model: mdl, tool, curType, ratio: r, imgRes, res, dur, quality, count: n,
    };

    setRunMeta({ prompt: p, model: mdl, ratio: r, spec, count: n, label, isVid, refThumbs });
    setCells(hues.map((h, i) => ({ i, hues: h })));
    setProgs(new Array(n).fill(0));
    setDoneSet({});
    setHistPage(1); // jump to first page so newest items are visible

    // clear any stragglers from a previous run + invalidate its poll.
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    // invalidate any in-flight poll from a previous run (startGeneration/driveRun
    // each take their own run id from here).
    runIdRef.current += 1;

    const selStudio = studioList.find((m) => m.name === model) ?? null;
    const modelId = selStudio?.modelKey || selStudio?.id || "";

    // ── design-preview simulation (no backend model configured) ───────────
    if (!modelId) {
      const local = new Array(n).fill(0);
      const doneLocal = new Array(n).fill(false);
      let doneCountLocal = 0;
      hues.forEach((hu, i) => {
        const speed = 1.4 + Math.random() * 1.2;
        const tick = setInterval(() => {
          local[i] = Math.min(100, local[i] + speed + Math.random() * 3);
          setProgs([...local]);
          if (local[i] >= 100) {
            clearInterval(tick);
            if (doneLocal[i]) return;
            doneLocal[i] = true;
            doneCountLocal += 1;
            pushHistory({ hues: hu, type: isVid ? "video" : "image", title: p, prompt: p, model: mdl });
            setDoneSet((prev) => ({ ...prev, [i]: true }));
            if (doneCountLocal >= n) {
              setBusy(false);
              toast.success("生成完成 · 点击作品查看详情");
            }
          }
        }, 90 + i * 40);
        ticksRef.current.push(tick);
      });
      return;
    }

    // ── real generation: build the input, then hand off to startGeneration
    // (shared task-create → persist → drive path). ────────────────────────
    const input: Record<string, unknown> = {
      prompt: p,
      ...refInput,
      ...(ratioOpts.length ? { aspectRatio: r, aspect_ratio: r, ratio: r } : {}),
      ...(isVid
        ? {
            ...(resOpts.length ? { resolution: res } : {}),
            ...(durOpts.length ? { duration: dur } : {}),
          }
        : {
            ...(resOpts.length ? { clarity: imgRes, resolution: imgRes } : {}),
            ...(qualOpts.length ? { quality } : {}),
          }),
      ...(n > 1 ? { batchCount: n } : {}),
    };
    void startGeneration({
      handler: TOOL_TO_HANDLER[tool],
      modelId,
      input,
      meta: { prompt: p, model: mdl, ratio: r, spec, count: n, isVid, label, hues, refThumbs },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, prompt, count, tool, curType, ratio, model, res, dur, imgRes, quality, slotData, studioList, ratioOpts, resOpts, durOpts, qualOpts, pushHistory, startGeneration]);

  // Refresh-resume: on mount, if a generation was in flight (persisted at start),
  // restore the generating UI and resume polling — the task keeps running on the
  // server, so a reload no longer loses it.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(ACTIVE_RUN_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let saved: ActiveRun | null = null;
    try {
      saved = JSON.parse(raw) as ActiveRun;
    } catch {
      saved = null;
    }
    if (!saved || typeof saved.taskId !== "number" || !Array.isArray(saved.hues)) {
      try {
        localStorage.removeItem(ACTIVE_RUN_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    let cancelled = false;
    (async () => {
      await ensureSession();
      if (!cancelled) driveRun(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSession, driveRun]);

  // 重新编辑 / 再次生成: restore the captured run's full settings back into the
  // panel (type/mode/model/ratio/resolution/quality/count + prompt). Returns
  // false when there is nothing to restore.
  const restoreLastRun = useCallback((): boolean => {
    const lr = lastRunRef.current;
    if (!lr) return false;
    setCurType(lr.curType);
    setTool(lr.tool);
    setModel(lr.model);
    setPrompt(lr.prompt);
    setRatio(lr.ratio);
    setImgRes(lr.imgRes);
    setRes(lr.res);
    setDur(lr.dur);
    setQuality(lr.quality);
    setCount(lr.count);
    return true;
  }, []);

  // 再次生成: after restoring the run's settings to the panel (above), fire
  // generate() on the next commit so it reads the just-restored state.
  useEffect(() => {
    if (!pendingGen) return;
    setPendingGen(false);
    generate();
  }, [pendingGen, generate]);

  // tear down the current run's intervals + result state (no busy guard).
  const resetRun = useCallback(() => {
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    runIdRef.current += 1; // invalidate any in-flight poll for the previous run
    try {
      localStorage.removeItem(ACTIVE_RUN_KEY); // a cancelled/cleared run won't resume on refresh
    } catch {
      /* ignore */
    }
    setCells([]);
    setProgs([]);
    setDoneSet({});
    setRunMeta(null);
  }, []);

  // header "清空" — disabled while busy, so a plain reset is safe here.
  const clearCanvas = () => {
    if (busy) return;
    resetRun();
  };

  // load a finished result into a tool's reference slot, then switch to that tool
  // so the user can immediately describe the change. selectTool() clears slotData,
  // and our setSlotData runs in the same batch so the injected slot wins.
  const applyImageToTool = (
    cell: ResultCell,
    type: ArtworkType,
    toolKey: ToolKey,
    slotKey: string,
    doneToast: string,
  ) => {
    if (!cell.url) {
      toast.info("该结果暂无可用图片");
      return;
    }
    setCurType(type);
    selectTool(toolKey);
    setSlotData({ [slotKey]: [{ g: cell.url, url: cell.url, n: "垫图", s: "" }] });
    toast.success(doneToast);
    setTimeout(() => promptRef.current?.focus(), 0);
  };

  // per-cell hover toolbar (作为垫图 / 生成视频 / 精细编辑 / 扩图 / 高清放大 /
  // 移除背景 / 物体移除). The first three load the image into a panel tool; the rest
  // fire a one-click generation against a dedicated backend edit handler.
  const cellTool = (act: string, cell: ResultCell) => {
    switch (act) {
      case "pad":
        applyImageToTool(cell, "image", "i2i", "img", "已作为垫图载入图生图 · 描述想要的改动");
        break;
      case "video":
        applyImageToTool(cell, "video", "i2v", "first", "已载入图生视频首帧 · 描述运动");
        break;
      case "edit":
        applyImageToTool(cell, "image", "edit", "img", "已载入改图 · 描述要精修的部分");
        break;
      case "expand":
      case "hd":
      case "rmbg":
      case "rmobj": {
        if (!cell.url) {
          toast.info("该结果暂无可用图片");
          break;
        }
        const label = CELL_TOOLS.find((t) => t.act === act)?.label ?? "编辑";
        void oneClickEdit(act, cell.url, label);
        break;
      }
    }
  };

  // same toolbar from the zoom lightbox: wrap the previewed URL as a cell and
  // reuse cellTool, then close the lightbox so the panel / new run is visible.
  const lightboxTool = (act: string) => {
    if (!lightbox) return;
    const cell: ResultCell = { i: -1, hues: huesFromId(lightbox), url: lightbox };
    setLightbox(null);
    cellTool(act, cell);
  };

  const openCell = (cell: ResultCell) => {
    if (!doneSet[cell.i] || !runMeta) return;
    setActive(
      buildWork(
        cell.hues,
        runMeta.isVid ? "video" : "image",
        runMeta.prompt,
        runMeta.model,
        cell.url,
      ),
    );
  };

  const openHist = (h: HistItem) =>
    setActive(buildWork(h.hues, h.type, h.prompt, h.model, h.url));

  /* ── render: typed upload slots (create.js renderUploads) ─────────────── */

  const renderSlotCard = (s: SlotDef) => {
    const files = slotData[s.k] || [];
    if (files.length === 0) {
      return (
        <div className="ws-up" key={s.k}>
          <button className="ws-up-slot" type="button" onClick={() => addFile(s.k)}>
            <span className="ws-up-slot-ic">{SLOT_ICON[s.type]}</span>
            <span className="ws-up-slot-tx">
              <span className="t">{s.label}</span>
              <span className="h">{slotHint(s)}</span>
            </span>
            <span className="ws-up-slot-go">上传 ↗</span>
          </button>
        </div>
      );
    }
    return (
      <div className="ws-up" key={s.k}>
        <div className="ws-up-head">
          <label>
            {s.label}
            <span className="ws-up-n">
              {files.length}/{slotMax(s)}
            </span>
          </label>
          <button className="ws-up-act" type="button" onClick={() => addFile(s.k)}>
            ⤓ 上传
          </button>
        </div>
        {s.type === "image" ? (
          <div className="ws-up-grid">
            {files.map((f, i) => (
              <div
                className="ws-ref"
                key={i}
                title="点击预览"
                onClick={() => setPreview({ k: s.k, i })}
              >
                <span className="ws-ref-img" style={{ background: thumbBg(f.g) }} />
                <span className="ws-ref-zoom">⚲</span>
                <button
                  className="ws-ref-x"
                  type="button"
                  title="移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(s.k, i);
                  }}
                >
                  ✕
                </button>
                <span className="ws-ref-meta">
                  <span className="nm">{f.n}</span>
                  <span className="sz">{f.s}</span>
                </span>
              </div>
            ))}
            {files.length < slotMax(s) && (
              <button className="ws-ref-add" type="button" onClick={() => addFile(s.k)}>
                <span className="p">＋</span>添加
              </button>
            )}
          </div>
        ) : (
          <div className="ws-up-list">
            {files.map((f, i) => (
              <div
                className="ws-file"
                key={i}
                title="点击预览"
                onClick={() => setPreview({ k: s.k, i })}
              >
                <span className={`ic ${s.type}`}>{s.type === "video" ? "▶" : "♪"}</span>
                <span className="fn">{f.n}</span>
                <span className="fd">{f.d}</span>
                <button
                  className="ws-file-x"
                  type="button"
                  title="移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(s.k, i);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {files.length < slotMax(s) && (
              <button className="ws-up-more" type="button" onClick={() => addFile(s.k)}>
                ＋ 继续添加
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderFlfBox = (s: SlotDef) => {
    const f = (slotData[s.k] || [])[0];
    if (!f) {
      return (
        <button className="ws-flf-box" type="button" onClick={() => addFile(s.k)}>
          <span className="plus">＋</span>
          <span className="lb">{s.label}</span>
        </button>
      );
    }
    return (
      <div
        className="ws-flf-box filled"
        title="点击预览"
        onClick={() => setPreview({ k: s.k, i: 0 })}
      >
        <span className="ws-flf-img" style={{ background: thumbBg(f.g) }} />
        <button
          className="ws-flf-x"
          type="button"
          title="移除"
          onClick={(e) => {
            e.stopPropagation();
            removeFile(s.k, 0);
          }}
        >
          ✕
        </button>
        <span className="ws-flf-lb">{s.label}</span>
      </div>
    );
  };

  const renderUploads = () => {
    if (!slots) return null;
    if (tool === "flf") {
      const [rw, rh] = ratio.split(":");
      return (
        <div className="ws-reffiles" id="dropFiles" style={{ display: "block" }}>
          <div className="ws-up ws-up--flf">
            <div className="ws-up-head">
              <label>首尾帧</label>
              <span className="ws-up-tip">上传起止画面，生成平滑过渡</span>
            </div>
            <div
              className="ws-flf"
              style={{ ["--flf-ar" as string]: `${rw}/${rh}` } as CSSProperties}
            >
              {renderFlfBox(slots[0])}
              <button
                className="ws-flf-arrow"
                type="button"
                title="交换首尾帧"
                onClick={swapFlf}
              >
                ⇌
              </button>
              {renderFlfBox(slots[1])}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="ws-reffiles" id="dropFiles" style={{ display: "block" }}>
        {slots.map(renderSlotCard)}
      </div>
    );
  };

  /* ── render: upload preview modal (create.js openPreview) ─────────────── */

  const renderPreview = () => {
    if (!preview) return null;
    const f = (slotData[preview.k] || [])[preview.i];
    if (!f) return null;
    const type = slotTypeOf(preview.k);
    let media: ReactNode;
    if (type === "image") {
      media = <div className="ws-prev-media" style={{ background: thumbBg(f.g) }} />;
    } else if (type === "video") {
      media = (
        <div className="ws-prev-media dark" style={{ background: refGrad(preview.i * 9 + 40) }}>
          <span className="ws-prev-play">▶</span>
          <span className="ws-prev-badge">{f.d}</span>
        </div>
      );
    } else {
      media = (
        <div className="ws-prev-media dark">
          <div className="ws-prev-wave">
            {Array.from({ length: 42 }, (_, i) => (
              <i key={i} style={{ height: `${18 + ((i * 37) % 64)}%` }} />
            ))}
          </div>
          <span className="ws-prev-play sm">▶</span>
          <span className="ws-prev-badge">{f.d}</span>
        </div>
      );
    }
    return (
      <div
        className="ws-prev-mask show"
        onClick={(e) => {
          if (e.target === e.currentTarget) setPreview(null);
        }}
      >
        <div className="ws-prev" role="dialog" aria-modal>
          <button
            className="ws-prev-x"
            type="button"
            aria-label="关闭"
            onClick={() => setPreview(null)}
          >
            ✕
          </button>
          {media}
          <div className="ws-prev-meta">
            <span className="nm">{f.n}</span>
            <span className="sz">
              {f.s || (type === "video" ? "视频 · " : "音频 · ") + (f.d ?? "")}
            </span>
          </div>
        </div>
      </div>
    );
  };

  /* ── render ──────────────────────────────────────────────────────────── */

  const selSwatch = swatchFor(model);

  return (
    <>
      <div className={styles.cols}>
        {/* ── control panel ───────────────────────────────────────────── */}
        <aside className="ws-panel">
          <div className="ws-panel-scroll">
            {/* type tabs: 图片 / 视频 */}
            <div className="ws-typetabs" id="type-tabs">
              <button
                type="button"
                className={curType === "image" ? "on" : undefined}
                onClick={() => pickType("image")}
              >
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="8.5" cy="9.5" r="1.6" />
                  <path d="M21 16l-5-5L5 20" />
                </svg>
                图片
              </button>
              <button
                type="button"
                className={curType === "video" ? "on" : undefined}
                onClick={() => pickType("video")}
              >
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="5" width="13" height="14" rx="2" />
                  <path d="M16 10l5-3v10l-5-3z" />
                </svg>
                视频
              </button>
            </div>

            {/* mode tabs (generation tool) */}
            <div className="seg" id="mode-tabs">
              {modeKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={tool === k ? "on" : undefined}
                  onClick={() => selectTool(k)}
                >
                  {TOOLS[k].label}
                </button>
              ))}
            </div>

            {/* model picker */}
            <div
              className={`ws-model-wrap${modelOpen ? " open" : ""}`}
              ref={modelWrapRef}
            >
              <button
                className="ws-model"
                id="modelCard"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={modelOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setModelOpen((v) => !v);
                }}
              >
                <span className="ws-model-sw" style={selSwatch.style}>
                  {selSwatch.content}
                </span>
                <span className="ws-model-info">
                  <span className="ws-model-row">
                    <span className="ws-model-name">{model}</span>
                    <span className="ws-model-tag">{meta.tag}</span>
                  </span>
                  <span className="ws-model-desc">
                    {meta.by ? `${meta.by} · ${meta.desc}` : meta.desc}
                  </span>
                </span>
                <span className="ws-model-switch">
                  <span className="cv">▾</span>
                </span>
              </button>

              <div className="ws-model-menu" id="modelMenu" role="listbox">
                {modelNames.map((m) => {
                  const mm = metaOf(m, modelMeta);
                  const sw = swatchFor(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={m === model}
                      className={`ws-mopt${m === model ? " on" : ""}`}
                      onClick={() => {
                        setModel(m);
                        setModelOpen(false);
                      }}
                    >
                      <span className="ws-mopt-sw" style={sw.style}>
                        {sw.content}
                      </span>
                      <span className="ws-mopt-info">
                        <span className="ws-mopt-row">
                          <span className="ws-mopt-name">{m}</span>
                          <span className="ws-model-tag">{mm.tag}</span>
                        </span>
                        <span className="ws-mopt-desc">
                          {mm.by ? `${mm.by} · ${mm.desc}` : mm.desc}
                        </span>
                      </span>
                      <span className="ws-mopt-ck">✓</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* typed reference uploads (per-tool slots; create.js renderUploads) */}
            {renderUploads()}

            {/* prompt */}
            <div className="ws-seclabel">
              提示词{" "}
              <span className="ws-pcount">
                <b id="pLen">{prompt.length}</b> 字
              </span>
            </div>
            <div className="ws-promptbox">
              <textarea
                className="ws-prompt"
                id="prompt"
                ref={promptRef}
                placeholder={mCfg?.defaultPrompt || cfg.ph}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="ws-prompt-foot">
                <button className="ws-aiopt" type="button" onClick={aiOptimize} disabled={optimizing}>
                  <span className="spark">✦</span> {optimizing ? "优化中…" : "AI 优化"}
                </button>
                <button
                  className="ws-pclear"
                  type="button"
                  onClick={() => setPrompt("")}
                >
                  清空
                </button>
              </div>
            </div>

            {/* idea chips (only when the model configures 灵感提示词) */}
            {ideaOpts.length > 0 && (
              <>
                <div className="ws-chips-head">灵感提示词 · 点击填入</div>
                <div className="ws-chips" id="ideas">
                  {ideaOpts.map((t) => (
                    <button key={t} type="button" onClick={() => setPrompt(t)}>
                      {t.length > 10 ? t.slice(0, 10) + "…" : t}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* 画面比例 (configured ratios only) */}
            {ratioOpts.length > 0 && (
              <div className="ws-field col" id="fieldRatio">
                <label>画面比例</label>
                <div className="ws-ratios" id="ratios">
                  {ratioOpts.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`ratio${r === ratio ? " on" : ""}`}
                      onClick={() => setRatio(r)}
                    >
                      {ratioLabel(r)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 分辨率 (image, configured resolutions only) */}
            {!isVideo && resOpts.length > 0 && (
              <div className="ws-field col" id="fieldImgRes">
                <label>分辨率</label>
                <div className="ws-ratios" id="imgResPills">
                  {resOpts.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`ratio${r === imgRes ? " on" : ""}`}
                      onClick={() => setImgRes(r)}
                    >
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 质量 (image, configured qualities only) */}
            {!isVideo && qualOpts.length > 0 && (
              <div className="ws-field col" id="fieldQuality">
                <label>质量</label>
                <div className="ws-ratios" id="qualityPills">
                  {qualOpts.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className={`ratio${q === quality ? " on" : ""}`}
                      onClick={() => setQuality(q)}
                    >
                      {QUALITY_LABEL[q] ?? q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 清晰度 (video, configured resolutions only) */}
            {isVideo && resOpts.length > 0 && (
              <div className="ws-field col" id="fieldRes">
                <label>清晰度</label>
                <div className="ws-ratios" id="resPills">
                  {resOpts.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`ratio${r === res ? " on" : ""}`}
                      onClick={() => setRes(r)}
                    >
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 生成数量 (image). 始终显示；仅 1 个可选数量时滑块固定且禁用。 */}
            {!isVideo && (
              <div className="ws-field col" id="fieldCount">
                <label>
                  生成数量 · <span id="countVal">{count}</span>
                </label>
                <input
                  className="slider"
                  id="count"
                  type="range"
                  min={batchMin}
                  max={batchMax}
                  step={1}
                  value={count}
                  disabled={batchMax <= batchMin}
                  onChange={(e) => setCount(+e.target.value)}
                />
              </div>
            )}

            {/* 时长 (video, configured durations only) */}
            {isVideo && durOpts.length > 0 && (
              <div className="ws-field col" id="fieldDur">
                <label>时长</label>
                <div className="ws-ratios" id="durPills">
                  {durOpts.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`ratio${d === dur ? " on" : ""}`}
                      onClick={() => setDur(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* footer */}
          <div className="ws-panel-foot">
            <button
              className={`ws-gen${busy ? " busy" : ""}`}
              id="gen"
              type="button"
              onClick={generate}
            >
              <span className="spark">✦</span> 立即生成{" "}
              <span className="ws-gen-cost">
                ·&nbsp;<b id="cost">{cost}</b>&nbsp;积分
              </span>
            </button>
            <div className="ws-balance">
              余额 1,280 积分 · <a href="/pricing">充值</a>
            </div>
          </div>
        </aside>

        {/* ── center stage ────────────────────────────────────────────── */}
        <main className="ws-stage" id="stage">
          <div className="ws-stage-main">
            {/* stage-local ambient backdrop (design's <canvas id="flux"
                class="ws-stage-fx">). Styled by studio.css's .ws-stage-fx —
                we use the CSS gradient fallback so it stays scoped to the stage
                (FluxField's #flux-bg is a full-viewport fixed field, unsuitable
                here; the WebGL upgrade can land in a later phase). */}
            <canvas id="flux" className="ws-stage-fx flux-fallback" aria-hidden />
            <div className="ws-stage-veil" />

            <div className="ws-stage-top">
              <div className="ws-crumb">
                <span className="d" />
                创作台 · STUDIO
              </div>
              <div className="ws-stage-actions">
                <button
                  className="ws-iconbtn"
                  id="clearBtn"
                  type="button"
                  title="清空画布"
                  disabled={!hasResults || busy}
                  onClick={clearCanvas}
                >
                  清空
                </button>
              </div>
            </div>

            {/* empty state */}
            {!hasResults && (
              <div className="ws-empty" id="empty">
                <div className="ws-empty-glyph">
                  <span className="glyph" />
                </div>
                <h2>准备好开始创作了吗？</h2>
                <p>写下一句提示词，挑个模型与比例 —— 数秒之后，作品就在这里浮现。</p>
                <div className="ws-empty-tags">
                  {(
                    [
                      { type: "image", tool: "t2i", label: "✦ 文生图" },
                      { type: "image", tool: "i2i", label: "↻ 图生图" },
                      { type: "video", tool: "t2v", label: "▶ 文生视频" },
                      { type: "video", tool: "i2v", label: "⤢ 图生视频" },
                    ] as { type: ArtworkType; tool: ToolKey; label: string }[]
                  ).map((t) => (
                    <button
                      key={t.tool}
                      type="button"
                      onClick={() => {
                        setCurType(t.type);
                        selectTool(t.tool);
                        promptRef.current?.focus();
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* result grid — columns follow the cell count: 1→1-up, 2→2-up,
                3→3-up, 4→2×2 (其余 ≥5 仍用 2 列网格)。 */}
            {hasResults && runMeta && (
              <div
                className="ws-grid"
                id="grid"
                data-n={cells.length}
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${
                    cells.length <= 1 ? 1 : cells.length === 3 ? 3 : 2
                  }, 1fr)`,
                  // 单张时收窄网格，避免铺满整宽显得过大。
                  ...(cells.length <= 1 ? { maxWidth: 560 } : {}),
                }}
              >
                {cells.map((cell) => {
                  const [rw, rh] = runMeta.ratio.split(":").map(Number);
                  const done = !!doneSet[cell.i];
                  const pct = Math.round(progs[cell.i] ?? 0);
                  return (
                    <div
                      key={cell.i}
                      className={`gen-cell${done ? " done" : ""}`}
                      data-i={cell.i}
                      style={{
                        aspectRatio: `${rw}/${rh}`,
                        ...(done && cell.url ? { cursor: "zoom-in" } : {}),
                      }}
                      onClick={() => {
                        if (!done) return;
                        if (cell.url) setLightbox(cell.url); // real image → zoom preview
                        else openCell(cell); // simulation/mesh → work-detail modal
                      }}
                    >
                      <div
                        className="done-cov"
                        style={{
                          background: cell.url
                            ? `center / cover no-repeat url("${cell.url}")`
                            : mesh(cell.hues[0], cell.hues[1], cell.hues[2]),
                        }}
                      />
                      <div className="shimmer" />
                      <div className="ph">
                        生成中 · <span className="pct">{pct}%</span>
                      </div>
                      <div className="bar">
                        <i style={{ width: `${progs[cell.i] ?? 0}%` }} />
                      </div>
                      <span className="reveal-tag">✦ 刚刚生成</span>
                      <div
                        className="gen-acts"
                        onClick={(e) => {
                          e.stopPropagation();
                          const btn = (e.target as HTMLElement).closest("button");
                          if (btn) cellTool(btn.dataset.act || "", cell);
                        }}
                      >
                        {CELL_TOOLS.map((t) => (
                          <button
                            key={t.act}
                            type="button"
                            data-act={t.act}
                            className={t.real ? undefined : "soon"}
                            title={t.label}
                            aria-label={t.label}
                          >
                            {t.icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* done-state action bar (create.js ws-result-foot) */}
                {allDone && (
                  <div className="ws-result-foot">
                    <button
                      type="button"
                      data-fa="edit"
                      onClick={() => {
                        if (restoreLastRun()) {
                          promptRef.current?.focus();
                          toast.info("已载入该作品的参数，可修改后再次生成");
                        }
                      }}
                    >
                      <span className="i">✎</span>重新编辑
                    </button>
                    <button
                      type="button"
                      data-fa="regen"
                      onClick={() => {
                        if (busy) return;
                        if (restoreLastRun()) setPendingGen(true);
                      }}
                    >
                      <span className="i">↻</span>再次生成
                    </button>
                    <button
                      type="button"
                      data-fa="more"
                      onClick={() => toast.info("更多 · 下载 / 收藏 / 分享")}
                    >
                      ⋯
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* generation-history strip (create.js renderStrip + pagination) */}
          <div className="ws-histbar">
            <div className="ws-histbar-head">
              <div className="ws-histtitle">
                生成历史{" "}
                <span className="ws-histcount" id="histCount">
                  {filteredHist.length || ""}
                </span>
              </div>
              <div className="ws-histhead-r">
                <div className="ws-histfilter" id="histFilter">
                  {(
                    [
                      { f: "all", label: "全部" },
                      { f: "image", label: "图片" },
                      { f: "video", label: "视频" },
                    ] as { f: "all" | "image" | "video"; label: string }[]
                  ).map((b) => (
                    <button
                      key={b.f}
                      type="button"
                      className={histFilter === b.f ? "on" : undefined}
                      onClick={() => {
                        setHistFilter(b.f);
                        setHistPage(1);
                      }}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
                <div className="ws-histpager" id="histPager">
                  {histPages > 1 && (
                    <>
                      <button
                        className="ws-pprev"
                        type="button"
                        disabled={curPage <= 1}
                        onClick={() => setHistPage((p) => Math.max(1, p - 1))}
                      >
                        ‹
                      </button>
                      <span className="ws-pcur">
                        {curPage} / {histPages}
                      </span>
                      <button
                        className="ws-pnext"
                        type="button"
                        disabled={curPage >= histPages}
                        onClick={() => setHistPage((p) => Math.min(histPages, p + 1))}
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="ws-histstrip" id="histStrip">
              {filteredHist.length === 0 && !busy ? (
                <div className="ws-hempty">
                  还没有{histFilter === "video" ? "视频" : histFilter === "image" ? "图片" : ""}生成记录
                </div>
              ) : (
                <>
                  {/* 生成中占位卡：与上方生成框对应，完成后被真实历史项取代 */}
                  {busy && curPage === 1 && (
                    <div className="ws-hcard loading" aria-label="生成中">
                      <span className="cov" />
                      <span className="ws-hload">
                        <i />
                      </span>
                    </div>
                  )}
                  {pageItems.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="ws-hcard"
                      data-htype={h.type}
                      onClick={() => openHist(h)}
                    >
                      <span
                        className="cov"
                        style={{
                          background: h.url
                            ? `center / cover no-repeat url("${h.url}")`
                            : coverBg(h.hues),
                        }}
                      />
                      {h.type === "video" && <span className="vbadge">▶</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      {renderPreview()}
      <WorkModal work={active} onClose={() => setActive(null)} />

      {/* full-image lightbox — click a finished result to zoom; backdrop / ✕ / Esc closes */}
      {lightbox && (
        <div className="ws-lightbox" onClick={() => setLightbox(null)}>
          <button
            type="button"
            className="ws-lb-x"
            aria-label="关闭"
            onClick={() => setLightbox(null)}
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="生成结果预览" onClick={(e) => e.stopPropagation()} />
          {/* same per-result edit toolbar, always visible in the zoom view */}
          <div
            className="gen-acts ws-lb-tools"
            onClick={(e) => {
              e.stopPropagation();
              const btn = (e.target as HTMLElement).closest("button");
              if (btn) lightboxTool(btn.dataset.act || "");
            }}
          >
            {CELL_TOOLS.map((t) => (
              <button
                key={t.act}
                type="button"
                data-act={t.act}
                className={t.real ? undefined : "soon"}
                title={t.label}
                aria-label={t.label}
              >
                {t.icon}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* hidden input for 本地上传 */}
      <input ref={fileInputRef} type="file" multiple hidden onChange={onLocalFiles} />

      {/* 参考素材来源选择：本地上传 / 资产库（按槽类型 图片/视频/音频 适配文案） */}
      {srcMenu &&
        (() => {
          const kind = slotTypeOf(srcMenu);
          const lb = kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片";
          return (
            <div className="ws-srcmask" onClick={() => setSrcMenu(null)}>
              <div className="ws-srcmenu" onClick={(e) => e.stopPropagation()}>
                <div className="ws-srcmenu-h">选择{lb}来源</div>
                <button type="button" className="ws-srcopt" onClick={() => pickLocal(srcMenu)}>
                  <span className="ic">⤓</span>
                  <span className="tx">
                    <b>本地上传</b>
                    <i>从你的电脑选择{lb}</i>
                  </span>
                </button>
                <button type="button" className="ws-srcopt" onClick={() => openAssets(srcMenu)}>
                  <span className="ic">▦</span>
                  <span className="tx">
                    <b>从资产库选取</b>
                    <i>选择已上传 / 已生成的{lb}</i>
                  </span>
                </button>
              </div>
            </div>
          );
        })()}

      {/* 资产库弹窗：复用整个资产页 UI 作为选择器，按槽类型默认到对应筛选 */}
      {assetPick &&
        (() => {
          const kind = slotTypeOf(assetPick);
          return (
            <div className="ws-srcmask" onClick={() => setAssetPick(null)}>
              <div className="ws-assetbox" onClick={(e) => e.stopPropagation()}>
                <div className="ws-assetbox-h">
                  <span>从资产库选取</span>
                  <button type="button" aria-label="关闭" onClick={() => setAssetPick(null)}>
                    ✕
                  </button>
                </div>
                <div className="ws-assetbox-body">
                  <AssetsBrowser
                    pickMode
                    onPick={chooseAsset}
                    defaultFilter={kind}
                    defaultTab={kind === "audio" ? "upload" : "hist"}
                  />
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
