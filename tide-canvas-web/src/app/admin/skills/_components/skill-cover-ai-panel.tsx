"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { aiApi } from "@/lib/api";
import {
  commitAcceptedAiGeneration,
  isAmbiguousAiCreateCode,
} from "@/lib/ai-generation-idempotency";
import { modelPromptLimitIssue, promptCharacterCount } from "@/lib/model-prompt-limit";
import { useAuthStore } from "@/stores/use-auth-store";
import { AiTaskStatus, type AiModelVO, type AiTaskVO } from "@/types/ai";
import type { ModelConfig } from "@/types/admin-models";
import { toast } from "@/components/shared/toast";

const COVER_RATIO = "16:9";
const MAX_COVER_PROMPT_CHARS = 10_000;
const COVER_POLL_INTERVAL_MS = 1_500;
const COVER_TASK_TIMEOUT_MS = 5 * 60_000;

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

function supportsTextToImage(model: AiModelVO): boolean {
  if (model.type !== "image") return false;
  const handlers = model.supportedHandlers?.filter(Boolean) ?? [];
  if (handlers.length && !handlers.includes("text_to_image")) return false;
  const config = parseModelConfig(model);
  if (config.availabilityStatus === "maintenance") return false;
  return !config.ratios?.length || config.ratios.includes(COVER_RATIO);
}

