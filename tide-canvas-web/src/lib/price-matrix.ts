/**
 * 价格矩阵容错查找 —— 与服务端 resolveCost（pricing.go 的 matrixLookupFuzzy）
 * 同口径：键大小写、时长带不带 "s"、行列轴序全部兼容。显示端与计费端必须
 * 用同一套规则，否则会出现「界面显示一个价、实际扣另一个价」。
 * 矩阵单元格兼容 number 与数字字符串（后台历史数据两种都有）。
 */

export type PriceMatrix = Record<string, Record<string, number | string>> | undefined;

export interface PointPricingConfig {
  priceMatrix?: PriceMatrix;
  /** 服务端 resolveCost 长期兼容的旧字段。 */
  pricing?: PriceMatrix;
  /** 普通视频缺省按时长矩阵计费；per_request 时完全忽略 duration。 */
  videoBillingMode?: "duration" | "per_request" | string;
  /** 普通视频按输出分辨率配置的单次积分。 */
  pricePerRequestByResolution?: Record<string, number | string>;
  resolutions?: string[];
  priceModifiers?: unknown;
  /** 视频超分每秒积分；配置后优先于所有旧版单次价格。 */
  pricePerSecond?: number | string;
  /** 视频超分按目标分辨率设置的每秒积分。 */
  pricePerSecondByResolution?: Record<string, number | string>;
  creditCost?: number | string;
}

/** 一个轴键的大小写候选（原样 / 小写 / 大写，去重）。 */
export function keyVariants(k: string | number): string[] {
  const s = String(k).trim();
  if (!s) return [];
  return Array.from(new Set([s, s.toLowerCase(), s.toUpperCase()]));
}

/** 时长轴额外兼容 "s" 后缀两种写法（后台存 "4s"，选择器里是数字 4）。 */
export function durationVariants(k: string | number): string[] {
  const base = String(k).trim();
  if (!base) return [];
  const alt = base.endsWith("s") ? base.slice(0, -1) : `${base}s`;
  return Array.from(new Set([...keyVariants(base), ...keyVariants(alt)]));
}

