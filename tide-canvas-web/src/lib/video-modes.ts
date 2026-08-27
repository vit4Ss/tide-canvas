/* 视频模式别名归一化。

   各家 relay 在 params_schema.modes 里的命名并不统一（multi_ref / omni_reference /
   reference_image / first_frame / start_end …），服务端
   internal/handler/ai/model_adapter.go 的 videoHandlersFromMetadata 已经把它们归一
   到四个 handler，再据此决定模型支持哪些生成方式。

   后台配置页必须用同一套口径：否则会出现「服务端认为模型支持全能参考、画布节点也
   照常显示，但后台的『全能参考 · 素材能力与限制』区块不显示」——那几个数量/大小
   限制就永远填不进去。2026-08-27 的 15 张参考图事故正是卡在这里。

   本模块零依赖，便于 Node 原生 TS 测试直接导入。 */

export type VideoMode = "t2v" | "i2v" | "keyframe" | "omni_ref";

// 与 videoHandlersFromMetadata 的 switch 一一对应。
const EXACT_ALIASES: Record<string, VideoMode> = {
  t2v: "t2v",
  text2video: "t2v",
  text_video: "t2v",
  text_to_video: "t2v",
  i2v: "i2v",
  image2video: "i2v",
  image_video: "i2v",
  image_to_video: "i2v",
  first_frame: "i2v",
  keyframe: "keyframe",
  key_frame: "keyframe",
  first_last: "keyframe",
  first_last_frame: "keyframe",
  start_end: "keyframe",
  start_end_to_video: "keyframe",
  omni_ref: "omni_ref",
  omni_reference: "omni_ref",
  multi_ref: "omni_ref",
  multi_reference: "omni_ref",
  reference_image: "omni_ref",
  reference_to_video: "omni_ref",
  subject_reference: "omni_ref",
};

/** 单个模式名 → 规范模式；认不出返回 null。 */
export function normalizeVideoMode(raw: unknown): VideoMode | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase().replace(/[-\s/]/g, "_");
  if (!value) return null;
  const exact = EXACT_ALIASES[value];
  if (exact) return exact;
  // 与服务端的 default 分支同序：先 reference，再 keyframe，最后 text/image。
  if (value.includes("reference") || value.includes("multi_ref") || value.includes("omni_ref")) return "omni_ref";
  if (value.includes("keyframe") || (value.includes("first") && value.includes("last"))) return "keyframe";
  if (value.includes("text") && value.includes("video")) return "t2v";
  if (value.includes("image") && value.includes("video")) return "i2v";
  return null;
}

/** 一组模式名 → 去重后的规范模式列表（顺序固定，便于展示与断言）。 */
export function normalizeVideoModes(...sources: unknown[]): VideoMode[] {
  const seen = new Set<VideoMode>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const mode = normalizeVideoMode(item);
      if (mode) seen.add(mode);
    }
  }
  return (["t2v", "i2v", "keyframe", "omni_ref"] as VideoMode[]).filter((mode) => seen.has(mode));
}
