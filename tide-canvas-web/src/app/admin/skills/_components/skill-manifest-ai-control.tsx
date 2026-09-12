"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { aiApi } from "@/lib/api";
import {
  commitAcceptedAiGeneration,
  isAmbiguousAiCreateCode,
} from "@/lib/ai-generation-idempotency";
import { modelPromptCharLimit, modelPromptLimitIssue } from "@/lib/model-prompt-limit";
import { useAuthStore } from "@/stores/use-auth-store";
import { AiTaskStatus, type AiModelVO, type AiTaskVO } from "@/types/ai";
import type { ModelConfig } from "@/types/admin-models";
import type { SkillKind, SkillOutputType } from "@/types/skill";
import { toast } from "@/components/shared/toast";

const MANIFEST_SCOPE = "admin:skill-manifest";
const POLL_INTERVAL_MS = 1_500;
const TASK_TIMEOUT_MS = 3 * 60_000;
const INITIAL_STATUS = "Schema 由管理员决定；AI 只生成 Manifest 草稿，不填写模型 ID。";

const STEP_TYPES = new Set(["text", "generate", "tool", "approval", "input"]);
const HANDLERS = new Set([
  "", "skill_text_completion", "assistant_chat",
  "text_to_image", "image_to_image", "text_to_video", "image_to_video",
  "start_end_to_video", "reference_to_video", "text_to_audio",
  "render_pptx", "render_xlsx", "render_docx", "render_markdown",
  "analyze_image", "analyze_video", "analyze_audio", "analyze_webpage",
]);
const TOOL_HANDLERS = new Set([...HANDLERS].filter((handler) => handler.startsWith("render_") || handler.startsWith("analyze_")));
const HANDLER_OUTPUT = new Map<string, SkillOutputType>([
  ["text_to_image", "image"], ["image_to_image", "image"],
  ["text_to_video", "video"], ["image_to_video", "video"],
  ["start_end_to_video", "video"], ["reference_to_video", "video"],
  ["text_to_audio", "audio"],
]);
const TOP_LEVEL_FIELDS = new Set(["kind", "primaryOutputType", "outputTypes", "preferredNodeType", "steps"]);
const STEP_FIELDS = new Set([
  "key", "title", "type", "handler", "prompt", "systemPrompt", "outputType",
  "outputRole", "registerWork", "strictJson", "preferredNodeType", "message",
  "schema", "promotePrevious",
]);

export interface SkillManifestDraftRequest {
  key: string;
  title: string;
  source: string;
  kind: SkillKind;
  primaryOutputType: SkillOutputType;
  outputTypes: SkillOutputType[];
  inputSchema: Record<string, unknown>;
  signature: string;
}

export interface SkillManifestDraftResult {
  key: string;
  signature: string;
  manifest: Record<string, unknown>;
}

