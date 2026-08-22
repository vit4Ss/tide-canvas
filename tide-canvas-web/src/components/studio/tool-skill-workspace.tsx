"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, FileUp, Loader2, Play, Video, Wrench, X } from "lucide-react";
import { uploadFileSmart } from "@/lib/api";
import { fetchWithAuth } from "@/lib/http";
import {
  defaultSkillInputValues,
  parseSkillInputSchema,
  skillApi,
  validateSkillRunInputValues,
} from "@/lib/skill-api";
import { SkillInputFields } from "@/components/skill/skill-input-fields";
import {
  SkillRunPanel,
  type SkillRunPanelActionPayload,
} from "@/components/skill/skill-run-panel";
import { useSkillRun } from "@/components/skill/use-skill-run";
import { toast } from "@/components/shared/toast";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useAuthStore } from "@/stores/use-auth-store";
import type { SkillVO } from "@/types/skill";
import type {
  SkillRunAction,
  SkillRunArtifactVO,
  SkillRunAssetInput,
  SkillRunVO,
} from "@/types/skill-run";
import { isSkillRunActive } from "@/types/skill-run";
import styles from "./tool-skill-workspace.module.css";

// The authenticated file service accepts at most 100 MiB per upload.
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mpeg", ".mpg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma"]);

type AcceptedMedia = "video" | "audio" | null;

function acceptedMedia(skill: SkillVO | null): AcceptedMedia {
  const schema = parseSkillInputSchema(skill?.inputSchema);
  const values = schema?.["x-asset-types"];
  if (!Array.isArray(values)) return null;
  if (values.includes("video")) return "video";
  if (values.includes("audio")) return "audio";
  return null;
}

function acceptsMediaFile(file: File, mediaType: Exclude<AcceptedMedia, null>): boolean {
  const mime = file.type.trim().toLowerCase();
  if (mime.startsWith(`${mediaType}/`)) return true;
  if (mime && mime !== "application/octet-stream") return false;
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  return (mediaType === "video" ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS).has(extension);
}

function artifactText(artifact: SkillRunArtifactVO): string {
  return artifact.text?.trim() || artifact.content?.trim() || "";
}

function finalOnlyRun(run: SkillRunVO): SkillRunVO {
  const keep = (artifact: SkillRunArtifactVO) => artifact.isFinal !== false && artifact.role !== "intermediate" && artifact.role !== "draft";
  return {
    ...run,
    artifacts: run.artifacts?.filter(keep),
    steps: run.steps?.map((step) => ({ ...step, artifacts: step.artifacts?.filter(keep) })),
  };
}

