import type { SkillAdaptationReport } from "../types/admin-skill";
import type { AiModelVO } from "../types/ai";

export interface SkillAdaptationDraft {
  instructions: string;
  report: SkillAdaptationReport;
}

export function skillAdaptationCapabilities(models: AiModelVO[]): string {
  const handlers: Record<string, string[]> = {
    image: ["text_to_image", "image_to_image"],
    video: ["text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"],
    audio: ["text_to_audio"],
  };
  const offered = new Set<string>();
  for (const model of models) {
    let config: Record<string, unknown> = {};
    try { config = typeof model.config === "string" ? JSON.parse(model.config) : model.config || {}; } catch { /* no optional metadata */ }
    if (config?.availabilityStatus === "maintenance") continue;
    for (const handler of handlers[model.type] ?? []) {
      if (!model.supportedHandlers?.length || model.supportedHandlers.includes(handler)) offered.add(handler);
    }
  }
  return JSON.stringify({
    generationHandlers: [...offered],
    analysisHandlers: ["analyze_image", "analyze_video", "analyze_audio", "analyze_webpage"],
    fileHandlers: ["render_pptx", "render_docx", "render_xlsx", "render_markdown"],
    notes: "分析处理器仍需对应媒体输入能力的文本模型；最终导入由服务端核验当前可用模型。",
  });
}

export const SKILL_ADAPTATION_RULES = `
平台适配要求（本次已由管理员开启）：
- 输出可独立运行的适配版正文。融合必要的专业知识和参考资料；不写 YAML，不再引用原始文件，不留下外部 CLI、API Key、供应商 endpoint 或本地脚本执行要求。
- 原文需要实际生图/生视频/生音频时，把其第三方调用替换为本站已开放的 generationHandlers，并在 Manifest 写明对应步骤；全部经本站执行和计费。不能把生成步骤仅改成“写提示词”。若本站当前没有对应能力，列为移除/受限，不能虚构可用模型。
- 不执行 Bash、Python、npm、git、HTTP 脚本、浏览器自动化、网页构建部署或任意代码。没有白名单处理器的能力明确移除。视频拼接、逐帧链式生成、自动抽末帧回传、网页打包均未在此 Skill 运行时开放。
- generate 步骤当前只读取用户输入素材；{{previous}} 只能作为文本提示，不是生成结果的素材绑定。不能承诺前一步图片自动成为下一步视频首尾帧；这种原流程需要移除或改为用户提供参考图，并列清限制。
- 只能保留原意中有意义的可执行子集；如果去掉依赖后没有可交付的核心价值，status=blocked，说明原因，不捏造“适配成功”。
- 文本和分析步骤会使用适配版正文作为系统规则；媒体 generate 步骤不会自动附加正文，step.prompt 必须写入必要的风格与一致性要求，并结合 {{prompt}} 或 {{previous}}，不能只留一句空泛的“生成图片”。
- 删除能力后 status=partial，使用说明、样例、输出类型和新正文必须同步收缩，不再承诺被删除的结果。不能宣称完美复刻原 Skill。
- replacements 的每个 handler 必须实际出现在 Manifest 步骤中；改接生成时使用 agent + 显式 steps。不映射的纯文本任务可用无步骤 agent，replacements 留空。
- 付费媒体生成前尽量保留原 Skill 的用户确认步骤；不得引入无意义的额外收费模型调用。
- 不填 modelId、base_url、api_key，不修改鉴权、积分、上架或 MCP 开关。最后需由管理员审核变更再导入。
`;

export function parseSkillAdaptation(value: unknown, manifest: Record<string, unknown>): SkillAdaptationDraft {
  const fail = (message: string): never => { throw new Error(`Skill 平台适配校验失败：${message}`); };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("缺少适配说明，请重新生成");
  const data = value as Record<string, unknown>;
  const keys = new Set(["status", "summary", "instructions", "replacements", "removed", "limitations"]);
  if (Object.keys(data).some(key => !keys.has(key))) fail("包含未知配置字段");
  const text = (value: unknown, limit: number): string => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || [...value].length > limit) return fail("说明缺失或超过长度限制");
    return value.trim();
  };
  const summary = text(data.summary, 1000);
  if (data.status === "blocked") fail(`无法适配：${summary}`);
  if (data.status !== "ready" && data.status !== "partial") fail("适配状态无效");
  const list = (value: unknown, limit: number): unknown[] => {
    if (!Array.isArray(value) || value.length > limit) return fail("能力变更清单无效");
    return value;
  };
  const stepHandlers = new Set((Array.isArray(manifest.steps) ? manifest.steps : []).map(step => step?.handler));
  const replacements = list(data.replacements, 24).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("替换项无效");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !["from", "to", "handler"].includes(key))) return fail("替换项含额外参数");
    const handler = text(row.handler, 64);
    if (!stepHandlers.has(handler)) return fail(`声明使用 ${handler}，但运行流程中没有对应步骤`);
    return { from: text(row.from, 300), to: text(row.to, 500), handler };
  });
  const removed = list(data.removed, 24).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("移除项无效");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !["feature", "reason"].includes(key))) return fail("移除项含额外参数");
    return { feature: text(row.feature, 300), reason: text(row.reason, 500) };
  });
  const limitations = list(data.limitations, 12).map(item => text(item, 500));
  if (removed.length && data.status !== "partial") fail("删除能力后必须标记为部分适配");
  if (data.status === "partial" && !removed.length && !limitations.length) fail("部分适配必须说明限制");
  const instructions = text(data.instructions, 32000);
  if (instructions.includes("{{skill.")) fail("适配版不能继续引用原始文件");
  return { instructions, report: { status: data.status as "ready" | "partial", summary, replacements, removed, limitations } };
}