function parseModelConfig(model: AiModelVO): ModelConfig {
  try {
    const parsed: unknown = JSON.parse(model.config || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ModelConfig
      : {};
  } catch {
    return {};
  }
}

function textModels(models: AiModelVO[]): AiModelVO[] {
  return models
    .filter((model) => {
      if (model.type !== "text" || parseModelConfig(model).availabilityStatus === "maintenance") return false;
      const handlers = model.supportedHandlers?.filter(Boolean) ?? [];
      return !handlers.length || handlers.includes("skill_text_completion");
    })
    .sort((left, right) => Number(parseModelConfig(right).aiOptimizePrimary === true) - Number(parseModelConfig(left).aiOptimizePrimary === true));
}

function taskText(task: AiTaskVO): string {
  let meta: unknown = task.resultMeta;
  if (typeof meta === "string") {
    const raw = meta;
    try { meta = JSON.parse(raw) as unknown; } catch { return raw.trim(); }
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const record = meta as Record<string, unknown>;
  for (const key of ["answer", "content", "text", "message", "response", "output"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseJSONObject(raw: string): Record<string, unknown> | null {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function schemaAssetTypes(schema: Record<string, unknown>): Set<string> {
  const raw = schema["x-asset-types"];
  return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : []);
}

function manifestRequestIssue(request: SkillManifestDraftRequest): string | null {
  if (request.kind !== "tool" || request.primaryOutputType !== "text") return null;
  const assetTypes = schemaAssetTypes(request.inputSchema);
  if (assetTypes.size === 1 && ["image", "video", "audio"].some((type) => assetTypes.has(type))) return null;
  const properties = request.inputSchema.properties;
  const required = request.inputSchema.required;
  const assetDefinition = properties && typeof properties === "object" && !Array.isArray(properties)
    ? (properties as Record<string, unknown>).assets
    : undefined;
  const urlDefinition = properties && typeof properties === "object" && !Array.isArray(properties)
    ? (properties as Record<string, unknown>).url
    : undefined;
  if (
    urlDefinition && typeof urlDefinition === "object" && !Array.isArray(urlDefinition) &&
    (urlDefinition as Record<string, unknown>).type === "string" &&
    Array.isArray(required) && required.includes("url") &&
    assetTypes.size === 0 && !assetDefinition && !required.includes("assets")
  ) return null;
  return `“${request.title}”当前选择了技能工具 + 文本输出，但 Schema 没有可由服务端工具直接处理的单一图片、视频、音频或网页输入`;
}

function validateHandlerInput(handler: string, request: SkillManifestDraftRequest, stepIndex: number): void {
  const assets = schemaAssetTypes(request.inputSchema);
  const properties = request.inputSchema.properties;
  const required = request.inputSchema.required;
  const assetDefinition = properties && typeof properties === "object" && !Array.isArray(properties)
    ? (properties as Record<string, unknown>).assets
    : undefined;
  const assetSpec = assetDefinition && typeof assetDefinition === "object" && !Array.isArray(assetDefinition)
    ? assetDefinition as Record<string, unknown>
    : null;
  const invalidAssetsField = !assetSpec || assetSpec.type !== "array" ||
    typeof assetSpec.minItems !== "number" || assetSpec.minItems < 1 ||
    !Array.isArray(required) || !required.includes("assets");
  const requiredAsset = new Map<string, string>([
    ["analyze_image", "image"],
    ["analyze_video", "video"],
    ["analyze_audio", "audio"],
    ["image_to_image", "image"],
    ["image_to_video", "image"],
    ["start_end_to_video", "image"],
  ]).get(handler);
  if (
    ["text_to_image", "text_to_video", "text_to_audio", "analyze_webpage"].includes(handler) &&
    (assets.size > 0 || !!assetSpec || (Array.isArray(required) && required.includes("assets")))
  ) {
    throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步不会消费素材，但当前 Schema 要求了素材输入`);
  }
  if (requiredAsset && (assets.size !== 1 || !assets.has(requiredAsset))) {
    throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步只接受 ${requiredAsset} 输入，但当前 Schema 的素材类型不完全匹配`);
  }
  if (requiredAsset && invalidAssetsField) {
    throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步需要必填的 assets 字段，但当前 Schema 未配置`);
  }
  if (["analyze_video", "analyze_audio", "image_to_video"].includes(handler) && assetSpec?.maxItems !== 1) {
    throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步只消费一个素材，但当前 Schema 没有限制为一个`);
  }
  if (
    handler === "analyze_image" &&
    (typeof assetSpec?.maxItems !== "number" || assetSpec.maxItems < 1 || assetSpec.maxItems > 9)
  ) {
    throw new Error(`“${request.title}”的图片分析步骤必须把素材数量限制在 1–9 张`);
  }
  if (
    handler === "reference_to_video" &&
    (assets.size === 0 || [...assets].some((type) => !["image", "video", "audio"].includes(type)))
  ) {
    throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步只接受图片、视频或音频参考素材`);
  }
  if (handler === "reference_to_video" && invalidAssetsField) {
    throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步需要必填的 assets 字段，但当前 Schema 未配置`);
  }
  if (handler === "start_end_to_video" && (assetSpec?.minItems !== 2 || assetSpec?.maxItems !== 2)) {
    throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步需要恰好两张首尾帧图片`);
  }
  if (handler === "analyze_webpage") {
    const urlDefinition = properties && typeof properties === "object" && !Array.isArray(properties)
      ? (properties as Record<string, unknown>).url
      : undefined;
    const validURLField = !!urlDefinition && typeof urlDefinition === "object" && !Array.isArray(urlDefinition) &&
      (urlDefinition as Record<string, unknown>).type === "string";
    if (
      !validURLField ||
      !Array.isArray(required) || !required.includes("url")
    ) {
      throw new Error(`“${request.title}”的第 ${stepIndex + 1} 步需要网页地址，但当前 Schema 没有 url 字段`);
    }
  }
}

function sanitizeManifest(raw: string, request: SkillManifestDraftRequest): Record<string, unknown> {
  if (request.kind === "preset") {
    return {
      kind: request.kind,
      primaryOutputType: request.primaryOutputType,
      outputTypes: request.outputTypes,
    };
  }
  if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) {
    throw new Error(`“${request.title}”返回的 Manifest 超过 1 MB 上限`);
  }
  const manifest = parseJSONObject(raw);
  if (!manifest) throw new Error(`“${request.title}”返回的 Manifest 不是合法 JSON 对象`);
  if (Object.prototype.hasOwnProperty.call(manifest, "modelId")) {
    throw new Error(`“${request.title}”的 Manifest 不允许由 AI 填写模型 ID`);
  }
  for (const field of Object.keys(manifest)) {
    if (!TOP_LEVEL_FIELDS.has(field)) throw new Error(`“${request.title}”的 Manifest 包含未知字段 ${field}`);
  }
  if (
    manifest.preferredNodeType !== undefined &&
    (typeof manifest.preferredNodeType !== "string" || !["", "character", "scene"].includes(manifest.preferredNodeType))
  ) {
    throw new Error(`“${request.title}”的 preferredNodeType 只能是 character 或 scene`);
  }
  const allowedOutputs = new Set(request.outputTypes);
  const normalizedSteps: Array<{
    type: string;
    handler: string;
    outputType: string;
    outputRole: string;
    promotePrevious: boolean;
    registerWork: boolean;
  }> = [];
  const seenKeys = new Set<string>();
  if (manifest.steps !== undefined) {
    if (!Array.isArray(manifest.steps) || !manifest.steps.length || manifest.steps.length > 64) {
      throw new Error(`“${request.title}”的 steps 必须包含 1 至 64 个步骤`);
    }
    for (let index = 0; index < manifest.steps.length; index += 1) {
      const rawStep = manifest.steps[index];
      if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步不是对象`);
      }
      const step = rawStep as Record<string, unknown>;
      for (const field of Object.keys(step)) {
        if (field === "modelId") throw new Error(`“${request.title}”的第 ${index + 1} 步不允许由 AI 填写模型 ID`);
        if (!STEP_FIELDS.has(field)) throw new Error(`“${request.title}”的第 ${index + 1} 步包含未知字段 ${field}`);
      }
      for (const field of ["key", "title", "handler", "prompt", "systemPrompt", "outputType", "outputRole", "preferredNodeType", "message"]) {
        if (step[field] !== undefined && typeof step[field] !== "string") {
          throw new Error(`“${request.title}”的第 ${index + 1} 步字段 ${field} 必须是文本`);
        }
      }
      if (typeof step.type !== "string" || !STEP_TYPES.has(step.type)) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步类型不受支持`);
      }
      const rawKey = typeof step.key === "string" ? step.key : "";
      const key = rawKey.trim() || `step_${index + 1}`;
      if (rawKey !== rawKey.trim() || seenKeys.has(key)) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步 key 无效或重复`);
      }
      seenKeys.add(key);
      const handler = step.handler ?? "";
      if (typeof handler !== "string" || !HANDLERS.has(handler)) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步使用了未注册处理器`);
      }
      const toolHandler = TOOL_HANDLERS.has(handler);
      if (step.type === "tool" && !toolHandler) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步缺少已注册的工具处理器`);
      }
      if (step.type !== "tool" && toolHandler) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步必须声明为 tool 类型`);
      }
      if ((step.type === "approval" || step.type === "input") && Object.prototype.hasOwnProperty.call(step, "handler")) {
        throw new Error(`“${request.title}”的第 ${index + 1} 个确认/输入步骤不能声明 handler`);
      }
      if (step.type === "text" && handler !== "" && handler !== "skill_text_completion" && handler !== "assistant_chat") {
        throw new Error(`“${request.title}”的第 ${index + 1} 个文本步骤处理器不兼容`);
      }
      if (step.type === "generate" && (handler === "skill_text_completion" || handler === "assistant_chat")) {
        throw new Error(`“${request.title}”的第 ${index + 1} 个生成步骤处理器不兼容`);
      }
      if (step.type === "generate" && handler === "") {
        throw new Error(`“${request.title}”的第 ${index + 1} 个生成步骤必须明确选择生成处理器`);
      }
      const controlStep = step.type === "approval" || step.type === "input";
      if (controlStep) {
        for (const field of ["handler", "prompt", "systemPrompt", "outputType", "outputRole", "registerWork", "strictJson", "preferredNodeType"]) {
          if (Object.prototype.hasOwnProperty.call(step, field)) {
            throw new Error(`“${request.title}”的第 ${index + 1} 个确认/输入步骤不能包含 ${field}`);
          }
        }
      } else {
        for (const field of ["message", "schema", "promotePrevious"]) {
          if (Object.prototype.hasOwnProperty.call(step, field)) {
            throw new Error(`“${request.title}”的第 ${index + 1} 个执行步骤不能包含 ${field}`);
          }
        }
      }
      if (step.type === "generate" && Object.prototype.hasOwnProperty.call(step, "systemPrompt")) {
        throw new Error(`“${request.title}”的第 ${index + 1} 个生成步骤不能包含 systemPrompt`);
      }
      if (step.type === "tool" && handler.startsWith("render_") && (
        Object.prototype.hasOwnProperty.call(step, "systemPrompt") ||
        Object.prototype.hasOwnProperty.call(step, "preferredNodeType")
      )) {
        throw new Error(`“${request.title}”的第 ${index + 1} 个文件渲染步骤包含无效字段`);
      }
      if (step.strictJson !== undefined && (typeof step.strictJson !== "boolean" || step.type !== "text")) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步 strictJson 只适用于文本步骤`);
      }
      if (step.registerWork !== undefined && typeof step.registerWork !== "boolean") {
        throw new Error(`“${request.title}”的第 ${index + 1} 步 registerWork 必须是布尔值`);
      }
      if (step.promotePrevious !== undefined && (typeof step.promotePrevious !== "boolean" || step.type !== "approval")) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步 promotePrevious 只适用于确认步骤`);
      }
      if (step.schema !== undefined && (!step.schema || typeof step.schema !== "object" || Array.isArray(step.schema))) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步 schema 必须是 JSON 对象`);
      }
      if (
        step.preferredNodeType !== undefined &&
        !["", "character", "scene"].includes(step.preferredNodeType as string)
      ) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步 preferredNodeType 无效`);
      }
      const outputType = controlStep ? "" : (
        typeof step.outputType === "string" && step.outputType ? step.outputType : step.type === "text" ? "text" : ""
      );
      if (!controlStep && !outputType) {
        throw new Error(`“${request.title}”的第 ${index + 1} 个执行步骤缺少 outputType`);
      }
      if (step.type === "text" && outputType !== "text" && outputType !== "file") {
        throw new Error(`“${request.title}”的第 ${index + 1} 个文本步骤只能输出 text 或 file`);
      }
      if (step.type === "generate" && !["image", "video", "audio"].includes(outputType)) {
        throw new Error(`“${request.title}”的第 ${index + 1} 个生成步骤输出类型无效`);
      }
      if (step.type === "tool" && handler.startsWith("render_") && outputType !== "file") {
        throw new Error(`“${request.title}”的第 ${index + 1} 个文件工具必须输出 file`);
      }
      if (step.type === "tool" && handler.startsWith("analyze_") && outputType !== "text") {
        throw new Error(`“${request.title}”的第 ${index + 1} 个分析工具必须输出 text`);
      }
      if (outputType && !allowedOutputs.has(outputType as SkillOutputType)) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步输出 ${outputType} 未在允许输出中声明`);
      }
      const handlerOutput = HANDLER_OUTPUT.get(handler);
      if (handlerOutput && handlerOutput !== outputType) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步处理器与输出类型不匹配`);
      }
      const outputRole = typeof step.outputRole === "string" ? step.outputRole : "";
      if (outputRole && !["final", "intermediate", "draft"].includes(outputRole)) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步 outputRole 无效`);
      }
      validateHandlerInput(handler, request, index);
      normalizedSteps.push({
        type: step.type,
        handler,
        outputType,
        outputRole,
        promotePrevious: step.promotePrevious === true,
        registerWork: step.registerWork === true,
      });
    }
  }
  if (request.kind === "tool") {
    const hasRegisteredTool = normalizedSteps.some((step) => step.type === "tool" && TOOL_HANDLERS.has(step.handler));
    if (!hasRegisteredTool) throw new Error(`“${request.title}”的 Tool Manifest 必须包含已注册工具步骤`);
  }
  if (normalizedSteps.length) {
    const finalOutputs = new Set<string>();
    normalizedSteps.forEach((step, index) => {
      const promotedByNext = normalizedSteps[index + 1]?.type === "approval" && normalizedSteps[index + 1]?.promotePrevious;
      if (step.promotePrevious && (index === 0 || !["text", "generate"].includes(normalizedSteps[index - 1]?.type ?? ""))) {
        throw new Error(`“${request.title}”的第 ${index + 1} 个确认步骤前没有可确认的生成结果`);
      }
      const effectiveFinal = step.outputRole === "final" || (!step.outputRole && index === normalizedSteps.length - 1) || promotedByNext;
      if (step.registerWork && !effectiveFinal) {
        throw new Error(`“${request.title}”的第 ${index + 1} 步只有最终结果才能登记为作品`);
      }
      if (effectiveFinal && ["text", "generate", "tool"].includes(step.type)) finalOutputs.add(step.outputType);
    });
    if (!finalOutputs.has(request.primaryOutputType)) {
      throw new Error(`“${request.title}”的最终步骤没有产出主输出 ${request.primaryOutputType}`);
    }
  }
  return {
    ...manifest,
    kind: request.kind,
    primaryOutputType: request.primaryOutputType,
    outputTypes: request.outputTypes,
  };
}

