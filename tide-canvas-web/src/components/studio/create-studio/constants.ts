/* 创作台 CreateStudio 的常量 — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   CREATE_MODELS 原在 src/mock/models.ts：它是模型接口（marketApi.studioModels）
   不可用/返回空时模型下拉的本地兜底列表，真数据源始终是后端接口；按任务要求
   作为带类型常量落到本地，消除对 src/mock 的 import。 */

import type { ArtworkType, ModelMeta, SlotDef, ToolCfg, ToolKey } from "./types";

/* ── constants (ported 1:1 from create.js) ───────────────────────────────── */

export const RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;
export const IMG_RES = ["1K", "2K", "4K"] as const;
export const VIDEO_RES = ["720p", "1080p", "4K"] as const;
export const VIDEO_DUR = ["5s", "10s", "15s"] as const;

export const QUALITY_LABEL: Record<string, string> = { low: "低画质", medium: "标准画质", high: "高画质" };

export const IMG_RES_COST: Record<string, number> = { "1K": 8, "2K": 14, "4K": 30 };
export const RES_COST: Record<string, number> = { "720p": 30, "1080p": 50, "4K": 90 };
export const DUR_SEC: Record<string, number> = { "5s": 5, "10s": 10, "15s": 15 };

export const IDEAS = [
  "赛博朋克城市夜景，霓虹倒影，电影感，8K",
  "青绿山水工笔，石青石绿设色，宋代院体",
  "液态金属机器人，纯白工作室布光，C4D 渲染",
  "黄昏侧颜人像，85mm f/1.4，柯达胶片颗粒",
  "深海发光水母，慢镜头，4K 微距，蓝紫光束",
] as const;

/** Model picker options shown inside the studio / create flow.
 *  本地兜底：仅当后端模型接口（marketApi.studioModels）失败或返回空时使用，
 *  保证面板可用（内容与原 src/mock 的 CREATE_MODELS 一致）。 */
export const CREATE_MODELS: string[] = [
  "GPT Image 2", "Flux.1 Pro", "Midjourney v6", "Nano Banana 2", "SDXL Lightning",
  "即梦 3.0", "Seedance 2.0", "可灵 Kling 1.6",
];

export const TOOLS: Record<ToolKey, ToolCfg> = {
  t2i: { mode: "t2i", label: "文生图", head: "生成图片", drop: false, ph: "描述你想要的画面，越具体越好…\n例：赛博朋克城市夜景，霓虹倒影，电影感，8K 超写实" },
  i2i: { mode: "i2i", label: "图生图", head: "图生图", drop: true, ph: "上传参考图，再描述想要的改动…\n例：保留构图，改成赛博朋克霓虹风格" },
  edit: { mode: "i2i", label: "改图", head: "改图 · 扩图", drop: true, ph: "上传图片，描述要修改或扩展的部分…\n例：把背景扩展为开阔的雪山草原" },
  t2v: { mode: "t2v", label: "文生视频", head: "生成视频", drop: false, ph: "描述镜头与运动…\n例：金色麦田，强风掠过，慢镜头航拍，电影调色" },
  i2v: { mode: "t2v", label: "图生视频", head: "图生视频", drop: true, ph: "上传首帧图片，再描述运动…\n例：人物缓缓回头，发丝随风飘动，电影质感" },
  flf: { mode: "t2v", label: "首尾帧", head: "首尾帧生成", drop: true, ph: "上传首帧与尾帧，描述过渡…\n例：从清晨到日落的平滑时间流逝" },
  ref: { mode: "t2v", label: "全能参考", head: "全能参考", drop: true, ph: "上传参考图（人物 / 风格 / 动作），描述想要的视频…\n例：参考人物形象，生成其在雪山奔跑的镜头" },
  t2a: { mode: "t2a", label: "音乐生成", head: "生成音乐", drop: false, ph: "描述你想要的音乐，Suno 会自动谱曲写词…\n例：温柔的中文民谣，木吉他伴奏，关于夏天傍晚的回忆" },
  sfx: { mode: "t2a", label: "音效生成", head: "生成音效", drop: false, ph: "描述你想要的音效，越具体越好…\n例：雨打铁皮屋顶，远处传来低沉的雷声" },
};

