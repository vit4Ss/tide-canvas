"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Loader2, Paperclip, Play, Sparkles, X } from "lucide-react";
import { fileApi } from "@/lib/api";
import {
  defaultSkillInputValues,
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
import { FileCategory, FileType } from "@/types/file";
import type { SkillVO } from "@/types/skill";
import type {
  SkillRunAction,
  SkillRunArtifactVO,
  SkillRunAssetInput,
  SkillRunVO,
} from "@/types/skill-run";
import { isSkillRunActive } from "@/types/skill-run";

const MAX_REFERENCES = 32;
const ARCHIVE_LOCK_NAME = "tidecanvas.asset.skill-archive";
const ARCHIVE_LOCK_KEY = "tidecanvas.asset.skill-archive.lock";
const ARCHIVE_RECORD_PREFIX = "tidecanvas.asset.skill-archive.run.";
const ARCHIVE_RECORD_INDEX = "tidecanvas.asset.skill-archive.index";
const ARCHIVE_PENDING_TTL_MS = 10 * 60 * 1000;

interface ArchiveRecord {
  status: "pending" | "done";
  updatedAt: number;
}

type ArchiveRecords = Record<string, ArchiveRecord>;

const TARGET_LABEL: Record<string, string> = {
  character: "角色资产",
  scene: "场景资产",
  general: "通用资产",
};

function runArtifacts(run: SkillRunVO): SkillRunArtifactVO[] {
  const rows = [...(run.artifacts ?? []), ...(run.steps ?? []).flatMap((step) => step.artifacts ?? [])];
  const seen = new Set<string>();
  return rows.filter((artifact) => {
    const key = artifact.id || artifact.fileId || `${artifact.type}:${artifact.url || artifact.text || artifact.content || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function archiveFileType(type: SkillRunArtifactVO["type"]): FileType {
  if (type === "image") return FileType.IMAGE;
  if (type === "video") return FileType.VIDEO;
  return FileType.OTHER;
}

function extensionOf(type: SkillRunArtifactVO["type"]): string {
  if (type === "image") return ".png";
  if (type === "video") return ".mp4";
  if (type === "audio") return ".mp3";
  return "";
}

function artifactArchiveKey(artifact: SkillRunArtifactVO): string {
  return artifact.id || artifact.fileId || `${artifact.type}:${artifact.url || ""}`;
}

function archiveName(artifact: SkillRunArtifactVO, run: SkillRunVO, index: number): string {
  const base = artifact.title?.trim() || run.skillTitle?.trim() || `技能产物 ${index + 1}`;
  const extension = extensionOf(artifact.type);
  return extension && !base.toLowerCase().endsWith(extension) ? `${base}${extension}` : base;
}

function readArchiveRecords(runId: string): ArchiveRecords {
  try {
    const raw = localStorage.getItem(`${ARCHIVE_RECORD_PREFIX}${runId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ArchiveRecords;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeArchiveRecords(runId: string, records: ArchiveRecords): void {
  try {
    const now = Date.now();
    localStorage.setItem(`${ARCHIVE_RECORD_PREFIX}${runId}`, JSON.stringify(records));
    const rawIndex = localStorage.getItem(ARCHIVE_RECORD_INDEX);
    const parsed = rawIndex ? (JSON.parse(rawIndex) as Record<string, number>) : {};
    const index = parsed && typeof parsed === "object" ? parsed : {};
    index[runId] = now;
    const keep = Object.entries(index).sort((a, b) => b[1] - a[1]).slice(0, 80);
    const keepIDs = new Set(keep.map(([id]) => id));
    for (const oldID of Object.keys(index)) {
      if (!keepIDs.has(oldID)) localStorage.removeItem(`${ARCHIVE_RECORD_PREFIX}${oldID}`);
    }
    localStorage.setItem(ARCHIVE_RECORD_INDEX, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    // Storage can be blocked in private mode. The in-memory guard still avoids
    // duplicate callbacks in this tab; server-owned fileId remains authoritative.
  }
}

async function withArchiveLock(work: () => Promise<void>): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request(ARCHIVE_LOCK_NAME, work);
    return true;
  }
  if (typeof localStorage === "undefined") {
    await work();
    return true;
  }

  const owner =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const now = Date.now();
      const current = JSON.parse(localStorage.getItem(ARCHIVE_LOCK_KEY) || "null") as
        | { owner?: string; expiresAt?: number }
        | null;
      if (!current?.owner || Number(current.expiresAt || 0) <= now) {
        localStorage.setItem(
          ARCHIVE_LOCK_KEY,
          JSON.stringify({ owner, expiresAt: now + ARCHIVE_PENDING_TTL_MS }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        const confirmed = JSON.parse(localStorage.getItem(ARCHIVE_LOCK_KEY) || "null") as
          | { owner?: string }
          | null;
        if (confirmed?.owner === owner) {
          try {
            await work();
          } finally {
            const latest = JSON.parse(localStorage.getItem(ARCHIVE_LOCK_KEY) || "null") as
              | { owner?: string }
              | null;
            if (latest?.owner === owner) localStorage.removeItem(ARCHIVE_LOCK_KEY);
          }
          return true;
        }
      }
    } catch {
      await work();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 55 + Math.floor(Math.random() * 35)));
  }
  return false;
}

interface AssetSkillWorkspaceProps {
  open: boolean;
  skill: SkillVO | null;
  targetType: "character" | "scene" | "general";
  outputType: "image" | "video" | "audio" | "file";
  references: SkillRunAssetInput[];
  onRequestClose: () => void;
  onArchived: (
    count: number,
    targetType: "character" | "scene" | "general",
    mediaType: "image" | "video" | "audio" | "file",
  ) => void | Promise<void>;
}

/**
 * Asset-surface SkillRun workspace. It deliberately stays mounted while the
 * asset page is open so a refreshed active run can be resumed from localStorage.
 */
export function AssetSkillWorkspace({
  open,
  skill,
  targetType,
  outputType,
  references,
  onRequestClose,
  onArchived,
}: AssetSkillWorkspaceProps) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const ownerUserId = useAuthStore((state) => state.user?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archiveRetryable, setArchiveRetryable] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const archivedArtifactsRef = useRef(new Set<string>());
  const onArchivedRef = useRef(onArchived);

  useEffect(() => {
    onArchivedRef.current = onArchived;
  }, [onArchived]);

  const archiveRun = useCallback(
    async (finished: SkillRunVO) => {
      if (finished.status !== "succeeded") return;
      const finishedTarget: "character" | "scene" | "general" =
        finished.targetType === "character" || finished.targetType === "scene"
          ? finished.targetType
          : "general";
      const candidates = runArtifacts(finished).filter(
        (artifact) =>
          artifact.isFinal !== false &&
          (!!artifact.fileId || !!artifact.url) &&
          (artifact.type === "image" ||
            artifact.type === "video" ||
            artifact.type === "audio" ||
            artifact.type === "file") &&
          (finishedTarget === "general" || artifact.type === "image"),
      );
      if (!candidates.length) {
        setArchiveRetryable(false);
        setArchiveMessage("技能已完成；本次没有需要归档的媒体文件。");
        return;
      }
      let lockAcquired = false;
      try {
        lockAcquired = await withArchiveLock(async () => {
        const now = Date.now();
        const records = readArchiveRecords(finished.id);
        for (const artifact of candidates) {
          const key = artifactArchiveKey(artifact);
          if (records[key]?.status === "done") archivedArtifactsRef.current.add(key);
        }
        const pending = candidates.filter((artifact) => {
          const key = artifactArchiveKey(artifact);
          if (archivedArtifactsRef.current.has(key)) return false;
          const record = records[key];
          return !record || record.status !== "pending" || now - record.updatedAt >= ARCHIVE_PENDING_TTL_MS;
        });
        const firstType = candidates[0]?.type;
        const mediaType =
          firstType === "video" || firstType === "audio" || firstType === "file"
            ? firstType
            : "image";
        if (!pending.length) {
          setArchiveRetryable(false);
          const hasInFlight = candidates.some(
            (artifact) => records[artifactArchiveKey(artifact)]?.status === "pending",
          );
          setArchiveMessage(
            hasInFlight
              ? "产物正在另一个页面归档；资产列表已刷新，可稍后再次查看。"
              : `产物已经归档到${TARGET_LABEL[finishedTarget] || "资产库"}，无需重复保存。`,
          );
          await onArchivedRef.current(0, finishedTarget, mediaType);
          return;
        }

        await ensureSession();
        // Persist pending before the network request. A reload or a second tab
        // therefore never starts the same save-from-url call concurrently.
        for (const artifact of pending) {
          records[artifactArchiveKey(artifact)] = { status: "pending", updatedAt: now };
        }
        writeArchiveRecords(finished.id, records);
        setArchiveRetryable(false);
        setArchiveMessage(`正在归档 ${pending.length} 个产物…`);
        const category =
          finishedTarget === "character"
            ? FileCategory.CHARACTER
            : finishedTarget === "scene"
              ? FileCategory.SCENE
              : FileCategory.GENERAL;
        const settled = await Promise.allSettled(
          pending.map(async (artifact, index) => {
            // A server-created fileId is authoritative. This makes the client
            // automatically degrade to refresh-only once backend archival lands.
            if (artifact.fileId) return artifact.fileId;
            const result = await fileApi.saveFromUrl({
              url: artifact.url!,
              fileType: archiveFileType(artifact.type),
              category,
              originalName: archiveName(artifact, finished, index),
            });
            if (!result.success) throw new Error(result.message || "归档失败");
            return result.data?.id;
          }),
        );
        settled.forEach((result, index) => {
          const key = artifactArchiveKey(pending[index]);
          if (result.status === "fulfilled") {
            records[key] = { status: "done", updatedAt: Date.now() };
            archivedArtifactsRef.current.add(key);
          } else {
            // A confirmed failure is retryable immediately. Only ambiguous
            // unload/crash requests retain their pending TTL guard.
            delete records[key];
          }
        });
        writeArchiveRecords(finished.id, records);

        const archived = settled.filter((result) => result.status === "fulfilled").length;
        const failed = settled.length - archived;
        if (archived > 0) {
          setArchiveRetryable(failed > 0);
          setArchiveMessage(
            failed > 0
              ? `已归档 ${archived} 个产物，另有 ${failed} 个归档失败，可从运行结果中打开。`
              : `已归档 ${archived} 个产物，并刷新到${TARGET_LABEL[finishedTarget] || "资产库"}。`,
          );
          const firstSuccessIndex = settled.findIndex((result) => result.status === "fulfilled");
          const firstMediaType = pending[firstSuccessIndex]?.type;
          await onArchivedRef.current(
            archived,
            finishedTarget,
            firstMediaType === "video" || firstMediaType === "audio" || firstMediaType === "file"
              ? firstMediaType
              : "image",
          );
          toast.success(`技能完成，已归档 ${archived} 个产物`);
        } else {
          setArchiveRetryable(true);
          setArchiveMessage("技能已完成，但产物归档失败；仍可从下方运行结果中打开。");
          toast.error("技能产物归档失败，请稍后重试");
        }
        });
      } catch {
        setArchiveRetryable(true);
        setArchiveMessage("技能已完成，但自动归档未能启动；仍可从下方运行结果中打开。");
        toast.error("技能产物归档失败，请稍后重试");
        return;
      }
      if (!lockAcquired) {
        setArchiveRetryable(false);
        setArchiveMessage("另一个页面正在归档技能产物，完成后刷新资产列表即可查看。");
      }
    },
    [ensureSession],
  );

  const skillRun = useSkillRun({
    storageKey: "tidecanvas.asset.active-skill-run",
    ownerUserId,
    onTerminal: (finished) => {
      if (finished.status === "succeeded") void archiveRun(finished);
      else if (finished.status === "failed") toast.error("资产技能运行失败，请查看运行详情");
    },
  });
  const dialogRef = useFocusTrap<HTMLElement>(open || (!!skillRun.run && !minimized));

  // Selecting another skill is a new draft. An active run cannot reach this
  // path because the modal remains on top until it is completed or cancelled.
  /* eslint-disable react-hooks/set-state-in-effect -- external skill selection initializes a new controlled draft */
  useEffect(() => {
    if (!skill) return;
    setPrompt("");
    setValues(defaultSkillInputValues(skill.inputSchema, skill.defaultParams));
    setErrors({});
    setArchiveMessage("");
    setArchiveRetryable(false);
    if (skillRun.run && !isSkillRunActive(skillRun.run.status)) skillRun.clear();
    // skillRun is intentionally excluded: controller identity changes with run state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!(open || skillRun.run)) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isSkillRunActive(skillRun.run?.status)) {
        setMinimized(true);
        onRequestClose();
        return;
      }
      setMinimized(false);
      skillRun.clear();
      onRequestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onRequestClose, open, skillRun]);

  const start = async () => {
    if (!skill || skillRun.loading) return;
    if (references.length > MAX_REFERENCES) {
      toast.info(`单次最多引用 ${MAX_REFERENCES} 个资产，请减少选择后再运行`);
      return;
    }
    const input = {
      prompt: prompt.trim(),
      assets: references,
      sourceNodeIds: [],
      parameters: {
        ...values,
        outputType,
        targetType,
        assetCategory: targetType,
      },
    };
    const nextErrors = validateSkillRunInputValues(skill.inputSchema, input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      toast.info(nextErrors.prompt || nextErrors.assets || nextErrors.sourceNodeIds || nextErrors.parameters || "请检查技能输入");
      return;
    }
    await ensureSession();
    const started = await skillRun.start({
      skillId: skill.id,
      entryPoint: "asset",
      targetType,
      input,
    });
    if (!started) toast.error("技能启动失败，请稍后重试");
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

  const dismiss = () => {
    if (isSkillRunActive(skillRun.run?.status)) {
      setMinimized(true);
      onRequestClose();
      return;
    }
    setMinimized(false);
    skillRun.clear();
    onRequestClose();
  };

  const visible = open || !!skillRun.run;
  const active = isSkillRunActive(skillRun.run?.status);
  const canStart = !!skill && !skillRun.run && !skillRun.loading;
  const displayTarget =
    skillRun.run?.targetType === "character" ||
    skillRun.run?.targetType === "scene" ||
    skillRun.run?.targetType === "general"
      ? skillRun.run.targetType
      : targetType;
  const referenceNames = useMemo(() => {
    const rawInput = skillRun.run?.input;
    const persistedAssets =
      rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? (rawInput as { assets?: unknown }).assets
        : undefined;
    const source = Array.isArray(persistedAssets)
      ? persistedAssets.filter(
          (asset): asset is SkillRunAssetInput => !!asset && typeof asset === "object",
        )
      : references;
    return source.map((asset, index) => asset.name?.trim() || `引用资产 ${index + 1}`);
  }, [references, skillRun.run?.input]);

  if (!visible || typeof document === "undefined") return null;

  if (minimized && !open && skillRun.run) {
    return createPortal(
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-[234] flex max-w-[min(320px,calc(100vw-32px))] items-center gap-3 rounded-full border border-white/10 bg-[#1c1c1f] px-4 py-3 text-left text-neutral-100 shadow-2xl transition-transform hover:-translate-y-0.5"
        aria-label="展开资产技能运行"
      >
        {active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="min-w-0">
          <strong className="block truncate text-xs">{skillRun.run.skillTitle || "资产技能"}</strong>
          <small className="block text-[11px] text-neutral-400">
            {active ? `${skillRun.run.progress || 0}% · 点击查看运行详情` : "运行已结束 · 点击查看结果"}
          </small>
        </span>
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[235] flex items-center justify-center bg-black/55 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        event.stopPropagation();
        dismiss();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="运行资产技能"
        className="flex max-h-[min(820px,calc(100vh-40px))] w-[min(760px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#151517] text-neutral-100 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/8 text-neutral-100">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm">{skillRun.run?.skillTitle || skill?.title || "资产技能"}</strong>
            <small className="mt-0.5 block text-xs text-neutral-500">
              {TARGET_LABEL[displayTarget]} · 完成后自动归档
            </small>
          </span>
          <button
            type="button"
            aria-label="关闭"
            title={active ? "收起窗口，运行会在后台继续" : "关闭"}
            onClick={dismiss}
            className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-white/8 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!skillRun.run && skill ? (
            <div className="space-y-5">
              {skill.description && (
                <p className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-neutral-400">
                  {skill.description}
                </p>
              )}

              <label className="block">
                <span className="mb-2 block text-xs font-medium text-neutral-300">创作描述</span>
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="描述你希望技能完成的内容；不需要描述时可以留空"
                  aria-invalid={!!errors.prompt}
                  className={`w-full resize-y rounded-xl border bg-white/[0.04] px-3.5 py-3 text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-600 ${errors.prompt ? "border-red-400/70 focus:border-red-400" : "border-white/10 focus:border-white/25"}`}
                />
                {errors.prompt && <small className="mt-1.5 block text-xs text-red-400">{errors.prompt}</small>}
              </label>

              <SkillInputFields
                schema={skill.inputSchema}
                values={values}
                errors={errors}
                selectTone="dark"
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

              <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3.5">
                <div className="flex items-center gap-2 text-xs text-neutral-300">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  <strong>引用资产</strong>
                  <span className="text-neutral-500">{referenceNames.length} / {MAX_REFERENCES}</span>
                </div>
                {referenceNames.length ? (
                  <div className="mt-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                    {referenceNames.map((name, index) => (
                      <span
                        key={`${name}-${index}`}
                        title={name}
                        className="max-w-48 truncate rounded-lg border border-white/8 bg-white/5 px-2 py-1 text-[11px] text-neutral-400"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-neutral-500">
                    未引用资产。先在资产页进入批量模式并勾选素材，可作为本次技能的上下文。
                  </p>
                )}
                {referenceNames.length > MAX_REFERENCES && (
                  <p className="mt-2 text-xs text-red-400">引用数量超出上限，请关闭窗口并减少选择。</p>
                )}
              </div>

              {skillRun.error && <p className="text-xs text-red-400">{skillRun.error}</p>}
            </div>
          ) : skillRun.run ? (
            <div className="space-y-3">
              <SkillRunPanel
                run={skillRun.run}
                actionBusy={skillRun.actionBusy}
                inputSelectTone="dark"
                onAction={performAction}
              />
              {archiveMessage && (
                <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-3 text-xs leading-5 text-neutral-400">
                  {archiveMessage.startsWith("正在") ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">{archiveMessage}</span>
                  {archiveRetryable && skillRun.run?.status === "succeeded" && (
                    <button
                      type="button"
                      disabled={skillRun.actionBusy}
                      onClick={() => {
                        if (skillRun.run) void archiveRun(skillRun.run);
                      }}
                      className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-neutral-200 transition-colors hover:bg-white/8"
                    >
                      重试归档
                    </button>
                  )}
                </div>
              )}
              {skillRun.error && <p className="text-xs text-red-400">{skillRun.error}</p>}
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center text-sm text-neutral-500">
              正在恢复技能运行…
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3.5">
          <span className="text-xs text-neutral-500">
            {active ? "可收起窗口；服务端会继续运行，稍后可从右下角恢复" : `归档位置：${TARGET_LABEL[displayTarget]}`}
          </span>
          {canStart ? (
            <button
              type="button"
              onClick={() => void start()}
              disabled={references.length > MAX_REFERENCES}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-neutral-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
              运行技能
            </button>
          ) : skillRun.run && !active ? (
            <button
              type="button"
              onClick={dismiss}
              className="h-9 rounded-xl border border-white/10 px-4 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/8"
            >
              完成
            </button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
