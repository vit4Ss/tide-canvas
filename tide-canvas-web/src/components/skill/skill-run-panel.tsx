"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, CircleAlert, Clock3, ExternalLink, FileDown, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { defaultSkillInputValues, validateSkillInputValues } from "@/lib/skill-api";
import type { SkillRunAction, SkillRunArtifactVO, SkillRunVO } from "@/types/skill-run";
import { isSkillRunTerminal, skillRunError } from "@/types/skill-run";
import { SkillInputFields } from "./skill-input-fields";
import type { PopoverSelectTone } from "@/components/shared/popover-select";
import CapturableVideo from "@/components/studio/create-studio/video-result";
import styles from "./skill-run-panel.module.css";

const STATUS_LABEL: Record<SkillRunVO["status"], string> = {
  queued: "等待执行",
  running: "执行中",
  waiting_input: "等待补充信息",
  waiting_confirmation: "等待确认",
  succeeded: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

export interface SkillRunPanelActionPayload {
  feedback?: string;
  input?: Record<string, unknown>;
}

export interface SkillRunPanelProps {
  run: SkillRunVO;
  onAction?: (
    action: SkillRunAction,
    payload?: SkillRunPanelActionPayload,
  ) => void | Promise<unknown>;
  compact?: boolean;
  inputSelectTone?: PopoverSelectTone;
  onArtifact?: (artifact: SkillRunArtifactVO) => void;
  artifactActionLabel?: string | ((artifact: SkillRunArtifactVO) => string);
  actionBusy?: boolean;
  /** Restore the original skill request into its composer for editing. */
  onReEdit?: () => void | Promise<unknown>;
  onDismiss?: () => void;
}

function artifactText(artifact: SkillRunArtifactVO): string {
  return artifact.text?.trim() || artifact.content?.trim() || "";
}

function allArtifacts(run: SkillRunVO): SkillRunArtifactVO[] {
  const rows = [...(run.artifacts ?? []), ...(run.steps ?? []).flatMap((step) => step.artifacts ?? [])];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.id || `${row.type}:${row.url || artifactText(row)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SkillRunPanel({
  run,
  onAction,
  compact = false,
  inputSelectTone = "default",
  onArtifact,
  artifactActionLabel = "使用",
  actionBusy = false,
  onReEdit,
  onDismiss,
}: SkillRunPanelProps) {
  const pending = run.pendingAction;
  const [feedback, setFeedback] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [inputDirty, setInputDirty] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const localBusyRef = useRef(false);
  const inputDecisionRef = useRef<string | null>(null);
  const inputServerFingerprintRef = useRef("");
  const confirmationDecisionRef = useRef<string | null>(null);
  const artifacts = useMemo(() => allArtifacts(run), [run]);
  const busy = actionBusy || localBusy;
  const progress = Math.max(0, Math.min(100, Number.isFinite(run.progress) ? run.progress : 0));
  const terminal = isSkillRunTerminal(run.status);

  const pendingStepIdentity = run.currentStep
    || run.steps?.find((step) => step.status === "waiting")?.id
    || pending?.type
    || "pending";
  const inputDecisionKey = run.status === "waiting_input"
    ? `${run.id}:${pendingStepIdentity}:input`
    : null;
  const confirmationDecisionKey = run.status === "waiting_confirmation"
    ? `${run.id}:${pendingStepIdentity}:confirmation`
    : null;
  const inputServerFingerprint = useMemo(() => JSON.stringify({
    schema: pending?.schema ?? null,
    values: pending?.values ?? null,
  }), [pending?.schema, pending?.values]);

  /* eslint-disable react-hooks/set-state-in-effect -- only a genuinely new server decision resets its controlled draft */
  useEffect(() => {
    if (!inputDecisionKey) {
      inputDecisionRef.current = null;
      inputServerFingerprintRef.current = "";
      setInputDirty(false);
      return;
    }

    const decisionChanged = inputDecisionRef.current !== inputDecisionKey;
    const serverDefaultsChanged = inputServerFingerprintRef.current !== inputServerFingerprint;
    // 同一 waiting_input 在轮询中会不断产生新的 schema/values 对象；内容相同不重置。
    // 服务端确实更新默认值时，也仅在用户尚未编辑的情况下同步，避免覆盖正在输入的草稿。
    if (decisionChanged || (serverDefaultsChanged && !inputDirty)) {
      const defaults = defaultSkillInputValues(pending?.schema);
      setInputValues({ ...defaults, ...(pending?.values ?? {}) });
      setInputErrors({});
      setInputDirty(false);
    }
    inputDecisionRef.current = inputDecisionKey;
    inputServerFingerprintRef.current = inputServerFingerprint;
  }, [inputDecisionKey, inputDirty, inputServerFingerprint, pending?.schema, pending?.values]);

  useEffect(() => {
    if (!confirmationDecisionKey) {
      confirmationDecisionRef.current = null;
      return;
    }
    if (confirmationDecisionRef.current === confirmationDecisionKey) return;
    confirmationDecisionRef.current = confirmationDecisionKey;
    setFeedback("");
  }, [confirmationDecisionKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dispatch = async (action: SkillRunAction, payload?: SkillRunPanelActionPayload) => {
    if (!onAction || actionBusy || localBusyRef.current) return;
    localBusyRef.current = true;
    setLocalBusy(true);
    try {
      await onAction(action, payload);
    } finally {
      localBusyRef.current = false;
      setLocalBusy(false);
    }
  };

  const reEdit = async () => {
    if (!onReEdit || actionBusy || localBusyRef.current) return;
    localBusyRef.current = true;
    setLocalBusy(true);
    try {
      await onReEdit();
    } finally {
      localBusyRef.current = false;
      setLocalBusy(false);
    }
  };

  const submitInput = () => {
    const errors = validateSkillInputValues(pending?.schema, inputValues);
    setInputErrors(errors);
    if (Object.keys(errors).length) return;
    void dispatch("submit_input", { input: inputValues });
  };

  const statusIcon =
    run.status === "succeeded" ? (
      <Check aria-hidden />
    ) : run.status === "failed" ? (
      <CircleAlert aria-hidden />
    ) : run.status === "cancelled" ? (
      <X aria-hidden />
    ) : run.status === "waiting_input" || run.status === "waiting_confirmation" ? (
      <Clock3 aria-hidden />
    ) : (
      <Loader2 className={styles.spin} aria-hidden />
    );

  return (
    <section className={`${styles.panel}${compact ? ` ${styles.compact}` : ""}`} aria-live="polite">
      <header className={styles.header}>
        <span className={`${styles.statusIcon} ${styles[run.status]}`}>{statusIcon}</span>
        <span className={styles.heading}>
          <strong>{run.skillTitle || "技能运行"}</strong>
          <small>{terminal ? STATUS_LABEL[run.status] : run.currentStepTitle || run.currentStep || STATUS_LABEL[run.status]}</small>
        </span>
        <span className={`${styles.status} ${styles[run.status]}`}>{STATUS_LABEL[run.status]}</span>
      </header>

      {(run.status === "queued" || run.status === "running") && (
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="执行进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <i style={{ transform: `scaleX(${Math.max(0.02, progress / 100)})` }} />
        </div>
      )}

      {!!run.steps?.length && !compact && (
        <ol className={styles.steps}>
          {run.steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span />
              <b>{step.title || step.key || "执行步骤"}</b>
              <small>
                {step.message ||
                  (step.status === "running"
                    ? "处理中"
                    : step.status === "waiting"
                      ? "等待用户操作"
                      : "")}
              </small>
            </li>
          ))}
        </ol>
      )}

      {artifacts.length > 0 && (
        <div className={styles.artifacts}>
          {artifacts.map((artifact) => {
            const text = artifactText(artifact);
            return (
              <article key={artifact.id} className={styles.artifact} data-type={artifact.type}>
                {artifact.type === "image" && artifact.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artifact.url} alt={artifact.title || artifact.role || "技能产物"} loading="lazy" />
                ) : artifact.type === "video" && artifact.url ? (
                  <CapturableVideo src={artifact.url} controls preload="metadata" />
                ) : artifact.type === "audio" && artifact.url ? (
                  <audio src={artifact.url} controls preload="metadata" />
                ) : artifact.type === "file" && artifact.url ? (
                  <div className={styles.fileArtifact}>
                    <FileDown aria-hidden />
                    <span><strong>文件已生成</strong><small>可下载并继续编辑</small></span>
                  </div>
                ) : text ? (
                  <p>{text}</p>
                ) : (
                  <p>产物已生成</p>
                )}
                <footer>
                  <span>
                    <b>{artifact.title || artifact.role || (artifact.isFinal ? "最终产物" : "中间产物")}</b>
                    <small>{artifact.type === "text" ? "文本" : artifact.type}</small>
                  </span>
                  {onArtifact && (
                    <button type="button" disabled={busy} onClick={() => onArtifact(artifact)}>
                      {typeof artifactActionLabel === "function"
                        ? artifactActionLabel(artifact)
                        : artifactActionLabel} <ChevronRight aria-hidden />
                    </button>
                  )}
                  {!onArtifact && artifact.url && (
                    <a href={artifact.url} target="_blank" rel="noopener noreferrer">
                      打开 <ExternalLink aria-hidden />
                    </a>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {run.status === "waiting_input" && (
        <div className={styles.decision}>
          <div>
            <strong>{pending?.title || "还需要一些信息"}</strong>
            {pending?.message && <p>{pending.message}</p>}
          </div>
          <SkillInputFields
            schema={pending?.schema}
            values={inputValues}
            errors={inputErrors}
            disabled={busy}
            compact={compact}
            selectTone={inputSelectTone}
            onChange={(key, value) => {
              setInputDirty(true);
              setInputValues((current) => ({ ...current, [key]: value }));
              setInputErrors((current) => {
                if (!current[key]) return current;
                const next = { ...current };
                delete next[key];
                return next;
              });
            }}
          />
          <div className={styles.actions}>
            <button className={styles.primary} type="button" disabled={busy} onClick={submitInput}>
              {busy && <Loader2 className={styles.spin} aria-hidden />} 提交并继续
            </button>
            <button type="button" disabled={busy} onClick={() => void dispatch("cancel")}>
              取消运行
            </button>
          </div>
        </div>
      )}

      {run.status === "waiting_confirmation" && (
        <div className={styles.decision}>
          <div>
            <strong>{pending?.title || "请确认当前结果"}</strong>
            {pending?.message && <p>{pending.message}</p>}
          </div>
          <textarea
            rows={compact ? 2 : 3}
            value={feedback}
            disabled={busy}
            aria-label="修改意见"
            placeholder="需要调整时，在这里写下修改意见"
            onChange={(event) => setFeedback(event.target.value)}
          />
          <div className={styles.actions}>
            <button className={styles.primary} type="button" disabled={busy} onClick={() => void dispatch("confirm")}>
              {busy && <Loader2 className={styles.spin} aria-hidden />}
              {pending?.confirmLabel || "确认并继续"}
            </button>
            <button
              type="button"
              disabled={busy || !feedback.trim()}
              onClick={() => void dispatch("revise", { feedback: feedback.trim() })}
            >
              提交修改
            </button>
            <button type="button" disabled={busy} onClick={() => void dispatch("cancel")}>
              取消运行
            </button>
          </div>
        </div>
      )}

      {run.status === "failed" && (
        <div className={styles.failure}>
          <p>{skillRunError(run) || "本次运行未能完成，请重试。"}</p>
          {(onReEdit || onAction) && (
            <div className={styles.failureActions}>
              {onReEdit && (
                <button type="button" disabled={busy} onClick={() => void reEdit()}>
                  <Pencil aria-hidden /> 重新编辑
                </button>
              )}
              {onAction && (
                <button type="button" disabled={busy} onClick={() => void dispatch("retry")}>
                  <RotateCcw aria-hidden /> 重试
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(run.status === "queued" || run.status === "running") && (
        <div className={styles.activeActions}>
          <span aria-live="polite">{Math.round(progress)}%</span>
          {onAction && (
            <button type="button" disabled={busy} onClick={() => void dispatch("cancel")}>
              取消运行
            </button>
          )}
        </div>
      )}

      {isSkillRunTerminal(run.status) && (onDismiss || (run.status === "cancelled" && onAction)) && (
        <div className={styles.quietActions}>
          {run.status === "cancelled" && onAction && (
            <button type="button" disabled={busy} onClick={() => void dispatch("retry")}>
              <RotateCcw aria-hidden /> 重新运行
            </button>
          )}
          {onDismiss && (
            <button type="button" disabled={busy} onClick={onDismiss}>
              收起运行详情
            </button>
          )}
        </div>
      )}

      {typeof run.pointCost === "number" && run.pointCost > 0 && (
        <div className={styles.cost}>本次已使用 {run.pointCost} 积分</div>
      )}
    </section>
  );
}
