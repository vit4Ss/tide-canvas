// MODELS marketplace + MODEL_NAMES marquee + BASES (mock).
//
// Faithful to the canonical liuguang design
// (design-ref/liuguang/home-data.js + design-ref/liuguang/models.js).
// Covers are raw hue triplets — derive CSS via mesh()/coverBg().

import type { MarketModel } from "./types";

/** Model marketplace cards (8 items, liuguang order). */
export const MODELS: MarketModel[] = [
  { cover: [268, 200, 320], name: "麦田写实 XL",  base: "SDXL", runs: 182000, ver: "v3.0", tags: ["写实", "人像", "电影感"], badge: "hot" },
  { cover: [330, 286, 12],  name: "霓虹故障风",    base: "Flux", runs: 94000,  ver: "v2",   tags: ["故障", "霓虹"],          badge: "hot" },
  { cover: [110, 78, 150],  name: "动漫挚爱",      base: "SDXL", runs: 312000, ver: "v5.0", tags: ["二次元", "高饱和"],      badge: "hot" },
  { cover: [20, 42, 8],     name: "胶片人像",      base: "Flux", runs: 156000, ver: "v1.5", tags: ["胶片", "柔光"],          badge: null },
  { cover: [8, 350, 28],    name: "青绿山水 国风", base: "SDXL", runs: 41000,  ver: "v1",   tags: ["国风", "工笔"],          badge: "new" },
  { cover: [282, 318, 200], name: "液态金属质感",  base: "Flux", runs: 67000,  ver: "v2.1", tags: ["材质", "3D"],            badge: null },
  { cover: [225, 265, 245], name: "极致质感人像",  base: "Flux", runs: 134000, ver: "v3.1", tags: ["人像", "细节"],          badge: "hot" },
  { cover: [345, 12, 300],  name: "复古海报",      base: "Flux", runs: 52000,  ver: "v1.3", tags: ["复古", "排版"],          badge: null },
];

/** Base-model filter chips for the marketplace ("全部" = all). */
export const BASES: string[] = ["全部", "SDXL", "Flux", "可灵 Kling", "ComfyUI"];

/** Model-name marquee strip used on the home page. */
export const MODEL_NAMES: string[] = [
  "Flux.1 Pro", "SDXL Lightning", "Seedance 2.0", "可灵 Kling 1.6", "Midjourney v6",
  "Animagine XL", "Ideogram 2.0", "墨韵 InkXL", "Pony Diffusion", "SDXL Turbo",
  "Flux.1 Dev", "即梦 3.0",
];

/** Model picker options shown inside the studio / create flow. */
export const CREATE_MODELS: string[] = [
  "GPT Image 2", "Flux.1 Pro", "Midjourney v6", "Nano Banana 2", "SDXL Lightning",
  "即梦 3.0", "Seedance 2.0", "可灵 Kling 1.6",
];
