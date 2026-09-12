import type { SkillInputSchema } from "@/types/skill";

export type SkillInputPreset = "text" | "image" | "images" | "keyframes" | "video" | "audio" | "file" | "webpage" | "mixed";

export const SKILL_INPUT_PRESETS: Array<{
  key: SkillInputPreset;
  label: string;
  description: string;
}> = [
  { key: "text", label: "仅文本", description: "用户只需输入自然语言要求。" },
  { key: "image", label: "单张图片 + 文本", description: "严格要求上传一张图片，适合图生图、图生视频或单图分析。" },
  { key: "images", label: "多图参考 + 文本", description: "允许 1–9 张图片，适合多图分析和参考生成；实际数量仍受运行模型限制。" },
  { key: "keyframes", label: "首尾帧 + 文本", description: "严格要求上传两张图片，分别作为起始帧和结束帧。" },
  { key: "video", label: "视频 + 文本", description: "要求上传一个视频，可附加分析重点。" },
  { key: "audio", label: "音频 + 文本", description: "要求上传一个音频，可附加处理要求。" },
  { key: "file", label: "文件 + 文本", description: "要求上传 1–8 个文档或通用文件作为资料。" },
  { key: "webpage", label: "网页链接", description: "要求输入一个 HTTP 或 HTTPS 地址。" },
  { key: "mixed", label: "多媒体参考", description: "允许混合上传图片、视频和音频（总上限 13）；各类型实际数量仍受运行模型限制。" },
];

function assetSchema(type: "image" | "video" | "audio" | "file", title: string, maxItems: number): SkillInputSchema {
  return {
    type: "object",
    "x-asset-types": [type],
    required: ["assets"],
    properties: {
      assets: {
        type: "array",
        title,
        minItems: 1,
        maxItems,
        items: {
          type: "object",
          required: ["type"],
          properties: { type: { type: "string", enum: [type] } },
        },
      },
    },
  };
}

export function skillInputSchemaFor(preset: SkillInputPreset): SkillInputSchema {
  switch (preset) {
    case "image":
      return assetSchema("image", "图片素材", 1);
    case "images":
      return assetSchema("image", "图片素材", 9);
    case "keyframes":
      return {
        type: "object",
        "x-asset-types": ["image"],
        required: ["assets"],
        properties: {
          assets: {
            type: "array",
            title: "首尾帧图片",
            minItems: 2,
            maxItems: 2,
            items: {
              type: "object",
              required: ["type"],
              properties: { type: { type: "string", enum: ["image"] } },
            },
          },
        },
      };
    case "video":
      return assetSchema("video", "视频素材", 1);
    case "audio":
      return assetSchema("audio", "音频素材", 1);
    case "file":
      return assetSchema("file", "参考文件", 8);
    case "webpage":
      return {
        type: "object",
        "x-asset-types": [],
        required: ["url"],
        properties: {
          url: {
            type: "string",
            title: "网页地址",
            format: "uri",
            pattern: "^https?://",
            placeholder: "https://example.com",
          },
        },
      };
    case "mixed":
      return {
        type: "object",
        "x-asset-types": ["image", "video", "audio"],
        required: ["assets"],
        properties: {
          assets: {
            type: "array",
            title: "参考素材",
            minItems: 1,
            maxItems: 13,
            items: {
              type: "object",
              required: ["type"],
              properties: {
                type: { type: "string", enum: ["image", "video", "audio"] },
              },
            },
          },
        },
      };
    default:
      return { type: "object", "x-asset-types": [], required: ["prompt"], properties: {} };
  }
}

export function detectSkillInputPreset(schema: Record<string, unknown> | null): SkillInputPreset | null {
  if (!schema) return null;
  const assetTypes = schema["x-asset-types"];
  if (Array.isArray(assetTypes)) {
    const normalized = assetTypes.filter((item): item is string => typeof item === "string").sort().join(",");
    if (normalized === "image") {
      const properties = schema.properties;
      if (properties && typeof properties === "object" && !Array.isArray(properties)) {
        const assets = (properties as Record<string, unknown>).assets;
        if (assets && typeof assets === "object" && !Array.isArray(assets)) {
          const spec = assets as Record<string, unknown>;
          if (spec.minItems === 2 && spec.maxItems === 2) return "keyframes";
          if (spec.minItems === 1 && spec.maxItems === 1) return "image";
          if (spec.minItems === 1 && spec.maxItems === 9) return "images";
        }
      }
      return null;
    }
    if (normalized === "video") return "video";
    if (normalized === "audio") return "audio";
    if (normalized === "file") return "file";
    if (normalized === "audio,image,video") return "mixed";
    if (normalized) return null;
  }
  const properties = schema.properties;
  const required = schema.required;
  if (
    properties && typeof properties === "object" && !Array.isArray(properties) && "url" in properties &&
    Array.isArray(required) && required.includes("url")
  ) return "webpage";
  if (
    properties && typeof properties === "object" && !Array.isArray(properties) && Object.keys(properties).length === 0 &&
    (!Array.isArray(required) || required.length === 0 || (required.length === 1 && required[0] === "prompt"))
  ) {
    return "text";
  }
  return null;
}