function excerpt(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= maxCharacters
    ? characters.join("")
    : `${characters.slice(0, maxCharacters).join("")}…`;
}

function generationPrompt(request: SkillManifestDraftRequest, model: AiModelVO): string {
  const config = parseModelConfig(model);
  const limit = modelPromptCharLimit(config);
  const sourceLimit = Math.max(200, Math.min(18_000, limit ? limit - 2_200 : 18_000));
  return `根据以下 Skill 定义和管理员已经选择的输入 Schema，生成 FlowingLight Manifest 草稿。

技能：${excerpt(request.title, 64)}
执行形态：${request.kind}
主输出：${request.primaryOutputType}
允许输出：${JSON.stringify(request.outputTypes)}
输入 Schema：${JSON.stringify(request.inputSchema)}

<skill_definition>
${excerpt(request.source, sourceLimit)}
</skill_definition>

只返回严格 JSON 对象。顶层只允许 kind、primaryOutputType、outputTypes、preferredNodeType、steps。
步骤 type 只能是 text、generate、tool、approval、input；handler 只能从以下白名单选择：
${[...HANDLERS].filter(Boolean).join("、")}。

不得输出 modelId，不得创造处理器，不得执行任意代码或 URL。kind、primaryOutputType、outputTypes 必须与上面管理员选择完全一致。每个执行步骤的 outputType 必须属于“允许输出”；主输出不是 text 时，不要额外创建 text 规划步骤。generate 步骤必须明确填写与输出匹配的 handler：图片使用 text_to_image 或 image_to_image；视频的单张图片输入使用 image_to_video，多图或多媒体输入使用 reference_to_video，首尾帧输入使用 start_end_to_video，无素材输入使用 text_to_video；音频使用 text_to_audio。媒体分析仅使用对应的 analyze_image、analyze_video、analyze_audio；网页分析使用 analyze_webpage。不要使用账号分析等需要专用业务上下文的处理器。

优先采用最简单且能完成任务的流程；普通对话型 Agent 可以不写 steps。Tool 必须至少包含一个已注册 tool 步骤。最终步骤，或紧随其后的 promotePrevious 确认步骤，必须产出主输出类型。`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SkillManifestAiControl({
  disabled = false,
  loadRequests,
  onGenerated,
  onBusyChange,
}: {
  disabled?: boolean;
  loadRequests: () => Promise<SkillManifestDraftRequest[]>;
  onGenerated: (results: SkillManifestDraftResult[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const runRef = useRef(0);
  const taskIdRef = useRef("");
  const ownerRef = useRef("");
  const scopeRef = useRef("");
  const mountedRef = useRef(true);

  const setGenerationBusy = (next: boolean) => {
    if (!mountedRef.current) return;
    setBusy(next);
    onBusyChange?.(next);
  };

  const release = async (taskId: string, owner: string, scope: string) => {
    if (taskIdRef.current === taskId) {
      taskIdRef.current = "";
      ownerRef.current = "";
      scopeRef.current = "";
    }
    await commitAcceptedAiGeneration(scope, taskId, owner).catch(() => undefined);
  };

  useEffect(() => () => {
    mountedRef.current = false;
    runRef.current += 1;
    const taskId = taskIdRef.current;
    const owner = ownerRef.current;
    const scope = scopeRef.current;
    taskIdRef.current = "";
    if (taskId) {
      void aiApi.cancelTask(taskId).finally(() => commitAcceptedAiGeneration(scope, taskId, owner)).catch(() => undefined);
    }
  }, []);

  const stop = async () => {
    const taskId = taskIdRef.current;
    const owner = ownerRef.current;
    const scope = scopeRef.current;
    runRef.current += 1;
    taskIdRef.current = "";
    ownerRef.current = "";
    scopeRef.current = "";
    if (!taskId) {
      setGenerationBusy(false);
      setStatus("已停止继续确认；若请求已被受理，可在生成记录中查看。");
      return;
    }
    setStopping(true);
    setStatus("正在停止当前 Manifest 任务…");
    try {
      await aiApi.cancelTask(taskId).catch(() => undefined);
      await commitAcceptedAiGeneration(scope, taskId, owner).catch(() => undefined);
      if (mountedRef.current) setStatus("已停止；未完成的草稿不会回填。已受理任务仍可在生成记录中查看。");
    } finally {
      if (mountedRef.current) {
        setStopping(false);
        setGenerationBusy(false);
      }
    }
  };

  const generate = async () => {
    if (busy || disabled) return;
    const run = ++runRef.current;
    const active = () => mountedRef.current && runRef.current === run;
    setGenerationBusy(true);
    try {
      const requests = await loadRequests();
      if (!active()) return;
      if (!requests.length) throw new Error("没有可生成 Manifest 的 Skill 内容");
      const requestIssue = requests.map(manifestRequestIssue).find((issue) => !!issue);
      if (requestIssue) throw new Error(requestIssue);
      const aiRequests = requests.filter((request) => request.kind !== "preset");
      const emptySource = aiRequests.find((request) => !request.source.trim());
      if (emptySource) throw new Error(`“${emptySource.title}”没有可供分析的 Skill 主说明`);
      const needsAI = aiRequests.length > 0;
      const selectedModels = new Map<string, AiModelVO>();
      let owner = "";
      if (needsAI) {
        const modelResponse = await aiApi.listModels();
        if (!active()) return;
        const availableModels = modelResponse.success ? textModels(modelResponse.data) : [];
        if (!availableModels.length) throw new Error(modelResponse.message || "暂无可用的文本模型");
        for (const request of aiRequests) {
          const model = availableModels.find((candidate) => {
            const candidatePrompt = generationPrompt(request, candidate);
            return !modelPromptLimitIssue(candidatePrompt, parseModelConfig(candidate));
          });
          if (!model) throw new Error(`“${request.title}”的内容超过所有可用文本模型的提示词限制，请精简 SKILL.md`);
          selectedModels.set(request.key, model);
        }
        if (aiRequests.length > 1) {
          const estimatedPoints = aiRequests.reduce(
            (sum, request) => sum + Number(selectedModels.get(request.key)?.pointCost || 0),
            0,
          );
          const costHint = estimatedPoints > 0 ? `，预计基础消耗 ${estimatedPoints} 积分` : "";
          if (!window.confirm(`将依次为 ${aiRequests.length} 个 Skill 调用文本模型${costHint}。确认继续吗？`)) {
            setStatus("已取消批量生成，未启动任何模型任务。");
            return;
          }
        }
        if (!(await useAuthStore.getState().ensureSession())) return;
        owner = useAuthStore.getState().user?.id ?? "";
        if (!owner) throw new Error("无法确认当前账号，Manifest 任务尚未启动");
      }

      const results: SkillManifestDraftResult[] = [];
      for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
        const request = requests[requestIndex];
        if (request.kind === "preset") {
          setStatus(`正在生成 ${requestIndex + 1}/${requests.length} · ${request.title}`);
          const draft = { key: request.key, signature: request.signature, manifest: sanitizeManifest("{}", request) };
          results.push(draft);
          onGenerated([draft]);
          continue;
        }
        const model = selectedModels.get(request.key);
        if (!model) throw new Error(`“${request.title}”没有匹配到可用文本模型`);
        const prompt = generationPrompt(request, model);
        setStatus(`正在生成 ${requestIndex + 1}/${requests.length} · ${request.title} · ${model.name} 基础 ${model.pointCost} 积分`);
        const scope = `${MANIFEST_SCOPE}:${request.key}`;
        let created: Awaited<ReturnType<typeof aiApi.generateIdempotent>>;
        let reconnectNoticeShown = false;
        for (;;) {
          created = await aiApi.generateIdempotent({
            handler: "skill_text_completion",
            modelId: model.modelId,
            entryPoint: "studio",
            targetType: "text",
            input: {
              prompt,
              strictJson: true,
              systemPrompt: "你是 FlowingLight Skill 运行配置设计器。严格遵守字段和处理器白名单，只返回 JSON，绝不填写 modelId。",
            },
          }, scope, {
            requireDurableJournal: true,
            retainAccepted: true,
            dedupeActivePayload: true,
            ownerUserId: owner,
          });
          if (!active()) return;
          if (created.success && created.data?.id) break;
          if (!isAmbiguousAiCreateCode(created.code)) throw new Error(created.message || "Manifest 生成请求失败");
          if (!reconnectNoticeShown) {
            reconnectNoticeShown = true;
            toast.info("Manifest 请求正在确认中，请保持当前页面打开");
          }
          await wait(3_000);
        }
        const taskId = String(created.data.id);
        taskIdRef.current = taskId;
        ownerRef.current = owner;
        scopeRef.current = scope;
        const deadline = Date.now() + TASK_TIMEOUT_MS;
        for (;;) {
          if (!active()) return;
          if (Date.now() >= deadline) {
            await aiApi.cancelTask(taskId).catch(() => undefined);
            await release(taskId, owner, scope);
            throw new Error(`“${request.title}”的 Manifest 生成超时，任务已停止`);
          }
          const response = await aiApi.getTask(taskId);
          if (!active()) return;
          if (!response.success || !response.data) {
            if (response.code === 400 || response.code === 403 || response.code === 404) {
              await release(taskId, owner, scope);
              throw new Error(response.message || "无法继续获取 Manifest 任务");
            }
            await wait(POLL_INTERVAL_MS);
            continue;
          }
          const task = response.data;
          if (task.status === AiTaskStatus.SUCCESS) {
            const rawManifest = taskText(task);
            await release(taskId, owner, scope);
            const manifest = sanitizeManifest(rawManifest, request);
            const draft = { key: request.key, signature: request.signature, manifest };
            results.push(draft);
            onGenerated([draft]);
            break;
          }
          if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
            await release(taskId, owner, scope);
            throw new Error(task.errorMsg || `“${request.title}”的 Manifest 生成失败`);
          }
          await wait(POLL_INTERVAL_MS);
        }
      }
      if (!active()) return;
      setStatus(`已生成 ${results.length} 份草稿，请检查 JSON 后再保存或导入。`);
      toast.success("Manifest 草稿已生成，请确认后继续");
    } catch (error) {
      if (active()) {
        const message = error instanceof Error ? error.message : "Manifest 生成失败";
        setStatus(message);
        toast.error(message);
      }
    } finally {
      if (active()) setGenerationBusy(false);
    }
  };

  return (
    <div className="adm-skill-manifest-ai">
      <div>
        <strong><Sparkles aria-hidden size={14} />AI Manifest</strong>
        <span role="status" aria-live="polite">{status}</span>
      </div>
      {busy ? (
        <button type="button" className="adm-btn ghost" disabled={stopping} onClick={() => void stop()}>
          {stopping ? "正在停止…" : "停止生成"}
        </button>
      ) : (
        <button type="button" className="adm-btn ghost" disabled={disabled} onClick={() => void generate()}>
          <Sparkles aria-hidden size={14} />生成 Manifest 草稿
        </button>
      )}
    </div>
  );
}
