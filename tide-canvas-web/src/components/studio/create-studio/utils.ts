/* 创作台 CreateStudio 的纯函数工具 — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   只依赖 types/constants 与 lib 类型，不含 React / 组件状态。 */

import type { StudioModelVO } from "@/lib/market-api";
import type { ModelConfig } from "@/types/admin-models";
import { AiTaskStatus, type AiTaskVO } from "@/types/ai";
import {
  DEFAULT_META,
  HIST_HANDLER_TOOL,
  HIST_HANDLER_TYPE,
  MODEL_META,
} from "./constants";
import type {
  ArtworkType,
  HistItem,
  MeshHues,
  MetaTrack,
  ModelMeta,
  MusicMode,
  RunParams,
  SlotData,
  SlotDef,
  SlotType,
  ThreeDAsset,
  ThreeDViewImage,
  ThreeDViewType,
  ToolKey,
} from "./types";

/** derive a ModelMeta for a studio model purely from its model-management config:
 *  the right-side tag shows 预计耗时 only——积分不在选择器里显示（用户定稿
 *  2026-07-14：消耗已在「立即生成 · N 积分」按钮上呈现，选择器满屏积分是噪音），
 *  没有耗时就不渲染徽标；the subtitle is the 描述 (or capabilities when no
 *  description is set). */
export function metaOfStudio(m: StudioModelVO): ModelMeta {
  const c = m.config;
  const est = c?.estSeconds ?? 0;
  return {
    tag: est > 0 ? `~${est}s` : "",
    by: "",
    desc: m.desc || (c?.capabilities?.length ? c.capabilities.join(" · ") : "高质量生成"),
  };
}

/** 音频模型归属页签：后台配置 modes 含 sfx → 音效生成；显式配了 t2a → 音乐生成；
 *  都没配时按 modelKey 里的 sfx 兜底（中转站同步下来未配置的新模型也能归对）。 */
export function audioToolOf(m: StudioModelVO): ToolKey {
  const modes = m.config?.modes ?? [];
  if (modes.includes("sfx")) return "sfx";
  if (modes.includes("t2a")) return "t2a";
  return /sfx/i.test(m.modelKey ?? "") ? "sfx" : "t2a";
}

/** display label for a ratio value (auto → 自适应). */
export function ratioLabel(r: string): string {
  return r === "auto" ? "自适应" : r;
}

/** display label for a resolution/clarity value（auto → 自适应，其余大写）。 */
export function resolutionLabel(r: string): string {
  return r === "auto" ? "自适应" : r.toUpperCase();
}

/** 清晰度/分辨率的展示排序权重：auto 最前，随后按像素规模升序
 *  （K 档 ×1000：480p < 720p < 1080p < 1K < 2K < 4K）。上游同步预填的配置
 *  顺序常是乱的（720p/480p/1080p），展示层统一排齐；识别不了的值权重
 *  最大，靠 sort 稳定性维持原有相对顺序。 */
export function resolutionRank(value: string): number {
  const s = value.trim().toLowerCase();
  if (s === "auto") return -1;
  const m = /^(\d+(?:\.\d+)?)(k)?/.exec(s);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseFloat(m[1]) * (m[2] ? 1000 : 1);
}

/** meta lookup by display name, optionally backed by the real models map. */
export function metaOf(name: string, metaMap?: Record<string, ModelMeta>): ModelMeta {
  return metaMap?.[name] || MODEL_META[name] || DEFAULT_META;
}

/** stable hue seed from a prompt (create.js generate()). */
export function promptHue(prompt: string): number {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) h = (h * 31 + prompt.charCodeAt(i)) % 360;
  return h;
}

/** deterministic mesh-hue triplet from a string id (cover fallback when no url). */
export function huesFromId(id: string): MeshHues {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return [h, (h + 80) % 360, (h + 200) % 360];
}

export function isHttpUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//.test(u.trim());
}

