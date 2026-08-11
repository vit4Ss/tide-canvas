/* ============================================================================
   智能工具的前端共享目录 — 出厂兜底数据 + 处理器标签。

   数据的权威来源是后台「工具管理」(GET /api/ai/tools,服务端
   model.CanonicalAiTools 播种);这里只是接口未应答/失败时的出厂兜底,
   字段值与服务端 CanonicalAiTools 保持一致。

   消费方:
     - app/(studio)/tools/tools-hub.tsx   工具中心页(入口卡兜底 + 作品标签)
     - app/tools/[op]/page.tsx            独立处理页(FALLBACK_OPS 由此派生)
     - components/canvas/canvas-history-panel.tsx  历史面板的预设工具标签
   ========================================================================== */

/** 工具处理的素材形态,决定工具页收什么文件、用哪类模型。 */
export type ToolType = "image" | "video";

export interface FallbackToolDef {
  /** URL slug,独立页为 /tools/<key>(与 ai_tools.key 一致)。 */
  key: string;
  title: string;
  desc: string;
  /** 后端生成处理器名(handlerRegistry)。 */
  handler: string;
  type: ToolType;
  /** 字形图标,如 ⤢。 */
  icon: string;
  /** 可选固定图片封面；出厂数据留空，兼容既有数据库记录。 */
  coverUrl?: string;
  /** mesh 封面色相三元组。 */
  cover: [number, number, number];
  /** 偏好 4K 模型(高清放大)。 */
  hd?: boolean;
  /** 需要用户输入一句修改描述(局部重绘)。 */
  needPrompt?: boolean;
  placeholder?: string;
  /** 额外生成参数——随请求原样下发(计费按这些原始入参解析)。 */
  extra?: Record<string, unknown>;
}

/** 视频超分的目标分辨率档位(relay /v1/video/upscale;ByteDance 模型不支持 720p,
    由上游按模型校验)。工具页据此渲染档位选择。 */
export const UPSCALE_RESOLUTIONS = ["720p", "1080p", "2k", "4k"] as const;

export const TOOL_TYPE_LABEL: Record<ToolType, string> = {
  image: "图片",
  video: "视频",
};

/** 出厂工具,按 CanonicalAiTools 的 SortOrder 排列。 */
export const FALLBACK_TOOLS: FallbackToolDef[] = [
  {
    key: "expand",
    title: "智能扩图",
    desc: "Outpainting 无缝向外补全画面。",
    handler: "outpaint",
    type: "image",
    icon: "⤢",
    cover: [28, 48, 8],
  },
  {
    key: "inpaint",
    title: "局部重绘",
    desc: "上传图片并描述想修改的部分，AI 精准重绘。",
    handler: "image_to_image",
    type: "image",
    icon: "✎",
    cover: [330, 286, 12],
    needPrompt: true,
    placeholder: "描述要修改的部分…\n例：把天空换成日落晚霞，保持其余不变",
  },
  {
    key: "rmbg",
    title: "一键抠图",
    desc: "智能移除背景与对象，输出干净主体。",
    handler: "remove_bg",
    type: "image",
    icon: "⬡",
    cover: [95, 140, 70],
  },
  {
    key: "upscale",
    title: "高清放大",
    desc: "无损放大图片尺寸，智能重塑高清画质。",
    handler: "upscale",
    type: "image",
    icon: "⤡",
    cover: [255, 230, 290],
    hd: true,
    extra: { resolution: "4k", clarity: "4k", quality: "high" },
  },
  {
    key: "rmobj",
    title: "物体移除",
    desc: "移除画面中的杂物、路人、文字与瑕疵。",
    handler: "remove_object",
    type: "image",
    icon: "⌫",
    cover: [200, 230, 170],
  },
  {
    key: "relight",
    title: "智能打光",
    desc: "影视级重新打光，增强画面层次与氛围。",
    handler: "relight",
    type: "image",
    icon: "◐",
    cover: [40, 60, 260],
    extra: { quality: "high" },
  },
  {
    key: "vupscale",
    title: "视频超分",
    desc: "提升视频分辨率与清晰度，最高 4K。",
    handler: "video_upscale",
    type: "video",
    icon: "◆",
    cover: [205, 190, 240],
    extra: { targetResolution: "1080p" },
  },
];

/** 清理接口返回的封面池：去空白、忽略异常类型并按首次出现去重。 */
export function normalizeToolCoverPool(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const covers: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const url = value.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    covers.push(url);
  }
  return covers;
}

/** 统一解析智能工具封面。
 *
 * 后台配置的固定图片优先；旧数据没有 coverUrl 时，按稳定的工具 key 从首页
 * 公开作品池取图，保证首页、工具中心和独立工具页显示一致。公开作品为空时
 * 返回空串，由调用方保留原有 mesh 封面。未知 key 使用稳定字符串哈希，避免
 * 后续新增工具全部挤到同一张图。 */
export function resolveToolCoverUrl(
  key: string,
  configured: string | null | undefined,
  pool: readonly string[],
): string {
  const fixed = configured?.trim();
  if (fixed) return fixed;

  const covers = normalizeToolCoverPool(pool);
  if (covers.length === 0) return "";

  const knownIndex = FALLBACK_TOOLS.findIndex((tool) => tool.key === key);
  if (knownIndex >= 0) return covers[knownIndex % covers.length];

  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return covers[hash % covers.length];
}

/** 工具处理器 → 中文标签。工具中心的作品卡、画布历史面板共用一份。 */
export const PRESET_TOOL_LABELS: Record<string, string> = {
  outpaint: "智能扩图",
  remove_bg: "一键抠图",
  upscale: "高清放大",
  remove_object: "物体移除",
  relight: "智能打光",
  video_upscale: "视频超分",
};

const TOOL_ORIGIN_BY_KEY = Object.fromEntries(
  FALLBACK_TOOLS.map((tool) => [tool.key, { handler: tool.handler, title: tool.title }]),
) as Record<string, { handler: string; title: string }>;

/** 任务 → 智能工具来源标签。
 *
 * 专属 handler 的历史任务可直接识别；局部重绘复用通用 image_to_image，只有
 * 工具页写入 toolKey 后才能准确区分，不能把普通图生图误标为智能工具。toolKey
 * 还须与 handler 匹配，避免异常/手写请求显示错误来源。新任务同时保存生成时
 * 的 toolTitle，后台改名后历史记录仍保持当时的名称；老任务继续用内置名称。 */
export function smartToolOriginLabel(handler: string, input: unknown): string | undefined {
  let parsed: Record<string, unknown> = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    parsed = input as Record<string, unknown>;
  } else if (typeof input === "string") {
    try {
      const value = JSON.parse(input) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      // Malformed legacy input still falls back to an exclusive handler label.
    }
  }
  const toolKey = typeof parsed.toolKey === "string" ? parsed.toolKey : "";
  const source = TOOL_ORIGIN_BY_KEY[toolKey];
  if (source?.handler === handler) {
    const recordedTitle = typeof parsed.toolTitle === "string"
      ? parsed.toolTitle.trim().slice(0, 64)
      : "";
    return recordedTitle || source.title;
  }
  return PRESET_TOOL_LABELS[handler];
}

/** 产出为视频的工具处理器——作品卡与结果展示要用 video 元素而非 img。 */
export const VIDEO_TOOL_HANDLERS = new Set(["video_upscale"]);
