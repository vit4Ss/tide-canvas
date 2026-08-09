import { AiModelType, type AiModelVO } from "@/types/ai";
import { FileType, type FileVO } from "@/types/file";
import {
  isConceptCanvasNodeType,
  isImageReferenceNodeType,
} from "@/lib/canvas-node-types";
import { parseModelConfig } from "@/components/canvas/nodes/shared/node-utils";
import { refLabel } from "@/components/canvas/nodes/prompt-ref-utils";
import type {
  CanvasReferenceItem,
  CanvasReferenceKind,
} from "../../domain/models/canvas-reference";
import type { CanvasNode } from "../../domain/models/canvas-document";

export type QuickStartMode = "image" | "video";

export interface QuickReference extends CanvasReferenceItem {
  sourceNodeId?: string;
  file?: FileVO;
  textContent?: string;
  isConcept?: boolean;
}

export interface QuickModelConfig {
  ratios?: string[];
  qualities?: string[];
  clarities?: string[];
  resolutions?: string[];
  durations?: Array<string | number>;
  batchSizes?: number[];
  gridOutput?: boolean;
}

export const MAX_QUICK_ATTACHMENTS = 8;

const HANDLER_CONFIG_MODES: Record<string, string> = {
  text_to_image: "t2i",
  image_to_image: "i2i",
  text_to_video: "t2v",
  image_to_video: "i2v",
  start_end_to_video: "keyframe",
  reference_to_video: "omni_ref",
};

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim()))];
}

function durationArray(value: unknown): Array<string | number> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string | number => (
    (typeof item === "number" && Number.isFinite(item)) || typeof item === "string"
  ));
}

export function supportsHandler(model: AiModelVO, handler: string): boolean {
  if (model.supportedHandlers?.length) return model.supportedHandlers.includes(handler);
  const configuredModes = stringArray(parseModelConfig<Record<string, unknown>>(model).modes);
  if (!configuredModes?.length) return true;
  const mode = HANDLER_CONFIG_MODES[handler];
  return mode ? configuredModes.includes(mode) : true;
}

export function quickModeFromModel(model?: AiModelVO): QuickStartMode | null {
  if (model?.type === AiModelType.IMAGE) return "image";
  if (model?.type === AiModelType.VIDEO) return "video";
  return null;
}

export function safeModelConfig(model?: AiModelVO): QuickModelConfig {
  const raw = parseModelConfig<Record<string, unknown>>(model);
  return {
    ratios: stringArray(raw.ratios),
    qualities: stringArray(raw.qualities),
    clarities: stringArray(raw.clarities),
    resolutions: stringArray(raw.resolutions),
    durations: durationArray(raw.durations),
    ...(typeof raw.gridOutput === "boolean" ? { gridOutput: raw.gridOutput } : {}),
  };
}

function positiveLimit(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function referenceCountLimit(
  model: AiModelVO,
  handler: string,
  kind: "image" | "video" | "audio",
): number | undefined {
  const config = parseModelConfig<Record<string, unknown>>(model);
  if (handler === "image_to_image" && kind === "image") {
    return positiveLimit(config.maxRefImages);
  }
  const refLimits = config.refLimits
    && typeof config.refLimits === "object"
    && !Array.isArray(config.refLimits)
    ? config.refLimits as Record<string, unknown>
    : {};
  const key = handler === "image_to_video"
    ? kind === "image" ? "i2v.imageCount" : ""
    : handler === "start_end_to_video"
      ? kind === "image" ? "keyframe.imageCount" : ""
      : handler === "reference_to_video"
        ? `omniRef.${kind}Count`
        : "";
  return key ? positiveLimit(refLimits[key]) : undefined;
}

function tokenPattern(label: string): RegExp {
  return new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g");
}

export function containsQuickReference(prompt: string, reference: CanvasReferenceItem): boolean {
  return tokenPattern(refLabel(reference)).test(prompt);
}

function pushQuickReference(
  target: QuickReference[],
  counters: Record<CanvasReferenceKind, number>,
  reference: Omit<QuickReference, "index"> & { kind: CanvasReferenceKind },
): void {
  counters[reference.kind] += 1;
  target.push({ ...reference, index: counters[reference.kind] });
}

export function buildQuickReferences(
  nodes: readonly CanvasNode[],
  attachments: readonly FileVO[],
): QuickReference[] {
  const references: QuickReference[] = [];
  const counters: Record<CanvasReferenceKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
    text: 0,
  };

  nodes.forEach((node) => {
    if (isImageReferenceNodeType(node.type) && node.imageSrc) {
      pushQuickReference(references, counters, {
        id: `canvas:${node.id}`,
        sourceNodeId: node.id,
        thumb: node.imageSrc,
        src: node.imageSrc,
        title: node.title || "画布图片",
        kind: "image",
        isConcept: isConceptCanvasNodeType(node.type),
      });
      return;
    }
    if (node.type === "video" && node.videoSrc) {
      pushQuickReference(references, counters, {
        id: `canvas:${node.id}`,
        sourceNodeId: node.id,
        thumb: "",
        src: node.videoSrc,
        title: node.title || "画布视频",
        kind: "video",
      });
      return;
    }
    if (node.type === "audio" && node.audioSrc) {
      pushQuickReference(references, counters, {
        id: `canvas:${node.id}`,
        sourceNodeId: node.id,
        thumb: "",
        src: node.audioSrc,
        title: node.title || "画布音频",
        kind: "audio",
      });
      return;
    }
    const text = node.type === "text"
      ? node.content?.trim()
      : isConceptCanvasNodeType(node.type) ? node.prompt?.trim() : "";
    if (!text) return;
    pushQuickReference(references, counters, {
      id: `canvas:${node.id}`,
      sourceNodeId: node.id,
      thumb: "",
      title: node.title || "画布文本",
      text,
      textContent: text,
      kind: "text",
      isConcept: isConceptCanvasNodeType(node.type),
    });
  });

  attachments.forEach((file) => {
    if (file.fileType === FileType.IMAGE) {
      pushQuickReference(references, counters, {
        id: `upload:${file.id}`,
        file,
        thumb: file.fileUrl,
        src: file.fileUrl,
        title: file.originalName,
        kind: "image",
      });
    } else if (file.fileType === FileType.VIDEO) {
      pushQuickReference(references, counters, {
        id: `upload:${file.id}`,
        file,
        thumb: "",
        src: file.fileUrl,
        title: file.originalName,
        kind: "video",
      });
    } else if (file.mimeType?.startsWith("audio/")) {
      pushQuickReference(references, counters, {
        id: `upload:${file.id}`,
        file,
        thumb: "",
        src: file.fileUrl,
        title: file.originalName,
        kind: "audio",
      });
    }
  });
  return references;
}