/** RFC3339 / ISO timestamp → "YYYY.MM.DD HH:mm" for the feed run header. */
export function fmtTs(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** deterministic reference-thumb gradient (create.js refGrad). */
export function refGrad(seed: number): string {
  const h = (seed * 61 + 30) % 360;
  return `linear-gradient(135deg, hsl(0 0% ${24 + (h % 16)}%), hsl(0 0% ${12 + (h % 10)}%))`;
}

/** background value for a slot thumbnail: a real URL → cover image, else the
 *  gradient string is used as-is. */
export function thumbBg(g?: string): string {
  if (!g) return "var(--surface-2)";
  // blob: = 上传中占位的本地预览(URL.createObjectURL)
  return /^(https?:|data:|blob:)/.test(g) ? `center / cover no-repeat url("${g}")` : g;
}

/** parse a stored task input (object or JSON string) into a plain record. */
export function parseTaskInput(input: unknown): Record<string, unknown> {
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
export function paramsFromTask(handler: string, modelName: string, input: unknown, modelId?: string): RunParams {
  const inp = parseTaskInput(input);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v ?? ""), 10) || 0);
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
  const type: ArtworkType = HIST_HANDLER_TYPE[handler] ?? "image";
  // 视频超分的档位键是 targetResolution(该接口不收 clarity/resolution),
  // 不认它历史卡会一律显示默认 1080p，与实际提交的档位对不上。
  const isUpscale = handler === "video_upscale";
  const reso =
    str(inp.clarity) || str(inp.resolution) || str(inp.targetResolution) || str(inp.target_resolution);
  // 参考素材：任务 input 里持久化了 imageList/sourceImage 等，取回来恢复上传槽位。
  const imageRefs = strArr(inp.imageList);
  if (!imageRefs.length && str(inp.sourceImage)) imageRefs.push(str(inp.sourceImage));
  if (!imageRefs.length && str(inp.imageUrl)) imageRefs.push(str(inp.imageUrl));
  if (!imageRefs.length && str(inp.image_url)) imageRefs.push(str(inp.image_url));
  const rawViews = Array.isArray(inp.multiViewImages)
    ? inp.multiViewImages
    : Array.isArray(inp.multi_view_images)
      ? inp.multi_view_images
      : [];
  const validViews = new Set<ThreeDViewType>([
    "front", "left", "right", "back", "top", "bottom", "left_front", "right_front",
  ]);
  const multiViewImages: ThreeDViewImage[] = rawViews.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const viewType = str(row.viewType) || str(row.view_type);
    const viewImageUrl = str(row.viewImageUrl) || str(row.view_image_url);
    return validViews.has(viewType as ThreeDViewType) && viewImageUrl
      ? [{ viewType: viewType as ThreeDViewType, viewImageUrl }]
      : [];
  });
  return {
    prompt: str(inp.prompt),
    model: modelName,
    ...(modelId ? { modelId } : {}),
    // 音频共用 text_to_audio handler，音效模型的历史按名称归回音效页签。
    tool:
      handler === "generate_3d"
        ? multiViewImages.length
          ? "mv2_3d"
          : imageRefs.length
            ? "i2_3d"
            : "t2_3d"
      : handler === "text_to_audio" && /sfx|音效/i.test(modelName)
        ? "sfx"
        : (HIST_HANDLER_TOOL[handler] ?? "t2i"),
    curType: type,
    // 音频无画面比例——留空，否则历史里的音频卡会顶着一枚假 "1:1" 徽标。
    // 超分同理：画面比例由源视频决定，任务入参里根本没有这一项。
    ratio:
      type === "audio" || type === "3d" || isUpscale
        ? ""
        : str(inp.aspectRatio) || str(inp.aspect_ratio) || str(inp.ratio) || "1:1",
    imgRes: type === "image" ? reso || "2K" : "2K",
    res: type === "video" ? reso || "1080p" : "1080p",
    dur: str(inp.duration) || "5s",
    quality: str(inp.quality),
    count: Math.max(1, num(inp.batchCount) || 1),
    ...(str(inp.skillId) ? { skill: { id: str(inp.skillId) } } : {}),
    imageRefs,
    firstFrame: str(inp.firstFrame) || undefined,
    lastFrame: str(inp.lastFrame) || undefined,
    videoRefs: strArr(inp.videoReferences),
    audioRefs: strArr(inp.audioReferences),
    multiViewImages,
    enablePbr: inp.enablePbr === true || inp.enable_pbr === true || undefined,
    faceCount: num(inp.faceCount) || num(inp.face_count) || undefined,
    generateType:
      str(inp.generateType) === "Geometry" || str(inp.generate_type) === "Geometry"
        ? "Geometry"
        : type === "3d"
          ? "Normal"
          : undefined,
    resultFormat: (() => {
      const value = (str(inp.resultFormat) || str(inp.result_format)).toUpperCase();
      return value === "STL" || value === "USDZ" || value === "FBX" ? value : undefined;
    })(),
    lyrics: str(inp.lyrics) || undefined,
    songStyle: str(inp.tags) || undefined,
    songTitle: str(inp.title) || undefined,
    instrumental: inp.makeInstrumental === true || undefined,
    ...(type === "audio"
      ? (() => {
          // 延长/翻唱的任务参数在 input.extras 里；据此反推创作模式与原曲引用。
          const ex =
            inp.extras && typeof inp.extras === "object"
              ? (inp.extras as Record<string, unknown>)
              : {};
          const task = str(ex.task);
          const mode: MusicMode =
            task === "extend" || task === "cover" ? task
            : task === "upload_extend" ? "extend" // 上传音频的延长,恢复为延长模式+上传标记
            : str(inp.lyrics) ? "custom" : "inspire";
          return {
            musicMode: mode,
            sourceClipId: str(ex.continue_clip_id) || str(ex.cover_clip_id) || undefined,
            sourceIsUpload: task === "upload_extend" || undefined,
            continueAt: num(ex.continue_at) || undefined,
          };
        })()
      : {}),
  };
}