export function ToolSkillWorkspace({
  open,
  skill,
  skills = [],
  targetType,
  onRequestOpen,
  onRequestClose,
}: {
  open: boolean;
  skill: SkillVO | null;
  skills?: SkillVO[];
  targetType?: string;
  onRequestOpen: () => void;
  onRequestClose: () => void;
}) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const ownerUserId = useAuthStore((state) => state.user?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asset, setAsset] = useState<SkillRunAssetInput | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recoveredSkill, setRecoveredSkill] = useState<SkillVO | null>(null);
  const dialogRef = useFocusTrap<HTMLElement>(open);
  const skillRun = useSkillRun({
    storageKey: "tidecanvas.studio.tool-skill-run",
    ownerUserId,
    retainTerminalPointer: true,
    pollIntervalMs: 1400,
    onTerminal: (finished) => {
      if (finished.status === "succeeded") toast.success("工具执行完成");
    },
  });
  const selectedToolSkillID = skill?.id;
  const currentToolRun = skillRun.run;
  const clearToolRun = skillRun.clear;
  const runSkill = useMemo(
    () => skills.find((candidate) => candidate.id === skillRun.run?.skillId) ?? null,
    [skillRun.run?.skillId, skills],
  );
  const effectiveSkill = skill ?? runSkill ?? recoveredSkill;
  const mediaType = useMemo(() => acceptedMedia(effectiveSkill), [effectiveSkill]);
  const promptRequired = useMemo(() => {
    const required = parseSkillInputSchema(effectiveSkill?.inputSchema)?.required;
    return Array.isArray(required) && required.includes("prompt");
  }, [effectiveSkill]);
  useEffect(() => {
    if (!runSkill || recoveredSkill?.id === runSkill.id) return;
    const timer = window.setTimeout(() => setRecoveredSkill(runSkill), 0);
    return () => window.clearTimeout(timer);
  }, [recoveredSkill?.id, runSkill]);

  // Studio can restore an active run after a full refresh without having the
  // Tools page catalog in memory. Resolve only the pinned catalog entry; a
  // disabled/deleted tool remains viewable as a run result but cannot be used
  // to start a new run.
  useEffect(() => {
    const runSkillId = skillRun.run?.skillId;
    if (!runSkillId || runSkill || recoveredSkill?.id === runSkillId) return;
    let alive = true;
    void skillApi.get(runSkillId, "studio", skillRun.run?.targetType).then((result) => {
      if (!alive || !result.success || !result.data || result.data.kind !== "tool") return;
      setRecoveredSkill(result.data);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [recoveredSkill?.id, runSkill, skillRun.run?.skillId, skillRun.run?.targetType]);

  useEffect(() => {
    if (!effectiveSkill || skillRun.run) return;
    const timer = window.setTimeout(() => {
      setPrompt("");
      setValues(defaultSkillInputValues(effectiveSkill.inputSchema, effectiveSkill.defaultParams));
      setErrors({});
      setAsset(null);
      setUploadProgress(0);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [effectiveSkill, skillRun.run]);

  // A completed result remains available after closing or refreshing, but an
  // explicit pick of a different tool should open that tool's fresh form.
  // Active work is never discarded; the user can return after it finishes.
  useEffect(() => {
    if (!selectedToolSkillID || !currentToolRun || isSkillRunActive(currentToolRun.status) || currentToolRun.skillId === selectedToolSkillID) return;
    const timer = window.setTimeout(() => clearToolRun(), 0);
    return () => window.clearTimeout(timer);
  }, [clearToolRun, currentToolRun, selectedToolSkillID]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onRequestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onRequestClose, open]);

  const upload = async (file: File) => {
    if (!mediaType || uploading) return;
    if (!acceptsMediaFile(file, mediaType)) {
      toast.error(mediaType === "video" ? "请选择视频文件" : "请选择音频文件");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      await ensureSession();
      const result = await uploadFileSmart(file, setUploadProgress, {
        maxBytes: MAX_MEDIA_BYTES,
        label: mediaType === "video" ? "待分析视频" : "待分析音频",
      });
      if (!result.success || !result.data?.fileUrl) {
        toast.error(result.message || "文件上传失败");
        return;
      }
      setAsset({
        id: result.data.id,
        type: mediaType,
        url: result.data.fileUrl,
        name: result.data.originalName || file.name,
      });
      setErrors((current) => {
        if (!current.assets) return current;
        const next = { ...current };
        delete next.assets;
        return next;
      });
    } catch {
      toast.error("文件上传失败，请稍后重试");
    } finally {
      setUploading(false);
    }
  };

  const start = async () => {
    if (!effectiveSkill || skillRun.loading || uploading) return;
    const input = {
      prompt: prompt.trim(),
      assets: asset ? [asset] : [],
      sourceNodeIds: [],
      parameters: values,
    };
    const nextErrors = validateSkillRunInputValues(effectiveSkill.inputSchema, input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      toast.info(nextErrors.prompt || nextErrors.assets || "请检查工具输入");
      return;
    }
    try {
      await ensureSession();
      const started = await skillRun.start({
        skillId: effectiveSkill.id,
        entryPoint: "studio",
        ...(targetType ? { targetType } : {}),
        input,
      });
      if (!started) toast.error("工具启动失败，请稍后重试");
    } catch {
      toast.error("工具启动失败，请检查登录状态后重试");
    }
  };

  const performAction = async (
    action: SkillRunAction,
    payload?: SkillRunPanelActionPayload,
  ) => {
    const updated = await skillRun.performAction(action, {
      ...(payload?.feedback ? { feedback: payload.feedback } : {}),
      ...(payload?.input ? { input: payload.input } : {}),
    });
    if (!updated) toast.error("操作失败，请重试");
  };

  const useArtifact = async (artifact: SkillRunArtifactVO) => {
    const text = artifactText(artifact);
    if (text && !artifact.url) {
      try {
        await navigator.clipboard.writeText(text);
        toast.success("分析结果已复制");
      } catch {
        toast.error("复制失败，请手动选择文本");
      }
      return;
    }
    if (artifact.url) {
      try {
        const name = artifact.title?.trim() || "技能工具产物";
        const endpoint = `/api/files/download?url=${encodeURIComponent(artifact.url)}&name=${encodeURIComponent(name)}`;
        const response = await fetchWithAuth(endpoint);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const objectURL = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = objectURL;
        anchor.download = name;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectURL), 5_000);
      } catch {
        toast.error("下载失败，请稍后重试");
      }
    }
  };

  const dismissRun = () => onRequestClose();

  if (typeof document === "undefined") return null;
  if (!open) {
    if (!skillRun.run) return null;
    return createPortal(
      <button type="button" className={styles.resume} onClick={onRequestOpen}>
        {isSkillRunActive(skillRun.run.status) ? <Loader2 className={styles.spin} aria-hidden /> : <Wrench aria-hidden />}
        <span>
          <strong>{skillRun.run.skillTitle || "技能工具"}</strong>
          <small>{isSkillRunActive(skillRun.run.status) ? `${skillRun.run.progress}% · 点击查看` : "已结束 · 点击查看结果"}</small>
        </span>
      </button>,
      document.body,
    );
  }

  const displayedSkillTitle = skillRun.run?.skillTitle || effectiveSkill?.title || "技能工具";
  const active = isSkillRunActive(skillRun.run?.status);
  return createPortal(
    <div className={styles.backdrop} onMouseDown={dismissRun}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={displayedSkillTitle}
        className={styles.dialog}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.headerIcon}><Wrench aria-hidden /></span>
          <span className={styles.headerText}>
            <strong>{displayedSkillTitle}</strong>
            <small>{active ? "运行中，关闭窗口不会中断任务" : effectiveSkill?.description || "受控工具执行"}</small>
          </span>
          <button type="button" className={styles.close} onClick={dismissRun} aria-label="关闭">
            <X aria-hidden />
          </button>
        </header>

        <div className={styles.body}>
          {!skillRun.run && effectiveSkill ? (
            <div className={styles.form}>
              <label className={styles.promptField}>
                <span>任务要求{promptRequired ? <i>必填</i> : null}</span>
                <textarea
                  rows={5}
                  value={prompt}
                  placeholder={mediaType ? "说明希望重点分析的内容；没有特殊要求可留空" : "详细描述需要生成的内容、结构与使用场景"}
                  aria-invalid={!!errors.prompt}
                  aria-describedby={errors.prompt ? "tool-skill-prompt-error" : undefined}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setErrors((current) => {
                      if (!current.prompt) return current;
                      const next = { ...current };
                      delete next.prompt;
                      return next;
                    });
                  }}
                />
                {errors.prompt ? <small id="tool-skill-prompt-error">{errors.prompt}</small> : null}
              </label>

              <SkillInputFields
                schema={effectiveSkill.inputSchema}
                values={values}
                errors={errors}
                onChange={(key, value) => {
                  setValues((current) => ({ ...current, [key]: value }));
                  setErrors((current) => {
                    if (!current[key]) return current;
                    const next = { ...current };
                    delete next[key];
                    return next;
                  });
                }}
              />

              {mediaType ? (
                <label className={`${styles.upload}${errors.assets ? ` ${styles.invalid}` : ""}`}>
                  <input
                    type="file"
                    accept={mediaType === "video" ? "video/*" : "audio/*"}
                    disabled={uploading}
                    aria-invalid={!!errors.assets}
                    aria-describedby={errors.assets ? "tool-skill-assets-error" : undefined}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void upload(file);
                    }}
                  />
                  <span className={styles.uploadIcon}>
                    {uploading ? <Loader2 className={styles.spin} aria-hidden /> : mediaType === "video" ? <Video aria-hidden /> : <AudioLines aria-hidden />}
                  </span>
                  <span>
                    <strong>{asset?.name || (mediaType === "video" ? "上传视频" : "上传音频")}</strong>
                    <small aria-live="polite">{uploading ? `上传中 ${uploadProgress}%` : asset ? "点击可重新选择，最大 100MB" : "点击选择文件，最大 100MB"}</small>
                  </span>
                  <FileUp aria-hidden />
                </label>
              ) : null}
              {errors.assets ? <p id="tool-skill-assets-error" className={styles.error}>{errors.assets}</p> : null}
              {skillRun.error ? <p className={styles.error}>{skillRun.error}</p> : null}
            </div>
          ) : skillRun.run ? (
            <SkillRunPanel
              run={finalOnlyRun(skillRun.run)}
              actionBusy={skillRun.actionBusy}
              onAction={performAction}
              onArtifact={useArtifact}
              artifactActionLabel={(artifact) => artifact.url ? "下载" : "复制"}
            />
          ) : null}
        </div>

        {!skillRun.run && effectiveSkill ? (
          <footer className={styles.footer}>
            <span>内容生成与分析按实际模型扣除积分；文件渲染本身不额外收费。</span>
            <button type="button" disabled={uploading || skillRun.loading} onClick={() => void start()}>
              {skillRun.loading ? <Loader2 className={styles.spin} aria-hidden /> : <Play aria-hidden />}
              开始执行
            </button>
          </footer>
        ) : skillRun.run && !active ? (
          <footer className={styles.footer}>
            <span>本次工具运行已结束。</span>
            <button
              type="button"
              onClick={() => {
                skillRun.clear();
                if (!effectiveSkill) onRequestClose();
              }}
            >
              {effectiveSkill ? "再次使用" : "关闭"}
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
