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

export interface FallbackToolDef {
  /** URL slug,独立页为 /tools/<key>(与 ai_tools.key 一致)。 */
  key: string;
  title: string;
  desc: string;
  /** 后端生成处理器名(handlerRegistry)。 */
  handler: string;
  /** 字形图标,如 ⤢。 */
  icon: string;
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

/** 展示独立页的四个工具,按 CanonicalAiTools 的 SortOrder 排列。 */
export const FALLBACK_TOOLS: FallbackToolDef[] = [
  {
    key: "expand",
    title: "智能扩图",
    desc: "Outpainting 无缝向外补全画面。",
    handler: "outpaint",
    icon: "⤢",
    cover: [28, 48, 8],
  },
  {
    key: "inpaint",
    title: "局部重绘",
    desc: "上传图片并描述想修改的部分，AI 精准重绘。",
    handler: "image_to_image",
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
    icon: "⬡",
    cover: [95, 140, 70],
  },
  {
    key: "upscale",
    title: "高清放大",
    desc: "无损放大图片尺寸，智能重塑高清画质。",
    handler: "upscale",
    icon: "⤡",
    cover: [255, 230, 290],
    hd: true,
    extra: { resolution: "4k", clarity: "4k", quality: "high" },
  },
];

/** 预设工具处理器 → 中文标签(含不展示独立页、只在结果悬浮工具栏出现的
    rmobj/relight;它们的任务同样会进「工具作品」/历史面板)。 */
export const PRESET_TOOL_LABELS: Record<string, string> = {
  outpaint: "智能扩图",
  remove_bg: "一键抠图",
  upscale: "高清放大",
  remove_object: "物体移除",
  relight: "智能打光",
};