/** resultMeta.tracks 的宽松解析（后端 provider_relay 写入的形状）。 */
export function tracksFromMeta(meta: unknown): MetaTrack[] {
  const raw = (meta as { tracks?: unknown })?.tracks;
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      clipId: s(o.clipId),
      title: s(o.title),
      url: s(o.url),
      coverUrl: s(o.coverUrl),
      duration: typeof o.duration === "number" && Number.isFinite(o.duration) ? o.duration : 0,
    };
  });
}

/** 3D result metadata is retained as one card with several downloadable formats. */
export function threeDAssetsFromMeta(meta: unknown): ThreeDAsset[] {
  const raw = (meta as { assets?: unknown })?.assets;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const value = (key: string) => typeof row[key] === "string" ? (row[key] as string).trim() : "";
    const url = value("url");
    if (!isHttpUrl(url)) return [];
    const type = (value("type") || "model").toLowerCase();
    const previewImageUrl = value("previewImageUrl") || value("preview_image_url");
    return [{ type, url, ...(isHttpUrl(previewImageUrl) ? { previewImageUrl } : {}) }];
  });
}

/** slot key → 槽位媒体类型（缺省按图片处理，与原实现一致）。 */
export function slotTypeOf(slots: SlotDef[] | null, k: string): SlotType {
  return slots?.find((s) => s.k === k)?.type ?? "image";
}

// reference-asset limits configured per mode in 模型管理 (0 / unset = no limit):
//   i2i 图生图 → top-level maxRefImages/maxRefImageSizeMB
//   i2v 图生视频 → refLimits i2v.*
//   ref 全能参考 → refLimits omniRef.{image|video|audio}*
// (flf 首尾帧 uses fixed first/last boxes, so its config isn't applied here.)
export function refLimitFor(mCfg: ModelConfig | null, tool: ToolKey, s: SlotDef): { count: number; size: number } {
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
}

export function slotMax(mCfg: ModelConfig | null, tool: ToolKey, s: SlotDef): number {
  const { count } = refLimitFor(mCfg, tool, s);
  return count > 0 ? count : s.max;
}

export function slotHint(mCfg: ModelConfig | null, tool: ToolKey, s: SlotDef): string {
  const { size } = refLimitFor(mCfg, tool, s);
  if (size <= 0) return s.hint;
  const unit = s.type === "image" ? "单张" : s.type === "video" ? "单段视频" : "单段音频";
  return `${s.hint} · ${unit} ≤ ${size}MB`;
}

/* gather reference thumbnails for the result header (create.js rhRefThumbs). */
export function refThumbsForRun(slotData: SlotData, seed: number): string[] {
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
        return `linear-gradient(135deg, hsl(0 0% ${26 + (h % 14)}%), hsl(0 0% ${12 + (h % 10)}%))`;
      });
  return out.slice(0, 4);
}

/* monotonically increasing id for locally-pushed history items. Kept at module
   scope (as in the original file) so ids stay unique across hooks/components.
   Computed OUTSIDE state updaters: an updater must be pure, and React dev
   double-invokes it — mutating this counter inside produced duplicate keys. */
