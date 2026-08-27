/* 参考素材「数量」上限的唯一来源：全部取自后台「模型管理」的模型 config。
   服务端 internal/handler/ai/reference_count_limit.go 是同一份映射，两端必须一致改。

   本模块刻意零依赖（不引 @/ 别名、不引类型模块）：Node 原生 TS 测试无法解析路径
   别名，把纯规则留在这里才能被直接测到。大小上限见 upload-limits.ts。 */

export type ReferenceCountKind = "image" | "video" | "audio";

/** 只接受配置对象的形状，这样 ModelConfig 与 parse 出来的 Record 都能直接传进来。 */
export interface ReferenceCountConfig {
  maxRefImages?: unknown;
  refLimits?: unknown;
}

const KIND_LABELS: Record<ReferenceCountKind, string> = {
  image: "参考图片",
  video: "参考视频",
  audio: "参考音频",
};

function refLimitsOf(config: ReferenceCountConfig): Record<string, unknown> {
  const raw = config.refLimits;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/** 该模式下这类素材的数量上限；0 / 未配置 / 非法值 = 不限制（undefined）。
 *  handler 为空表示该模式不套用数量配置（首尾帧用固定首/尾帧框，3D 只配大小）。 */
export function referenceCountLimitOf(
  config: ReferenceCountConfig | null | undefined,
  kind: ReferenceCountKind,
  handler?: string,
): number | undefined {
  if (!config || !handler) return undefined;
  const refLimits = refLimitsOf(config);
  const configured = handler === "image_to_image"
    ? kind === "image" ? config.maxRefImages : undefined
    : handler === "image_to_video"
      ? kind === "image" ? refLimits["i2v.imageCount"] : undefined
      : handler === "start_end_to_video"
        ? kind === "image" ? refLimits["keyframe.imageCount"] : undefined
        : handler === "reference_to_video"
          ? refLimits[`omniRef.${kind}Count`]
          : undefined;
  const count = typeof configured === "number" ? configured : Number(configured);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : undefined;
}

/** 提交前复检：返回第一条超限说明，全部合规时返回 null。 */
export function referenceCountIssue(
  config: ReferenceCountConfig | null | undefined,
  handler: string | undefined,
  counts: Partial<Record<ReferenceCountKind, number>>,
): string | null {
  for (const kind of ["image", "video", "audio"] as ReferenceCountKind[]) {
    const count = counts[kind] ?? 0;
    const limit = referenceCountLimitOf(config, kind, handler);
    if (limit && count > limit) {
      return `当前模型最多支持 ${limit} 个${KIND_LABELS[kind]}，当前为 ${count} 个，请移除多余素材后重试`;
    }
  }
  return null;
}
