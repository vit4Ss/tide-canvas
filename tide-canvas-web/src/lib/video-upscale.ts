interface UpscaleModelRef {
  modelKey?: string;
}

/** 新 RH 任务明确保持源帧率，避免后台默认值改变实际输出。 */
export const RH_UPSCALE_DEFAULT_FPS = "1x";

export const RH_UPSCALE_LEVELS = [
  { value: "max", label: "最高（max）" },
  { value: "high", label: "高（high）" },
  { value: "medium", label: "中（medium）" },
  { value: "low", label: "低（low）" },
] as const;

export const RH_UPSCALE_OUTPUT_FPS = [
  "1x", "2x", "3x", "4x", "23.976", "24", "25", "29.97", "30", "48", "50",
  "59.94", "60", "72", "90", "96", "120", "144",
] as const;

export function isRhUpscaleModel(model: UpscaleModelRef | null): boolean {
  return model?.modelKey?.trim().toLowerCase() === "rh-upscale";
}

/** 报价、提交、列表预估共用同一档位；缺省固定 max，避免 relay 默认值改变计费。 */
export function effectiveRhUpscaleLevel(
  model: UpscaleModelRef | null,
  selected: string,
  defaults?: Record<string, unknown>,
): string {
  if (!isRhUpscaleModel(model)) return "";
  const input = record(defaults);
  const level = selected || input.upscaleModel || input.upscale_model || record(input.extras).upscale_model || "max";
  return String(level).trim().toLowerCase();
}

/** 冻结的任务可能使用行 ID 或上游 key；恢复与新提交都解析到同一模型。 */
export function selectUpscaleModel<T extends UpscaleModelRef & { id: string }>(
  models: readonly T[],
  selectedId: string,
): T | null {
  return models.find((model) => model.id === selectedId)
    ?? models.find((model) => model.modelKey === selectedId)
    ?? models[0]
    ?? null;
}

export function rhUpscaleInput(
  model: UpscaleModelRef | null,
  outputFps: string,
  upscaleModel: string,
): Record<string, string> {
  if (!isRhUpscaleModel(model)) return {};
  return {
    outputFps: outputFps.trim() || RH_UPSCALE_DEFAULT_FPS,
    ...(upscaleModel ? { upscaleModel } : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** 通用工具默认值也要过滤 RH 参数，防止切换模型后携带旧顶层或 extras 写法。 */
export function videoUpscaleDefaults(
  model: UpscaleModelRef | null,
  defaults?: Record<string, unknown>,
): Record<string, unknown> {
  const input = { ...defaults };
  if (isRhUpscaleModel(model)) return input;
  for (const key of ["outputFps", "output_fps", "upscaleModel", "upscale_model"]) delete input[key];
  if (input.extras && typeof input.extras === "object" && !Array.isArray(input.extras)) {
    const extras = { ...record(input.extras) };
    delete extras.output_fps;
    delete extras.upscale_model;
    if (Object.keys(extras).length) input.extras = extras;
    else delete input.extras;
  }
  return input;
}

/** 冻结请求是参数的权威来源；兼容早期只有 recovery、snake_case 或 extras 的记录。 */
export function recoveredUpscaleSettings(entry: {
  payload?: { modelId?: string; input?: Record<string, unknown> };
  recovery?: unknown;
}): { modelId: string; outputFps: string; upscaleModel: string } {
  const input = record(entry.payload?.input);
  const extras = record(input.extras);
  const recovery = record(entry.recovery);
  const fps = input.outputFps ?? input.output_fps ?? extras.output_fps ?? recovery.outputFps;
  const level = input.upscaleModel ?? input.upscale_model ?? extras.upscale_model ?? recovery.upscaleModel;
  const modelId = entry.payload?.modelId ?? recovery.modelId;
  return {
    modelId: typeof modelId === "string" ? modelId : "",
    outputFps: typeof fps === "string" || typeof fps === "number" ? String(fps) : "",
    upscaleModel: typeof level === "string" ? level : "",
  };
}
