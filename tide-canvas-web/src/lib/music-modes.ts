/* 音乐四创作模式（Suno）的共享逻辑：chat 页与画布音频节点复用，口径与创作台
   create-studio 完全一致（灵感=只发描述；自定义=歌词必填、描述不发；延长/翻唱=
   原曲 clip 必选、经 extras 传 task 与 clip_id）。创作台自有实现暂不合并，
   三处的请求形状以本文件注释为准。 */

import { aiApi, uploadFileSmart } from "@/lib/api";
import type { AiTaskVO } from "@/types/ai";
import { AiTaskStatus } from "@/types/ai";

export type MusicMode = "inspire" | "custom" | "extend" | "cover";

export const MUSIC_MODES: Array<{ v: MusicMode; l: string }> = [
  { v: "inspire", l: "灵感模式" },
  { v: "custom", l: "自定义歌词" },
  { v: "extend", l: "延长" },
  { v: "cover", l: "翻唱" },
];

/** 音乐风格预设：值用 Suno 识别度最高的英文 tag，界面展示中文（与创作台一致）。 */
export const AUDIO_STYLES: Array<{ v: string; l: string }> = [
  { v: "pop", l: "流行" },
  { v: "folk", l: "民谣" },
  { v: "rock", l: "摇滚" },
  { v: "electronic", l: "电子" },
  { v: "hip-hop", l: "嘻哈" },
  { v: "r&b", l: "R&B" },
  { v: "jazz", l: "爵士" },
  { v: "ballad", l: "抒情" },
  { v: "chinese traditional", l: "古风" },
  { v: "cinematic", l: "电影感" },
];

/** 模型是否音效（SFX）：后台「生成方式」勾选 sfx，或 modelKey 兜底。 */
export function isSfxModel(modelKey?: string, modes?: string[] | null): boolean {
  if (modes?.includes("sfx")) return true;
  return /sfx/i.test(modelKey ?? "");
}

export interface MusicParams {
  musicMode: MusicMode;
  lyrics: string;
  /** 已选风格 tag 列表，逗号拼接进 tags */
  songStyles: string[];
  songTitle: string;
  instrumental: boolean;
  sourceClipId: string;
  /** 原曲是否来自「上传登记」的本地音频:延长时上游要求 task=upload_extend
      (站内生成的歌用 extend);翻唱两种来源都是 cover。 */
  sourceIsUpload: boolean;
  /** 延长起点秒数（字符串承载输入框） */
  continueAt: string;
}

export const DEFAULT_MUSIC_PARAMS: MusicParams = {
  musicMode: "inspire",
  lyrics: "",
  songStyles: [],
  songTitle: "",
  instrumental: false,
  sourceClipId: "",
  sourceIsUpload: false,
  continueAt: "",
};

/** 发送前校验。返回 null = 通过，否则为给用户看的提示文案。 */
export function validateMusicParams(prompt: string, p: MusicParams): string | null {
  if (p.musicMode === "custom" && !p.lyrics.trim()) return "自定义歌词模式需先填写歌词 ✦";
  if (p.musicMode === "extend" && !p.sourceClipId) return "延长模式需先选择原曲 ✦";
  if (p.musicMode === "cover" && !p.sourceClipId) return "翻唱模式需先选择原曲 ✦";
  // 灵感模式只看描述（歌词字段不参与生成，不能作为放行依据）。
  if (p.musicMode === "inspire" && !prompt.trim()) return "先写一句音乐描述 ✦";
  return null;
}

/** 组装 text_to_audio 的 input（与创作台 generate() 的音频分支同构）。 */
export function buildMusicInput(prompt: string, p: MusicParams): Record<string, unknown> {
  const isTask = p.musicMode === "extend" || p.musicMode === "cover";
  const lyrics = p.musicMode !== "inspire" ? p.lyrics.trim() : "";
  const tags = p.songStyles.join(", ").trim();
  const title = p.songTitle.trim();
  const continueAt = parseInt(p.continueAt, 10);
  return {
    ...(prompt.trim() && p.musicMode === "inspire" ? { prompt: prompt.trim() } : {}),
    ...(lyrics ? { lyrics } : {}),
    ...((lyrics || isTask) && tags ? { tags } : {}),
    ...((lyrics || isTask) && title ? { title } : {}),
    ...(p.instrumental ? { makeInstrumental: true } : {}),
    ...(isTask
      ? {
          extras:
            p.musicMode === "extend"
              ? {
                  // 上传登记的本地音频延长走 upload_extend(上游对两种来源分开建模)
                  task: p.sourceIsUpload ? "upload_extend" : "extend",
                  continue_clip_id: p.sourceClipId,
                  ...(continueAt > 0 ? { continue_at: continueAt } : {}),
                }
              : { task: "cover", cover_clip_id: p.sourceClipId },
        }
      : {}),
  };
}

export interface MusicTrack {
  clipId: string;
  title: string;
  url: string;
  /** Suno 生成的歌曲封面（上游原始 CDN，未回存） */
  coverUrl: string;
  /** 时长(秒)，上游给的；0 = 未知 */
  duration: number;
}

