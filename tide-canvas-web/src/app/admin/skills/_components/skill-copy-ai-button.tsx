"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

const COPY_TASK_SCOPE = "admin:skill-copy";
const COPY_POLL_INTERVAL_MS = 1_500;
const COPY_TASK_TIMEOUT_MS = 3 * 60_000;

export interface GeneratedSkillCopy {
  description: string;
  usageScenario: string;
  howTo: string;
  outputDescription: string;
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

function supportsSkillText(model: AiModelVO): boolean {
  if (model.type !== "text") return false;
  const handlers = model.supportedHandlers?.filter(Boolean) ?? [];
  return parseModelConfig(model).availabilityStatus !== "maintenance" &&
    (!handlers.length || handlers.includes("skill_text_completion"));
}

function taskText(task: AiTaskVO): string {
  let meta: unknown = task.resultMeta;
  if (typeof meta === "string") {
    const raw = meta;
    try {
      meta = JSON.parse(raw) as unknown;
    } catch {
      return raw.trim();
    }
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const record = meta as Record<string, unknown>;
  for (const key of ["answer", "content", "text", "message", "response", "output"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseJSONText(raw: string): Record<string, unknown> | null {
  const unfenced = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
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

function limitedText(value: unknown, maxCharacters: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value.trim()).slice(0, maxCharacters).join("");
}

export function parseGeneratedSkillCopy(raw: string): GeneratedSkillCopy | null {
  const parsed = parseJSONText(raw);
  if (!parsed) return null;
  const result = {
    description: limitedText(parsed.description, 255),
    usageScenario: limitedText(parsed.usageScenario, 2000),
    howTo: limitedText(parsed.howTo ?? parsed.usageGuide, 2000),
    outputDescription: limitedText(parsed.outputDescription, 2000),
  };
  return Object.values(result).every(Boolean) ? result : null;
}

function excerpt(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= maxCharacters
    ? characters.join("")
    : `${characters.slice(0, maxCharacters).join("")}…`;
}

function buildCopyPrompt({
  source,
  title,
  category,
  kind,
  outputType,
  model,
}: {
  source: string;
  title: string;
  category: string;
  kind: SkillKind;
  outputType: SkillOutputType;
  model: AiModelVO;
}): string {
  const config = parseModelConfig(model);
  const modelLimit = modelPromptCharLimit(config);
  const sourceLimit = Math.max(100, Math.min(16_000, modelLimit ? modelLimit - 900 : 16_000));
  return `请根据下面的 Skill 定义，为技能广场生成准确、具体、面向普通用户的运营说明。

技能名称：${excerpt(title, 64) || "未命名 Skill"}
分类：${excerpt(category, 32) || "通用技能"}
执行形态：${kind}
主输出类型：${outputType}

<skill_definition>
${excerpt(source, sourceLimit)}
</skill_definition>

只返回严格 JSON 对象，不要代码围栏，不要解释：
{"description":"不超过255字的一句话核心介绍","usageScenario":"具体说明适合哪些用户、任务和使用时机","howTo":"说明用户应提供哪些信息或素材，以及如何得到更好结果","outputDescription":"说明最终会得到什么、包含哪些内容及质量标准"}

要求：四个字段都必须是非空中文字符串；忠实依据 Skill 定义，不虚构平台、模型、自动化或外部工具能力；不要写宣传口号，不要重复同一句话。`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SkillCopyAiButton({
  models,
  missingCount,
  title,
  category,
  kind,
  outputType,
  disabled = false,
  loadSkillSource,
  onGenerated,
  onBusyChange,
}: {
  models: AiModelVO[];
  missingCount: number;
  title: string;
  category: string;
  kind: SkillKind;
  outputType: SkillOutputType;
  disabled?: boolean;
  loadSkillSource: () => Promise<string>;
  onGenerated: (copy: GeneratedSkillCopy) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const compatibleModels = useMemo(() => models
    .filter(supportsSkillText)
    .sort((left, right) => Number(parseModelConfig(right).aiOptimizePrimary === true) - Number(parseModelConfig(left).aiOptimizePrimary === true)), [models]);
  const model = compatibleModels[0];
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const runRef = useRef(0);
  const taskIdRef = useRef("");
  const taskOwnerRef = useRef("");
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    runRef.current += 1;
    const taskId = taskIdRef.current;
    const ownerUserId = taskOwnerRef.current;
    taskIdRef.current = "";
    taskOwnerRef.current = "";
    if (taskId) {
      void aiApi.cancelTask(taskId).finally(() => {
        return commitAcceptedAiGeneration(COPY_TASK_SCOPE, taskId, ownerUserId);
      }).catch(() => undefined);
    }
  }, []);

  const setGenerationBusy = (next: boolean) => {
    if (!mountedRef.current) return;
    setBusy(next);
    onBusyChange(next);
  };

  const stop = async () => {
    const taskId = taskIdRef.current;
    const ownerUserId = taskOwnerRef.current;
    runRef.current += 1;
    taskIdRef.current = "";
    taskOwnerRef.current = "";
    setProgress(0);
    setGenerationBusy(false);
    if (!taskId) {
      toast.info("已停止等待；若请求已经受理，可在生成记录中查看结果");
      return;
    }
    await aiApi.cancelTask(taskId).catch(() => undefined);
    await commitAcceptedAiGeneration(COPY_TASK_SCOPE, taskId, ownerUserId).catch(() => undefined);
    toast.info("AI 说明生成已停止");
  };

  const generate = async () => {
    if (busy || disabled || missingCount === 0) return;
    if (!model) {
      toast.error("暂无可用于 Skill 说明生成的文本模型");
      return;
    }
    setGenerationBusy(true);
    setProgress(1);
    const run = ++runRef.current;
    const active = () => mountedRef.current && runRef.current === run;
    let reconnectNoticeShown = false;
    try {
      const source = (await loadSkillSource()).trim();
      if (!active()) return;
      if (!source) throw new Error("没有读取到 Skill 内容，请先填写或检查当前发布版本");
      const prompt = buildCopyPrompt({ source, title, category, kind, outputType, model });
      const issue = modelPromptLimitIssue(prompt, parseModelConfig(model));
      if (issue) throw new Error(issue.message);
      if (!(await useAuthStore.getState().ensureSession())) return;
      const ownerUserId = useAuthStore.getState().user?.id ?? "";
      if (!ownerUserId) throw new Error("无法确认当前账号，生成任务尚未启动");

      let created: Awaited<ReturnType<typeof aiApi.generateIdempotent>>;
      for (;;) {
        created = await aiApi.generateIdempotent({
          handler: "skill_text_completion",
          modelId: model.modelId,
          entryPoint: "studio",
          targetType: "text",
          input: {
            prompt,
            strictJson: true,
            systemPrompt: "你是 AI 创作产品的技能运营编辑。只依据提供的 Skill 定义生成真实、清晰、可直接展示的中文说明，并严格返回 JSON。",
          },
        }, COPY_TASK_SCOPE, {
          requireDurableJournal: true,
          retainAccepted: true,
          dedupeActivePayload: true,
          ownerUserId,
        });
        if (!active()) return;
        if (created.success && created.data?.id) break;
        if (!isAmbiguousAiCreateCode(created.code)) {
          throw new Error(created.message || "AI 说明生成请求失败");
        }
        if (!reconnectNoticeShown) {
          reconnectNoticeShown = true;
          toast.info("生成请求正在确认中，请保持当前页面打开");
        }
        await wait(3_000);
      }

      const taskId = String(created.data.id);
      taskIdRef.current = taskId;
      taskOwnerRef.current = ownerUserId;
      const deadline = Date.now() + COPY_TASK_TIMEOUT_MS;
      for (;;) {
        if (!active()) return;
        if (Date.now() >= deadline) {
          await aiApi.cancelTask(taskId).catch(() => undefined);
          taskIdRef.current = "";
          taskOwnerRef.current = "";
          await commitAcceptedAiGeneration(COPY_TASK_SCOPE, taskId, ownerUserId).catch(() => undefined);
          throw new Error("AI 说明生成等待超时，任务已停止");
        }
        const response = await aiApi.getTask(taskId);
        if (!active()) return;
        if (!response.success || !response.data) {
          if (response.code === 400 || response.code === 403 || response.code === 404) {
            taskIdRef.current = "";
            taskOwnerRef.current = "";
            await commitAcceptedAiGeneration(COPY_TASK_SCOPE, taskId, ownerUserId).catch(() => undefined);
            throw new Error(response.message || "无法继续获取 AI 说明任务");
          }
          await wait(COPY_POLL_INTERVAL_MS);
          continue;
        }
        const task = response.data;
        setProgress(Math.max(1, Math.min(99, task.progress || 0)));
        if (task.status === AiTaskStatus.SUCCESS) {
          const copy = parseGeneratedSkillCopy(taskText(task));
          taskIdRef.current = "";
          taskOwnerRef.current = "";
          await commitAcceptedAiGeneration(COPY_TASK_SCOPE, taskId, ownerUserId).catch(() => undefined);
          if (!copy) throw new Error("文本模型已返回结果，但说明字段不完整，请重试");
          onGenerated(copy);
          setProgress(100);
          toast.success("AI 已补全空白说明，请检查后保存");
          return;
        }
        if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
          taskIdRef.current = "";
          taskOwnerRef.current = "";
          await commitAcceptedAiGeneration(COPY_TASK_SCOPE, taskId, ownerUserId).catch(() => undefined);
          throw new Error(task.errorMsg || "AI 说明生成失败");
        }
        await wait(COPY_POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (active()) toast.error(error instanceof Error ? error.message : "AI 说明生成失败");
    } finally {
      if (active()) setGenerationBusy(false);
    }
  };

  return (
    <div className="adm-skill-copy-ai">
      <div>
        <strong>{missingCount ? `还缺 ${missingCount} 项说明` : "说明已经完整"}</strong>
        <span>{model ? `使用 ${model.name} · 基础价格 ${model.pointCost} 积分 · 只补空白，不覆盖已有内容` : "请先在模型管理上架可用文本模型"}</span>
      </div>
      {busy ? (
        <div className="adm-skill-copy-ai-actions">
          <span role="status" aria-live="polite">生成中{progress > 1 ? ` · ${progress}%` : ""}</span>
          <button type="button" className="adm-btn ghost" onClick={() => void stop()}>停止</button>
        </div>
      ) : (
        <button type="button" className="adm-btn ghost" disabled={disabled || !model || missingCount === 0} onClick={() => void generate()}>
          <Sparkles aria-hidden size={14} />AI 自动填写
        </button>
      )}
    </div>
  );
}