export const MODES_BY_TYPE: Record<ArtworkType, ToolKey[]> = {
  image: ["t2i", "i2i"],
  video: ["t2v", "i2v", "flf", "ref"],
  audio: ["t2a", "sfx"],
};

export const UPLOADS: Partial<Record<ToolKey, SlotDef[]>> = {
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

export const MODEL_META: Record<string, ModelMeta> = {
  "GPT Image 2": { tag: "HD", by: "OpenAI", desc: "万能画风 · 超清细节" },
  "Flux.1 Pro": { tag: "PRO", by: "Black Forest", desc: "写实质感 · 精准构图" },
  "Midjourney v6": { tag: "ART", by: "Midjourney", desc: "艺术氛围 · 电影光影" },
  "Nano Banana 2": { tag: "NEW", by: "Google", desc: "极速出图 · 风格百变" },
  "SDXL Lightning": { tag: "4×", by: "Stability", desc: "秒级生成 · 开源高效" },
  "即梦 3.0": { tag: "CN", by: "字节跳动", desc: "中文语义 · 国风擅长" },
  "Seedance 2.0": { tag: "VID", by: "字节跳动", desc: "视听双绝 · 镜头流畅" },
  "可灵 Kling 1.6": { tag: "VID", by: "快手", desc: "长镜头 · 物理真实" },
};

export const DEFAULT_META: ModelMeta = { tag: "AI", by: "模型", desc: "高质量生成" };

/** 音乐风格预设（2026-07-17 由自由输入改为点选多选）：值用 Suno 识别度最高的
 *  英文 tag，界面展示中文；选中项逗号拼接进 tags。历史记录恢复的手填旧值不在
 *  预设中时原样保留发送，仅不高亮。 */
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

/** map a config mode value (t2i/i2i/t2v/i2v/keyframe/omni_ref) to a studio ToolKey. */
export const MODE_TO_TOOL: Record<string, ToolKey> = {
  t2i: "t2i",
  i2i: "i2i",
  t2v: "t2v",
  i2v: "i2v",
  keyframe: "flf",
  omni_ref: "ref",
  t2a: "t2a",
  sfx: "sfx",
};

/** studio ToolKey → backend generation handler name (internal/handler/ai handlerRegistry). */
export const TOOL_TO_HANDLER: Record<ToolKey, string> = {
  t2i: "text_to_image",
  i2i: "image_to_image",
  edit: "image_to_image",
  t2v: "text_to_video",
  i2v: "image_to_video",
  flf: "start_end_to_video",
  ref: "reference_to_video",
  t2a: "text_to_audio",
  sfx: "text_to_audio",
};

/** backend generation handler → media type for 生成历史 cards. */
export const HIST_HANDLER_TYPE: Record<string, ArtworkType> = {
  text_to_image: "image",
  image_to_image: "image",
  text_to_video: "video",
  image_to_video: "video",
  start_end_to_video: "video",
  reference_to_video: "video",
  text_to_audio: "audio",
  // one-click image-edit ops (per-result toolbar)
  remove_bg: "image",
  remove_object: "image",
  upscale: "image",
  outpaint: "image",
};

/** backend generation handler → studio ToolKey (reverse of TOOL_TO_HANDLER). */
export const HIST_HANDLER_TOOL: Record<string, ToolKey> = {
  text_to_image: "t2i",
  image_to_image: "i2i",
  text_to_video: "t2v",
  image_to_video: "i2v",
  start_end_to_video: "flf",
  reference_to_video: "ref",
  text_to_audio: "t2a",
  // edit ops restore into the 改图 tool (i2i family)
  remove_bg: "edit",
  remove_object: "edit",
  upscale: "edit",
  outpaint: "edit",
};

/** one-click edit op → its backend handler name (per-result toolbar buttons). */
export const EDIT_OP_HANDLER: Record<string, string> = {
  rmbg: "remove_bg",
  rmobj: "remove_object",
  hd: "upscale",
  expand: "outpaint",
};

/** localStorage key of the persisted in-flight run (refresh-resume). */
export const ACTIVE_RUN_KEY = "studio_active_run";

/** In-flight Studio pointers are account-private. A shared browser must never
 * let the next signed-in account resume or clear the previous account's task. */
export function activeRunStorageKey(ownerUserId: string): string {
  return `${ACTIVE_RUN_KEY}:${encodeURIComponent(ownerUserId.trim())}`;
}