/** resultMeta.tracks 的宽松解析（后端 provider_relay 写入的形状）。 */
export function tracksFromMeta(meta: unknown): MusicTrack[] {
  const raw = (meta as { tracks?: unknown } | null | undefined)?.tracks;
  if (!Array.isArray(raw)) return [];
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((o) => ({
      clipId: s(o.clipId),
      title: s(o.title),
      url: s(o.url),
      coverUrl: s(o.coverUrl),
      duration: typeof o.duration === "number" && Number.isFinite(o.duration) ? o.duration : 0,
    }));
}

function parseMeta(meta: AiTaskVO["resultMeta"]): Record<string, unknown> {
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) || {};
    } catch {
      return {};
    }
  }
  return meta && typeof meta === "object" ? meta : {};
}

export interface ClipOption {
  clipId: string;
  label: string;
  /** 原曲所用模型的行 id(AiModelVO.id;旧任务可能为空)。上游把延长/翻唱任务
      钉到原曲的路由,发到别的模型卡可能失败——消费方据此把模型选回原曲那张。 */
  modelId: string;
  /** 原曲所用模型名(展示/兜底匹配用) */
  modelName: string;
  /** 分轨试听地址(选择器内试听区分同名歌) */
  url: string;
  /** Suno 歌曲封面(上游 CDN,可能为空) */
  coverUrl: string;
  /** 时长秒;0 = 未知 */
  duration: number;
  /** 所属生成任务的创建时间(ISO) */
  createTime: string;
  /** 同一次生成内的第几首(1 起);Suno 一次两首同名,靠它区分 */
  trackNo: number;
  /** 同一次生成共几首 */
  trackCount: number;
  /** 来自「上传登记」的本地音频(extras.task=upload):延长须用 upload_extend */
  isUpload?: boolean;
}

/** 在可选模型里找到原曲所用的那张模型卡:行 id 精确匹配优先,行 id 失配(旧任务
    缺字段等)时按名称兜底;都找不到(模型已下架)返回 null。
    泛型以兼容画布(AiModelVO)与对话页(StudioModelVO)两种模型列表形状。 */
export function findClipModel<T extends { id: string; name: string }>(
  models: T[],
  opt: ClipOption,
): T | null {
  return (
    (opt.modelId ? models.find((m) => m.id === opt.modelId) : undefined) ??
    (opt.modelName ? models.find((m) => m.name === opt.modelName) : undefined) ??
    null
  );
}

/** 原曲触发按钮的展示标签:同批多首附「第 N 首」;历史选中项不在候选里
    (超出分页/已删)回显「历史原曲」;未选为占位文案。 */
export function clipDisplayLabel(opts: ClipOption[] | null, clipId: string): string {
  const sel = (opts ?? []).find((o) => o.clipId === clipId);
  if (sel) return sel.trackCount > 1 ? `${sel.label} · 第 ${sel.trackNo} 首` : sel.label;
  return clipId ? "历史原曲" : "选择一首你生成过的歌";
}

/** 延长/翻唱的原曲候选：拉用户音频生成历史，取带 clip_id 的分轨(新→旧，按 clip
    去重)。上游只认自己生成的歌，所以候选就是生成历史。 */
export async function fetchClipOptions(): Promise<ClipOption[]> {
  const res = await aiApi.listTasks({ pageNum: 1, pageSize: 100 }).catch(() => null);
  const records = res?.success && res.data ? res.data.records : [];
  const seen = new Set<string>();
  const out: ClipOption[] = [];
  for (const t of records) {
    if (t.handler !== "text_to_audio") continue;
    const meta = parseMeta(t.resultMeta);
    const tracks = tracksFromMeta(meta);
    // 上传登记任务(extras.task=upload)也在生成历史里,其 clip 可再次用于
    // 延长/翻唱,但延长时必须发 upload_extend——在候选上打标带给消费方。
    const input = parseMeta(t.input as AiTaskVO["resultMeta"]);
    const extras = input.extras && typeof input.extras === "object" ? input.extras as Record<string, unknown> : {};
    const isUpload = extras.task === "upload";
    tracks.forEach((tr, i) => {
      if (!tr.clipId || seen.has(tr.clipId)) return;
      seen.add(tr.clipId);
      const name = tr.title || (isUpload ? "上传的音频" : t.modelName || "未命名");
      out.push({
        clipId: tr.clipId,
        label: name.length > 24 ? name.slice(0, 24) + "…" : name,
        // idgen 把零值序列化成 "0"(旧任务无模型关联):归一为空,
        // 避免按 "0" 匹配失败后误报「模型已下架」
        modelId: t.modelId && t.modelId !== "0" ? t.modelId : "",
        modelName: t.modelName || "",
        url: tr.url,
        coverUrl: tr.coverUrl,
        duration: tr.duration,
        createTime: t.createTime || "",
        trackNo: i + 1,
        trackCount: tracks.length,
        ...(isUpload ? { isUpload: true } : {}),
      });
    });
  }
  return out;
}