/** 逐候选组合查矩阵（两种嵌套轴序都试），命中第一个正数即返回；未命中 undefined。 */
export function matrixPrice(matrix: PriceMatrix, aKeys: string[], bKeys: string[]): number | undefined {
  if (!matrix) return undefined;
  for (const a of aKeys) {
    for (const b of bKeys) {
      for (const v of [matrix[a]?.[b], matrix[b]?.[a]]) {
        if (v == null) continue;
        const n = typeof v === "number" ? v : parseFloat(String(v));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return undefined;
}

function positivePointValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * 服务端把 MarketModel.Price 转成 AiModel 时使用 IntPart；只有 config.creditCost
 * 保留小数后再向上取整。这里必须复刻这个旧数据语义，不能直接 ceil 市场价。
 */
function fixedPointCost(config: PointPricingConfig | null | undefined, modelPointCost?: number | string): number {
  const override = positivePointValue(config?.creditCost);
  return override || Math.trunc(positivePointValue(modelPointCost));
}

export function configuredMatrix(config: PointPricingConfig | null | undefined): PriceMatrix {
  const primary = config?.priceMatrix;
  return primary && Object.keys(primary).length ? primary : config?.pricing;
}

export function usesVideoPerRequestBilling(config: PointPricingConfig | null | undefined): boolean {
  return String(config?.videoBillingMode ?? "").trim().toLowerCase() === "per_request";
}

/** Case-insensitive resolution lookup. Duplicate case variants fail closed. */
export function videoPerRequestRate(
  config: PointPricingConfig | null | undefined,
  resolution: string,
): number {
  const target = String(resolution ?? "").trim().toLowerCase();
  if (!target) return 0;
  const supported = config?.resolutions ?? [];
  if (!supported.length || !supported.some(
    (item) => typeof item === "string" && item.trim().toLowerCase() === target,
  )) return 0;
  let found = false;
  let rate = 0;
  for (const [key, value] of Object.entries(config?.pricePerRequestByResolution ?? {})) {
    if (key.trim().toLowerCase() !== target) continue;
    if (found) return 0;
    found = true;
    rate = positivePointValue(value);
    if (rate > Number.MAX_SAFE_INTEGER) return 0;
  }
  return rate;
}

export interface VideoPerRequestPointRange {
  min: number;
  max: number;
}

/** Complete, rounded price range for a per-request video model. Invalid or
 * partially priced configs return null instead of falling back to pointCost. */
export function videoPerRequestPointRange(
  config: PointPricingConfig | null | undefined,
): VideoPerRequestPointRange | null {
  if (!usesVideoPerRequestBilling(config)) return null;
  const resolutions = config?.resolutions ?? [];
  if (!resolutions.length) return null;

  const seen = new Set<string>();
  const rates: number[] = [];
  for (const resolution of resolutions) {
    const key = String(resolution ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const rate = videoPerRequestRate(config, resolution);
    if (rate <= 0) return null;
    rates.push(Math.ceil(rate));
  }
  return { min: Math.min(...rates), max: Math.max(...rates) };
}

/**
 * 普通视频积分预估，与服务端 resolveCost 顺序一致。按次模式只按分辨率
 * 取价，不读取也不乘 duration；按时长模式继续保留旧矩阵和 modifier 回退。
 */
export function resolveVideoPointCost(
  config: PointPricingConfig | null | undefined,
  duration: string | number,
  resolution: string,
  modelPointCost?: number | string,
): number {
  if (usesVideoPerRequestBilling(config)) {
    const rate = videoPerRequestRate(config, resolution);
    return rate > 0 ? Math.ceil(rate) : 0;
  }

  let base = matrixPrice(
    configuredMatrix(config),
    durationVariants(duration),
    keyVariants(resolution),
  );
  if (base == null && resolution) {
    const modifiers = config?.priceModifiers as PriceMatrix;
    base = matrixPrice(
      modifiers,
      keyVariants(`duration@${resolution}`),
      durationVariants(duration),
    );
  }
  base ??= fixedPointCost(config, modelPointCost);
  return base > 0 ? Math.ceil(base) : 0;
}

function imageBatchCount(input: Record<string, unknown>): number {
  const raw = input.batchCount ?? input.batch;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.trunc(parsed), 4);
}

/**
 * 视频超分每秒积分。新配置按目标分辨率取价；旧版统一每秒价只用于滚动升级。
 */
export function resolveUpscalePointRate(
  config: PointPricingConfig | null | undefined,
  resolution: string,
): number {
  const target = String(resolution ?? "").trim().toLowerCase();
  const rates = Object.entries(config?.pricePerSecondByResolution ?? {});
  if (rates.length) {
    for (const [key, value] of rates) {
      if (key.trim().toLowerCase() === target) return positivePointValue(value);
    }
    return 0;
  }
  return positivePointValue(config?.pricePerSecond);
}

/**
 * 视频超分积分预估。按目标分辨率每秒积分 × 浏览器读取的源视频秒数向上取整。
 * 服务端会重新读取媒体时长并给出最终权威积分；前端结果仅用于提交前预估。
 */
export function resolveUpscalePointCost(
  config: PointPricingConfig | null | undefined,
  durationSeconds: number,
  resolution: string,
  modelPointCost?: number | string,
): number {
  void modelPointCost;
  const rate = resolveUpscalePointRate(config, resolution);
  return rate > 0 && durationSeconds > 0 ? Math.ceil(rate * durationSeconds) : 0;
}


/** 图片智能工具的单次积分预估；输入字段与服务端 resolveCost 同名。 */
export function resolveImageToolPointCost(
  config: PointPricingConfig | null | undefined,
  input: Record<string, unknown>,
  modelPointCost?: number | string,
): number {
  const stringField = (key: string) => typeof input[key] === "string" ? String(input[key]).trim() : "";
  const resolution = stringField("resolution");
  const clarity = stringField("clarity") || resolution;
  const quality = stringField("quality") || "default";
  const matrixCost = matrixPrice(configuredMatrix(config), keyVariants(quality), keyVariants(clarity));
  const base = matrixCost ?? fixedPointCost(config, modelPointCost);
  return base > 0 ? Math.ceil(base * imageBatchCount(input)) : 0;
}
