"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { skillRunApi } from "@/lib/skill-run-api";
import type {
  SkillRunAction,
  SkillRunActionDTO,
  SkillRunCreateInput,
  SkillRunVO,
} from "@/types/skill-run";
import { isSkillRunActive, isSkillRunTerminal } from "@/types/skill-run";

export function createSkillRunRequestId(prefix = "skill-run"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface UseSkillRunOptions {
  storageKey?: string;
  /** Confirmed account id used to partition pointers and request journals. */
  ownerUserId?: string;
  pollIntervalMs?: number;
  onUpdate?: (run: SkillRunVO) => void;
  onTerminal?: (run: SkillRunVO) => void;
}

function storedRunIds(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key)?.trim() || "";
    if (!raw) return [];
    if (!raw.startsWith("[")) return [raw]; // migrate the former single-ID value
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((value): value is string => typeof value === "string" && !!value.trim()))].slice(-20)
      : [];
  } catch {
    return [];
  }
}

function normalizedRunIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(-20);
}

function writeStoredRunIds(key: string, ids: readonly string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    const normalized = normalizedRunIds(ids);
    if (normalized.length) localStorage.setItem(key, JSON.stringify(normalized));
    else localStorage.removeItem(key);
    const stored = storedRunIds(key);
    return stored.length === normalized.length && stored.every((id, index) => id === normalized[index]);
  } catch {
    return false;
  }
}

async function mutateStoredRunIds(
  key: string,
  mutate: (ids: string[]) => string[],
): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.locks) return false;
  const lockName = `tidecanvas.skill-run.active:${encodeURIComponent(key).slice(0, 180)}`;
  return navigator.locks.request(lockName, () => {
    const current = storedRunIds(key);
    return writeStoredRunIds(key, mutate(current));
  });
}

function addStoredRunId(key: string, id: string): Promise<boolean> {
  return mutateStoredRunIds(key, (ids) => ids.includes(id) ? ids : [...ids, id]);
}

function removeStoredRunId(key: string, id: string): Promise<boolean> {
  return mutateStoredRunIds(key, (ids) => ids.filter((value) => value !== id));
}