/** 从模型 config(后端为 JSON 字符串,studio 侧已解析为对象)读「上传登记」
    单次积分;未配置/非法返回 0(服务端此时按常规生成价扣,前端同口径展示)。 */
export function uploadCostOf(config: unknown): number {
  let cfg: unknown = config;
  if (typeof cfg === "string") {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      return 0;
    }
  }
  if (!cfg || typeof cfg !== "object") return 0;
  const raw = (cfg as Record<string, unknown>).uploadCost;
  const n = typeof raw === "string" ? parseFloat(raw) : typeof raw === "number" ? raw : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 本地音频文件校验:上游只吃 mp3/wav。返回 null = 通过,否则为提示文案。 */
export function validateAudioFile(file: File): string | null {
  const okType = /^audio\/(mpeg|mp3|wav|x-wav|wave)$/i.test(file.type);
  const okExt = /\.(mp3|wav)$/i.test(file.name);
  if (!okType && !okExt) return "仅支持 mp3 / wav 音频文件";
  if (file.size > 50 * 1024 * 1024) return "音频文件不能超过 50MB";
  return null;
}

const REGISTER_POLL_INTERVAL = 3000;
const REGISTER_MAX_WAIT = 10 * 60 * 1000;

export type UploadClipStage = "uploading" | "registering";

/** 本地音频 → 可延长/翻唱的原曲(上游三步流的前两步):
    ① 传到本站存储拿公网 URL;② 以 extras {task:"upload", audio_url} 发起
    登记任务(独立计费,见模型 config.uploadCost);③ 轮询任务,成功后
    tracks[0].clipId 即该音频的 clip。返回可直接喂给 ClipPicker 选中态的
    ClipOption(isUpload=true);任何一步失败 throw Error(message)。
    登记任务须发到「之后做延长/翻唱的同一张模型卡」——clip 被钉在执行
    登记的上游路由上,generateModelId 由调用方传当前选中卡。 */
export async function uploadAndRegisterClip(opts: {
  file: File;
  /** 发给 generate 的模型标识(dto.modelId,即 AiModelVO.modelId / 模型名) */
  generateModelId: string;
  /** 当前模型卡的行 id/名称,回填 ClipOption 供锁卡与展示 */
  modelRowId?: string;
  modelName?: string;
  onStage?: (stage: UploadClipStage) => void;
}): Promise<ClipOption> {
  const { file, generateModelId, modelRowId, modelName, onStage } = opts;
  const invalid = validateAudioFile(file);
  if (invalid) throw new Error(invalid);

  onStage?.("uploading");
  const up = await uploadFileSmart(file);
  const audioUrl = up.success ? up.data?.fileUrl : undefined;
  if (!audioUrl || !/^https?:\/\//.test(audioUrl)) {
    throw new Error(up.message || "音频上传失败，请重试");
  }
  // 登记任务是付费任务,而上游要从公网拉取 audio_url——本地/内网存储地址
  // (本地开发环境)注定失败,在扣积分之前就地拦下。
  const host = (() => {
    try {
      return new URL(audioUrl).hostname;
    } catch {
      return "";
    }
  })();
  const privateHost =
    !host ||
    host === "localhost" ||
    host === "::1" ||
    /^127\.|^10\.|^0\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privateHost) {
    throw new Error("音频存储地址非公网可达（本地/内网环境），上游无法拉取，无法登记");
  }

  onStage?.("registering");
  const res = await aiApi.generate({
    handler: "text_to_audio",
    modelId: generateModelId,
    input: { extras: { task: "upload", audio_url: audioUrl } },
  });
  if (!res.success || !res.data?.id) {
    throw new Error(res.message || "上传登记请求失败");
  }

  const taskId = String(res.data.id);
  const deadline = Date.now() + REGISTER_MAX_WAIT;
  for (;;) {
    await new Promise((r) => setTimeout(r, REGISTER_POLL_INTERVAL));
    if (Date.now() > deadline) throw new Error("上传登记超时，请重试");
    const tr = await aiApi.getTask(taskId).catch(() => null);
    // 断网/瞬时 5xx 不判死,由整体超时兜底(与画布轮询同口径)
    if (!tr?.success || !tr.data) continue;
    const task = tr.data;
    if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
      throw new Error(task.errorMsg || "上传登记失败");
    }
    if (task.status !== AiTaskStatus.SUCCESS) continue;
    const track = tracksFromMeta(parseMeta(task.resultMeta)).find((x) => x.clipId);
    if (!track) throw new Error("上传登记结果缺少 clip，请重试");
    const label = file.name.replace(/\.(mp3|wav)$/i, "");
    return {
      clipId: track.clipId,
      label: label.length > 24 ? label.slice(0, 24) + "…" : label || "上传的音频",
      modelId: modelRowId || "",
      modelName: modelName || "",
      url: track.url || audioUrl,
      coverUrl: track.coverUrl,
      duration: track.duration,
      createTime: new Date().toISOString(),
      trackNo: 1,
      trackCount: 1,
      isUpload: true,
    };
  }
}
