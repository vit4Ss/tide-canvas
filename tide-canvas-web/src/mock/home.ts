// Home page sections (mock) — CAPS, STEPS, CREATORS, TESTIMONIALS, FAQS,
// HERO_PROMPTS, CATEGORIES. Faithful to the canonical liuguang design
// (design-ref/liuguang/home-data.js). Covers are raw hue triplets — derive CSS
// via mesh()/coverBg().

import type { Cap, Step, Creator, Testimonial, Faq } from "./types";

/** Category filter chips ("全部" = all). */
export const CATEGORIES: string[] = [
  "全部", "插画", "动漫", "摄影", "3D", "人像", "科幻", "国风", "设计", "视频",
];

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

/** "How it works" steps. */
export const STEPS: Step[] = [
  { ico: "✎", t: "描述你的想法", d: "用一句话写下脑海里的画面，或拖入一张参考图——无需任何专业术语。" },
  { ico: "✦", t: "挑模型，生成", d: "选择心仪的模型与比例，点击生成，数秒之内即得多张高质量结果。" },
  { ico: "⤴", t: "编辑与分享",   d: "局部重绘、放大、抠图一步到位，导出成品或发布到作品广场。" },
];

/** Featured creators. */
export const CREATORS: Creator[] = [
  { name: "夜航 NightSail", tag: "科幻 · 概念场景", works: 312, cover: [268, 192, 320] },
  { name: "KENJI",         tag: "动漫 · 人像",     works: 489, cover: [300, 260, 18] },
  { name: "OceanLab",      tag: "视频 · 自然",     works: 204, cover: [190, 250, 210] },
  { name: "砚 Yan",        tag: "国风 · 工笔",     works: 176, cover: [8, 350, 28] },
  { name: "Mira",          tag: "人像 · 胶片",     works: 351, cover: [20, 42, 8] },
  { name: "Studio 3F",     tag: "3D · 产品",       works: 267, cover: [210, 248, 196] },
];

/** Testimonials / social proof. */
export const TESTIMONIALS: Testimonial[] = [
  { q: "以前一张商业插画要外包等一周，现在一个下午出了二十版方案，客户当场拍板。", name: "林深",  role: "自由插画师",   stars: 5, cover: [268, 200, 320] },
  { q: "视频分镜直接用文生视频打草稿，团队沟通效率翻倍，省下大把试错时间。",       name: "阿哲",  role: "短视频导演",   stars: 5, cover: [190, 250, 210] },
  { q: "模型切换太丝滑了，一个入口把 Midjourney、Flux、可灵全用上，再也不用开十个网页。", name: "Coco", role: "电商视觉", stars: 5, cover: [330, 286, 12] },
  { q: "国风工笔的还原度惊到我了，矿物色和金线质感都在，发小红书直接爆了。",       name: "砚秋",  role: "国风博主",     stars: 5, cover: [8, 350, 28] },
  { q: "作品广场就是灵感宝库，看到喜欢的点「生成同款」连参数都带过来，新手友好。", name: "小鹿",  role: "设计学生",     stars: 4, cover: [150, 110, 180] },
  { q: "公司用企业版做营销物料，出图速度和一致性都达标，性价比远超买图库。",       name: "David", role: "品牌市场",     stars: 5, cover: [255, 230, 290] },
];

/** Home FAQs. */
export const FAQS: Faq[] = [
  { q: "SCARECROWAI 是什么？", a: "一站式 AI 创作平台。用一句话即可生成图片与视频，接入海量顶级模型，由你的中转站算力驱动，无需任何专业知识也能做出精彩作品。" },
  { q: "支持哪些模型？", a: "已接入 GPT Image 2、Nano Banana、Midjourney、Imagen、Seedance、可灵 Kling、Sora、Wan、即梦等主流图片与视频模型，并持续更新，新模型上线即可使用。" },
  { q: "生成一张图 / 一段视频要多久？", a: "图片通常数秒即可完成；视频依据时长与复杂度，一般需要数分钟。" },
  { q: "生成的内容可以商用吗？", a: "你对生成内容拥有使用权，可用于社交媒体、营销推广、产品演示等场景。具体以所选模型的授权条款为准。" },
  { q: "新用户有免费额度吗？", a: "有。注册即赠送体验积分，无需绑定信用卡即可开始创作，额度用完后可按需升级。" },
  { q: "如何生成「同款」？", a: "在作品广场或详情页点击「生成同款」，系统会自动把该作品的提示词与参数带入创作台，你可以直接生成或微调后再创作。" },
];

/** Hero rotating prompt examples. */
export const HERO_PROMPTS: string[] = [
  "液态金属机器人，纯白工作室布光，C4D 渲染",
  "青绿山水工笔，矿物颜料石青石绿，宋代院体",
  "赛博艺伎，全息面具，电路纹和服，超细节 8K",
  "深海发光水母，慢镜头，4K 微距，蓝紫光束",
  "黄昏侧颜人像，胶片颗粒，85mm f/1.4，柔光",
];