let histSeq = 0;

export function nextHistId(): string {
  histSeq += 1;
  return `h-${histSeq}`;
}

/** Convert the user's REAL generation tasks (aiApi.listTasks) into feed items:
 *  each successful task with a result URL becomes one or more cards; failed
 *  tasks become a single reason card so they do not disappear from history. */
export function histItemsFromTasks(records: AiTaskVO[]): HistItem[] {
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
    const assets = threeDAssetsFromMeta(meta);
    if (!urls.length && isHttpUrl(t.resultUrl)) urls = [t.resultUrl];
    if (!urls.length && assets.length) urls = assets.map((asset) => asset.url);
    const mappedType = HIST_HANDLER_TYPE[t.handler];
    const type = mappedType ?? "image";
    const params = paramsFromTask(t.handler, t.modelName || "", t.input, t.modelId);
    // Suno 分轨明细：clip_id 供延长/翻唱引用，trackTitle 是 Suno 起的歌名。
    const tracks = tracksFromMeta(meta);
    // 上传登记任务(extras.task=upload)产出的 clip:延长时须发 upload_extend,打标传给候选
    const clipUpload = (() => {
      const raw = t.input;
      const obj = typeof raw === "string"
        ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } })()
        : (raw as Record<string, unknown> | null) ?? {};
      const ex = obj.extras;
      return !!ex && typeof ex === "object" && (ex as Record<string, unknown>).task === "upload";
    })();
    const title = params.prompt
      ? params.prompt.slice(0, 14) + (params.prompt.length > 14 ? "…" : "")
      : t.modelName || "我的创作";
    const failed = t.status === AiTaskStatus.FAILED;
    const missingResult = t.status === AiTaskStatus.SUCCESS && !urls.length;
    if (failed || missingResult) {
      // noProject history can also contain non-media text tasks. Those used to
      // disappear naturally because they have no URL; do not relabel them as a
      // failed AI image now that URL-less media failures are intentionally shown.
      if (!mappedType) continue;
      items.push({
        id: `task-${t.id}-failed`,
        run: `task-${t.id}`,
        // Keep the same creation-time ordering as successful and in-flight runs.
        ts: t.createTime,
        ratio: params.ratio,
        hues: huesFromId(`${t.id}-failed`),
        type,
        title,
        prompt: params.prompt,
        model: t.modelName || "",
        status: "failed",
        errorMsg: failed
          ? t.errorMsg?.trim() || "生成服务未返回具体失败原因，请稍后重试"
          : "任务已完成，但生成结果文件不可用",
        params,
      });
      continue;
    }
    // A provider can populate a provisional URL before the task reaches a
    // terminal state. Never render processing/cancelled rows as successful
    // history merely because such a URL is present.
    if (t.status !== AiTaskStatus.SUCCESS) continue;

    if (type === "3d") {
      const primary = isHttpUrl(t.resultUrl)
        ? t.resultUrl
        : assets.find((asset) => asset.type === "glb")?.url || assets[0]?.url || urls[0];
      items.push({
        id: `task-${t.id}-3d`,
        run: `task-${t.id}`,
        ts: t.createTime,
        ratio: "",
        hues: huesFromId(`${t.id}-3d`),
        type,
        title,
        prompt: params.prompt,
        model: t.modelName || "",
        url: primary,
        assets,
        previewImageUrl: assets.find((asset) => asset.previewImageUrl)?.previewImageUrl,
        status: "success",
        params,
      });
      continue;
    }
    urls.forEach((url, idx) =>
      items.push({
        id: `task-${t.id}-${idx}`,
        run: `task-${t.id}`,
        ts: t.createTime,
        ratio: params.ratio,
        hues: huesFromId(`${t.id}-${idx}`),
        type,
        title: tracks[idx]?.title || title,
        prompt: params.prompt,
        model: t.modelName || "",
        url,
        status: "success",
        clipId: tracks[idx]?.clipId || undefined,
        clipUpload: clipUpload || undefined,
        trackTitle: tracks[idx]?.title || undefined,
        trackCover: tracks[idx]?.coverUrl || undefined,
        trackDur: tracks[idx]?.duration || undefined,
        params,
      }),
    );
  }
  return items;
}