export function remapPromptReferences(
  prompt: string,
  previous: QuickReference[],
  next: QuickReference[],
): string {
  let value = prompt;
  const sentinels = new Map<string, string>();
  previous.forEach((reference, index) => {
    const sentinel = `__QS_REF_${index}_${Date.now()}__`;
    sentinels.set(reference.id, sentinel);
    value = value.replace(tokenPattern(refLabel(reference)), sentinel);
  });
  sentinels.forEach((sentinel, id) => {
    const replacement = next.find((reference) => reference.id === id);
    value = value.replaceAll(sentinel, replacement ? refLabel(replacement) : "");
  });
  return value.replace(/[ \t]{2,}/g, " ");
}

export function compactPromptReferences(
  prompt: string,
  usedReferences: QuickReference[],
): string {
  let value = prompt;
  const byKind: Record<CanvasReferenceKind, QuickReference[]> = {
    image: [],
    video: [],
    audio: [],
    text: [],
  };
  usedReferences.forEach((reference) => byKind[reference.kind ?? "image"].push(reference));
  const sentinels: Array<{ sentinel: string; nextLabel: string }> = [];
  (["image", "video", "audio", "text"] as const).forEach((kind) => {
    byKind[kind].forEach((reference, index) => {
      const sentinel = `__QS_USED_${kind}_${index}_${Date.now()}__`;
      value = value.replace(tokenPattern(refLabel(reference)), sentinel);
      const prefix = kind === "image"
        ? "图片"
        : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本";
      sentinels.push({ sentinel, nextLabel: `${prefix}${index + 1}` });
    });
  });
  sentinels.forEach(({ sentinel, nextLabel }) => {
    value = value.replaceAll(sentinel, nextLabel);
  });
  return value;
}

export function compactReferenceLabel(
  reference: QuickReference,
  usedReferences: QuickReference[],
): string {
  const kind = reference.kind ?? "image";
  const index = usedReferences
    .filter((item) => (item.kind ?? "image") === kind)
    .findIndex((item) => item.id === reference.id);
  const prefix = kind === "image"
    ? "图片"
    : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本";
  return index >= 0 ? `${prefix}${index + 1}` : "";
}

export function promptForConnectedNode(
  prompt: string,
  usedReferences: QuickReference[],
): string {
  let value = compactPromptReferences(prompt, usedReferences);
  usedReferences.forEach((reference) => {
    if (!reference.isConcept || reference.kind !== "text") return;
    const label = compactReferenceLabel(reference, usedReferences);
    if (label) value = value.replace(tokenPattern(label), "");
  });
  return value.replace(/[ \t]{2,}/g, " ").trim();
}

export function compatibleOptionValue(
  value: string,
  options: string[],
  fallback: string,
): string {
  if (options.includes(value)) return value;
  const caseInsensitive = options.find(
    (option) => option.toLowerCase() === value.toLowerCase(),
  );
  return caseInsensitive ?? options[0] ?? fallback;
}

export function defaultOptionLabel(value: string): string {
  const labels: Record<string, string> = {
    auto: "自动",
    low: "低",
    medium: "中",
    high: "高",
    standard: "标准",
    ultra: "超高",
  };
  return labels[value.toLowerCase()] ?? value;
}
