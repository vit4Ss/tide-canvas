// ============================================================================
// 首页静态营销内容（用户定稿文案）— 能力卡兜底 / FAQ / Hero 轮换提示语 /
// Hero 作品墙 mesh 兜底封面。
//
// 这些是不依赖接口的静态设计内容（canonical liuguang design,
// design-ref/liuguang/home-data.js）：接口失败时页面按此兜底，首页永不空白。
// Covers 是原始色相三元组 — 渲染时经 mesh()/coverBg()（@/lib/mesh）推导 CSS，
// 不硬编码渐变字符串。
// ============================================================================

import type { MeshHues } from "@/lib/mesh";

/* ── 能力卡（能力展示楼层的兜底条目；工具卡优先由后台「工具管理」下发）───────── */

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

/** Capability bento — sizes: "big" | "wide" | "" (default). */
export const CAPS: Cap[] = [
  { t: "文生图",   d: "一句话生成高清画面，GPT Image 2 细节拉满，画风随心定制。", ico: "✦", size: "big",  cover: [265, 210, 320] },
  { t: "文生视频", d: "Seedance 2.0 视听双绝，重塑 AI 视频标杆。",                ico: "▣", size: "wide", cover: [190, 250, 210] },
  { t: "图生图",   d: "参考图秒变新画风。",                                       ico: "⧉", size: "",     cover: [150, 110, 180] },
  { t: "智能扩图", d: "Outpainting 无缝补全。",                                   ico: "⤢", size: "",     cover: [28, 48, 8] },
  { t: "局部重绘", d: "圈选即改，精细编辑。",                                     ico: "✎", size: "",     cover: [330, 286, 12] },
  { t: "一键抠图", d: "智能移除背景与对象。",                                     ico: "⬡", size: "",     cover: [95, 140, 70] },
  { t: "高清放大", d: "4× 无损 Upscale。",                                        ico: "⤡", size: "",     cover: [255, 230, 290] },
];

/* ── FAQ（首页常见问题楼层）────────────────────────────────────────────────── */

/** FAQ item (question + answer). */
export interface Faq {
  q: string;
  a: string;
}

/** Home FAQs. */
export const FAQS: Faq[] = [
  { q: "流光 FlowingLight 是什么？", a: "一站式 AI 创作平台。用一句话即可生成图片与视频，接入海量顶级模型，由你的中转站算力驱动，无需任何专业知识也能做出精彩作品。" },
  { q: "支持哪些模型？", a: "已接入 GPT Image 2、Nano Banana、Midjourney、Imagen、Seedance、可灵 Kling、Sora、Wan、即梦等主流图片与视频模型，并持续更新，新模型上线即可使用。" },
  { q: "生成一张图 / 一段视频要多久？", a: "图片通常数秒即可完成；视频依据时长与复杂度，一般需要数分钟。" },
  { q: "生成的内容可以商用吗？", a: "你对生成内容拥有使用权，可用于社交媒体、营销推广、产品演示等场景。具体以所选模型的授权条款为准。" },
  { q: "新用户有免费额度吗？", a: "有。注册即赠送体验积分，无需绑定信用卡即可开始创作，额度用完后可按需升级。" },
  { q: "如何生成「同款」？", a: "在作品广场或详情页点击「生成同款」，系统会自动把该作品的提示词与参数带入创作台，你可以直接生成或微调后再创作。" },
];

/* ── Hero ────────────────────────────────────────────────────────────────── */

/** Hero rotating prompt examples (typewriter loop). */
export const HERO_PROMPTS: string[] = [
  "液态金属机器人，纯白工作室布光，C4D 渲染",
  "青绿山水工笔，矿物颜料石青石绿，宋代院体",
  "赛博艺伎，全息面具，电路纹和服，超细节 8K",
  "深海发光水母，慢镜头，4K 微距，蓝紫光束",
  "黄昏侧颜人像，胶片颗粒，85mm f/1.4，柔光",
];

/** Hero 作品墙的静态兜底封面（18 张 mesh 色相三元组，顺序即视觉节奏）——
 *  /api/community/posts 为空或失败时按此渲染 mesh 渐变磁贴，首屏永不空白。 */
export const HERO_WALL_FALLBACK_COVERS: MeshHues[] = [
  [268, 192, 320],
  [20, 42, 8],
  [190, 250, 210],
  [330, 286, 350],
  [150, 110, 180],
  [300, 260, 18],
  [95, 140, 70],
  [210, 248, 196],
  [8, 350, 28],
  [255, 230, 290],
  [38, 16, 52],
  [282, 318, 200],
  [168, 200, 140],
  [345, 12, 300],
  [225, 265, 245],
  [110, 78, 150],
  [30, 60, 20],
  [195, 175, 230],
];