export function useSkillRun({
  storageKey,
  ownerUserId,
  pollIntervalMs = 1500,
  onUpdate,
  onTerminal,
}: UseSkillRunOptions = {}) {
  const owner = ownerUserId?.trim() ?? "";
  const scopedStorageKey = storageKey && owner
    ? `${storageKey}:user:${encodeURIComponent(owner)}`
    : undefined;
  const [run, setRun] = useState<SkillRunVO | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [restoreGeneration, setRestoreGeneration] = useState(0);
  const mutationSeqRef = useRef(0);
  const readSeqRef = useRef(0);
  const actionBusyRef = useRef(false);
  const currentRunIdRef = useRef<string | null>(null);
  const currentRunRef = useRef<SkillRunVO | null>(null);
  const resumeRetryableRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  const onTerminalRef = useRef(onTerminal);
  const lastTerminalRef = useRef("");
  const runId = run?.id;
  const runStatus = run?.status;
  const runRevision = run?.revision;

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const persist = useCallback(
    async (next: SkillRunVO | null): Promise<boolean> => {
      const previous = currentRunRef.current;
      const previousId = previous?.id ?? currentRunIdRef.current;
      // Polling/detail requests can cross an action from this or another tab.
      // The server revision is monotonic, so an older response must never put a
      // waiting/terminal run back into an actionable stale state.
      if (next && previous?.id === next.id) {
        const previousRevision = previous.revision ?? 0;
        const nextRevision = next.revision ?? 0;
        if (nextRevision < previousRevision) return false;
        if (
          nextRevision === previousRevision &&
          (next.updateTime ?? "") < (previous.updateTime ?? "")
        ) return false;
      }
      currentRunRef.current = next;
      currentRunIdRef.current = next?.id ?? null;
      setRun(next);
      if (next) onUpdateRef.current?.(next);
      let durablePointer = true;
      if (scopedStorageKey && typeof window !== "undefined") {
        if (next && isSkillRunActive(next.status)) {
          durablePointer = await addStoredRunId(scopedStorageKey, next.id);
        } else if (next) {
          await removeStoredRunId(scopedStorageKey, next.id);
        } else if (previousId) {
          await removeStoredRunId(scopedStorageKey, previousId);
        }
      }
      if (next && isSkillRunTerminal(next.status) && lastTerminalRef.current !== next.id) {
        lastTerminalRef.current = next.id;
        onTerminalRef.current?.(next);
      }
      return durablePointer;
    },
    [scopedStorageKey],
  );

  const resume = useCallback(
    async (id: string, quiet = false): Promise<SkillRunVO | null> => {
      const clean = id.trim();
      if (!clean) return null;
      const readSeq = ++readSeqRef.current;
      const mutationSeq = mutationSeqRef.current;
      if (!quiet) setLoading(true);
      const result = await skillRunApi.detail(clean);
      // A create/action that started after this read owns the newer truth. Never
      // let a slower polling response roll the run back to its pre-action state.
      if (readSeq !== readSeqRef.current || mutationSeq !== mutationSeqRef.current) return null;
      if (!quiet) setLoading(false);
      if (!result.success || !result.data) {
        setError(result.message || "技能运行加载失败");
        resumeRetryableRef.current =
          !result.code || result.code === 408 || result.code === 429 || result.code >= 500;
        if (!resumeRetryableRef.current && scopedStorageKey) {
          await removeStoredRunId(scopedStorageKey, clean);
        }
        return null;
      }
      resumeRetryableRef.current = false;
      setError("");
      const durablePointer = await persist(result.data);
      if (scopedStorageKey && durablePointer) {
        await skillRunApi.commitCreate(`create:${scopedStorageKey}`, result.data.id);
      }
      return result.data;
    },
    [persist, scopedStorageKey],
  );

  const start = useCallback(
    async (dto: SkillRunCreateInput): Promise<SkillRunVO | null> => {
      const seq = ++mutationSeqRef.current;
      readSeqRef.current += 1;
      setLoading(true);
      setError("");
      try {
        if (!owner || !scopedStorageKey) {
          setError("无法确认当前账号或安全保存运行状态，Skill 尚未启动");
          return null;
        }
        const createScope = `create:${scopedStorageKey}`;
        const result = await skillRunApi.createIdempotent(
          dto,
          createScope,
        );
        if (seq !== mutationSeqRef.current) return null;
        if (!result.success || !result.data) {
          setError(result.message || "技能启动失败");
          return null;
        }
        lastTerminalRef.current = "";
        const durablePointer = await persist(result.data);
        if (durablePointer) await skillRunApi.commitCreate(createScope, result.data.id);
        return result.data;
      } finally {
        if (seq === mutationSeqRef.current) setLoading(false);
      }
    },
    [owner, persist, scopedStorageKey],
  );

  const performAction = useCallback(
    async (
      action: SkillRunAction,
      payload: Omit<SkillRunActionDTO, "action" | "clientRequestId" | "expectedRevision"> = {},
    ): Promise<SkillRunVO | null> => {
      if (!runId || runRevision === undefined || actionBusyRef.current) return null;
      const seq = ++mutationSeqRef.current;
      readSeqRef.current += 1;
      actionBusyRef.current = true;
      setActionBusy(true);
      setError("");
      // A failed/cancelled run is normally no longer in the active pointer list.
      // Re-add it *before* retry reaches the server so a lost success response can
      // still be recovered after refresh instead of creating an invisible run.
      try {
        if (!owner || !scopedStorageKey) {
          setError("无法确认当前账号或安全保存运行状态，操作尚未执行");
          return null;
        }
        if (action === "retry" && !await addStoredRunId(scopedStorageKey, runId)) {
          setError("当前浏览器无法安全保存重试任务，操作尚未执行");
          return null;
        }
        const result = await skillRunApi.actionIdempotent(runId, {
          action,
          expectedRevision: runRevision,
          ...payload,
          clientRequestId: createSkillRunRequestId(`skill-${action}`),
        }, `action:${scopedStorageKey}:${runId}`);
        if (seq !== mutationSeqRef.current) return null;
        if (!result.success || !result.data) {
          setError(result.message || "操作失败，请重试");
          // A definitive client rejection means retry never became active. Network,
          // timeout, rate-limit and server errors retain the pointer for recovery.
          if (
            action === "retry" &&
            result.code >= 400 &&
            result.code < 500 &&
            result.code !== 408 &&
            result.code !== 429
          ) {
            await removeStoredRunId(scopedStorageKey, runId);
          }
          return null;
        }
        if (action === "retry") lastTerminalRef.current = "";
        await persist(result.data);
        return result.data;
      } finally {
        if (seq === mutationSeqRef.current) {
          actionBusyRef.current = false;
          setActionBusy(false);
        }
      }
    },
    [owner, persist, runId, runRevision, scopedStorageKey],
  );

  const refresh = useCallback(async () => {
    if (!runId) return null;
    return resume(runId, true);
  }, [resume, runId]);

  const clear = useCallback(() => {
    mutationSeqRef.current += 1;
    readSeqRef.current += 1;
    actionBusyRef.current = false;
    setLoading(false);
    setActionBusy(false);
    setError("");
    void persist(null);
    // A second tab may have appended another active run while this hook was
    // displaying a terminal one. Trigger a fresh storage scan after dismiss.
    setRestoreGeneration((value) => value + 1);
  }, [persist]);

  // Refresh-resume: active IDs are stored as a bounded list so independent tabs
  // cannot delete each other's pointer. The former single-ID value is migrated
  // on read; terminal IDs remove only themselves.
  useEffect(() => {
    if (!scopedStorageKey || typeof window === "undefined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1_000;
    const restore = async (quiet = false) => {
      const resolvedIds = skillRunApi.resolvedCreateIds(`create:${scopedStorageKey}`);
      for (const id of resolvedIds) {
        await addStoredRunId(scopedStorageKey, id);
      }
      const ids = storedRunIds(scopedStorageKey);
      const id = ids.at(-1) ?? resolvedIds.at(-1);
      if (cancelled || !id || currentRunIdRef.current) return;
      const restored = await resume(id, quiet);
      if (cancelled || restored) return;
      if (resumeRetryableRef.current) {
        timer = setTimeout(() => {
          timer = null;
          void restore(true);
        }, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      } else if (storedRunIds(scopedStorageKey).length) {
        // The latest pointer was permanently invalid; try an older active ID.
        timer = setTimeout(() => {
          timer = null;
          void restore(true);
        }, 0);
      }
    };
    timer = setTimeout(() => {
      timer = null;
      void restore(false);
    }, 0);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== scopedStorageKey || currentRunIdRef.current || timer) return;
      backoff = 1_000;
      timer = setTimeout(() => {
        timer = null;
        void restore(true);
      }, 0);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [resume, restoreGeneration, scopedStorageKey]);

  useEffect(() => {
    if (!runId || !isSkillRunActive(runStatus)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delay = runStatus === "waiting_input" || runStatus === "waiting_confirmation"
      ? Math.max(4_000, pollIntervalMs * 2)
      : Math.max(750, pollIntervalMs);
    const tick = async () => {
      if (cancelled) return;
      if (!actionBusyRef.current) await resume(runId, true);
      if (!cancelled) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollIntervalMs, resume, runId, runStatus]);

  return {
    run,
    loading,
    actionBusy,
    error,
    start,
    resume,
    refresh,
    performAction,
    clear,
  };
}

export type SkillRunController = ReturnType<typeof useSkillRun>;