function imageResultUrl(task: AiTaskVO): string {
  if (typeof task.resultUrl === "string" && task.resultUrl.trim()) return task.resultUrl.trim();
  try {
    const meta = typeof task.resultMeta === "string" ? JSON.parse(task.resultMeta) : task.resultMeta;
    if (Array.isArray(meta?.urls)) {
      const first = meta.urls.find((item: unknown) => typeof item === "string" && item.trim());
      if (typeof first === "string") return first.trim();
    }
  } catch {
    // A malformed optional metadata object must not hide a valid task failure.
  }
  return "";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function excerpt(value: string, maxCharacters: number): string {
  const clean = value.trim();
  const characters = Array.from(clean);
  return characters.length <= maxCharacters
    ? clean
    : `${characters.slice(0, maxCharacters).join("")}…`;
}

export function buildSkillCoverPrompt({
  title,
  description,
  category,
  usageScenario,
  outputDescription,
}: {
  title: string;
  description: string;
  category: string;
  usageScenario: string;
  outputDescription: string;
}): string {
  const skillName = excerpt(title, 64) || "未命名 AI 技能";
  const details = [
    description.trim() && `核心能力：${excerpt(description, 255)}`,
    category.trim() && `所属类别：${excerpt(category, 32)}`,
    usageScenario.trim() && `使用场景：${excerpt(usageScenario, 400)}`,
    outputDescription.trim() && `输出内容：${excerpt(outputDescription, 400)}`,
  ].filter(Boolean).join("\n");
  return `为 AI 创作平台中的技能“${skillName}”设计一张 16:9 横版封面图。
${details ? `${details}\n` : ""}画面应准确表达该技能的用途，主体明确、构图简洁、层次清晰，具有成熟商业产品质感。不要出现任何文字、字母、数字、Logo、水印、边框或界面截图。`;
}

export function SkillCoverAiPanel({
  models,
  suggestedPrompt,
  disabled = false,
  onGenerated,
  onClose,
  onBusyChange,
}: {
  models: AiModelVO[];
  suggestedPrompt: string;
  disabled?: boolean;
  onGenerated: (url: string) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const compatibleModels = useMemo(() => models
    .filter(supportsTextToImage)
    .sort((left, right) => Number(parseModelConfig(right).imagePrimary === true) - Number(parseModelConfig(left).imagePrimary === true)), [models]);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState(suggestedPrompt);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const runRef = useRef(0);
  const taskIdRef = useRef("");
  const taskOwnerRef = useRef("");
  const mountedRef = useRef(true);
  const promptId = useId();
  const promptStatusId = useId();
  const effectiveModelId = compatibleModels.some((model) => model.modelId === modelId)
    ? modelId
    : compatibleModels[0]?.modelId ?? "";
  const selectedModel = compatibleModels.find((model) => model.modelId === effectiveModelId);
  const promptCount = promptCharacterCount(prompt);
  const promptIssue = selectedModel
    ? modelPromptLimitIssue(prompt, parseModelConfig(selectedModel))
    : null;

  useEffect(() => () => {
    mountedRef.current = false;
    runRef.current += 1;
    const taskId = taskIdRef.current;
    const ownerUserId = taskOwnerRef.current;
    taskIdRef.current = "";
    taskOwnerRef.current = "";
    if (taskId) {
      void aiApi.cancelTask(taskId).finally(() => {
        return commitAcceptedAiGeneration("admin:skill-cover", taskId, ownerUserId);
      }).catch(() => undefined);
    }
  }, []);

  const setGenerationBusy = (next: boolean) => {
    if (!mountedRef.current) return;
    setBusy(next);
    onBusyChange(next);
  };

  const stopGeneration = async () => {
    const taskId = taskIdRef.current;
    const taskOwner = taskOwnerRef.current;
    runRef.current += 1;
    taskIdRef.current = "";
    taskOwnerRef.current = "";
    setGenerationBusy(false);
    setProgress(0);
    if (!taskId) {
      toast.info("已停止等待；若请求已经受理，可在生成记录中查看结果");
      return;
    }
    await aiApi.cancelTask(taskId).catch(() => undefined);
    await commitAcceptedAiGeneration("admin:skill-cover", taskId, taskOwner).catch(() => undefined);
    toast.info("封面生成已停止");
  };

  const generateCover = async () => {
    if (busy || disabled) return;
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      toast.error("请先填写封面画面描述");
      return;
    }
    if (!selectedModel || !effectiveModelId) {
      toast.error("暂无支持 16:9 文生图的可用图片模型");
      return;
    }
    const issue = modelPromptLimitIssue(cleanPrompt, parseModelConfig(selectedModel));
    if (issue) {
      toast.error(issue.message);
      return;
    }
    if (!(await useAuthStore.getState().ensureSession())) return;
    const ownerUserId = useAuthStore.getState().user?.id ?? "";
    if (!ownerUserId) {
      toast.error("无法确认当前账号，生成任务尚未启动");
      return;
    }

    const run = ++runRef.current;
    const active = () => mountedRef.current && runRef.current === run;
    setGenerationBusy(true);
    setProgress(2);
    let reconnectNoticeShown = false;
    try {
      let created: Awaited<ReturnType<typeof aiApi.generateIdempotent>>;
      for (;;) {
        created = await aiApi.generateIdempotent({
          handler: "text_to_image",
          modelId: effectiveModelId,
          entryPoint: "studio",
          targetType: "image",
          input: {
            prompt: cleanPrompt,
            aspectRatio: COVER_RATIO,
            aspect_ratio: COVER_RATIO,
            ratio: COVER_RATIO,
          },
        }, "admin:skill-cover", {
          requireDurableJournal: true,
          retainAccepted: true,
          dedupeActivePayload: true,
          ownerUserId,
        });
        if (!active()) return;
        if (created.success && created.data?.id) break;
        if (!isAmbiguousAiCreateCode(created.code)) {
          throw new Error(created.message || "封面生成请求失败");
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
      const deadline = Date.now() + COVER_TASK_TIMEOUT_MS;
      for (;;) {
        if (!active()) return;
        if (Date.now() >= deadline) {
          await aiApi.cancelTask(taskId).catch(() => undefined);
          taskIdRef.current = "";
          taskOwnerRef.current = "";
          await commitAcceptedAiGeneration("admin:skill-cover", taskId, ownerUserId).catch(() => undefined);
          throw new Error("封面生成等待超时，任务已停止");
        }
        const response = await aiApi.getTask(taskId);
        if (!active()) return;
        if (!response.success || !response.data) {
          if (response.code === 400 || response.code === 403 || response.code === 404) {
            taskIdRef.current = "";
            taskOwnerRef.current = "";
            await commitAcceptedAiGeneration("admin:skill-cover", taskId, ownerUserId).catch(() => undefined);
            throw new Error(response.message || "无法继续获取封面生成任务");
          }
          await wait(COVER_POLL_INTERVAL_MS);
          continue;
        }
        const task = response.data;
        setProgress(Math.max(2, Math.min(99, task.progress || 0)));
        if (task.status === AiTaskStatus.SUCCESS) {
          const url = imageResultUrl(task);
          taskIdRef.current = "";
          taskOwnerRef.current = "";
          await commitAcceptedAiGeneration("admin:skill-cover", taskId, ownerUserId).catch(() => undefined);
          if (!url) throw new Error("封面已生成，但任务没有返回可用图片地址");
          onGenerated(url);
          setProgress(100);
          toast.success("AI 封面已生成并回填，请检查后保存 Skill");
          return;
        }
        if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
          taskIdRef.current = "";
          taskOwnerRef.current = "";
          await commitAcceptedAiGeneration("admin:skill-cover", taskId, ownerUserId).catch(() => undefined);
          throw new Error(task.errorMsg || "AI 封面生成失败");
        }
        await wait(COVER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (active()) toast.error(error instanceof Error ? error.message : "AI 封面生成失败");
    } finally {
      if (active()) setGenerationBusy(false);
    }
  };

  return (
    <section className="adm-skill-cover-ai" aria-label="AI 生成技能封面" aria-busy={busy}>
      <header>
        <div>
          <strong><Sparkles aria-hidden size={14} />AI 生成封面</strong>
          <span>生成结果只回填当前表单，保存 Skill 后才会生效。</span>
        </div>
        <button type="button" className="adm-skill-cover-ai-close" aria-label="收起 AI 生成封面" disabled={busy} onClick={onClose}>
          <X aria-hidden size={15} />
        </button>
      </header>

      <div className="adm-skill-cover-ai-grid">
        <label>
          <span>图片模型</span>
          <select value={effectiveModelId} disabled={busy || disabled || !compatibleModels.length} onChange={(event) => setModelId(event.target.value)}>
            {!compatibleModels.length ? <option value="">暂无兼容模型</option> : null}
            {compatibleModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}
          </select>
        </label>
        <div className="adm-skill-cover-ai-cost">
          <span>画面规格</span>
          <strong>{COVER_RATIO} 横版</strong>
          {selectedModel ? <small>基础价格 {selectedModel.pointCost} 积分，实际以后端为准</small> : <small>请先在模型管理上架兼容图片模型</small>}
        </div>
      </div>

      <div className="adm-skill-cover-ai-prompt">
        <span>
          <label htmlFor={promptId}>画面描述</label>
          <button type="button" disabled={busy || disabled} onClick={() => setPrompt(suggestedPrompt)}>
            <RefreshCw aria-hidden size={12} />根据当前 Skill 重新填充
          </button>
        </span>
        <textarea id={promptId} rows={5} maxLength={MAX_COVER_PROMPT_CHARS} value={prompt} disabled={busy || disabled} aria-describedby={promptStatusId} aria-invalid={!!promptIssue} onChange={(event) => setPrompt(event.target.value)} />
        <small id={promptStatusId} className={promptIssue ? "is-error" : ""}>
          {promptIssue ? promptIssue.message : `${promptCount} 字 · 自动要求无文字、Logo 和水印`}
        </small>
      </div>

      <footer>
        <span role="status" aria-live="polite">{busy ? `正在生成${progress > 2 ? ` · ${progress}%` : ""}` : "会按所选模型正常扣除当前账号积分"}</span>
        {busy ? (
          <button type="button" className="adm-btn ghost" onClick={() => void stopGeneration()}>停止生成</button>
        ) : (
          <button type="button" className="adm-btn" disabled={disabled || !selectedModel || !!promptIssue || !prompt.trim()} onClick={() => void generateCover()}>
            <Sparkles aria-hidden size={14} />生成并回填
          </button>
        )}
      </footer>
      {busy ? (
        <div className="adm-skill-cover-ai-progress" role="progressbar" aria-label="AI 封面生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <i style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
      ) : null}
    </section>
  );
}
