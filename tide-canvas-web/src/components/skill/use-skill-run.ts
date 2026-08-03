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

function writeStoredRunIds(key: string, ids: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    const normalized = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(-20);
    if (normalized.length) localStorage.setItem(key, JSON.stringify(normalized));
    else localStorage.removeItem(key);
  } catch {
    // Private mode / blocked storage must not make a run unusable.
  }
}

function addStoredRunId(key: string, id: string): void {
  const ids = storedRunIds(key);
  // Do not move an existing ID to the tail on every polling update: another
  // tab may have appended a newer run that should remain the restore target.
  if (!ids.includes(id)) writeStoredRunIds(key, [...ids, id]);
}

function removeStoredRunId(key: string, id: string): void {
  writeStoredRunIds(key, storedRunIds(key).filter((value) => value !== id));
}

export function useSkillRun({
  storageKey,
  pollIntervalMs = 1500,
  onUpdate,
  onTerminal,
}: UseSkillRunOptions = {}) {
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
    (next: SkillRunVO | null) => {
      const previous = currentRunRef.current;
      const previousId = previous?.id ?? currentRunIdRef.current;
      // Polling/detail requests can cross an action from this or another tab.
      // The server revision is monotonic, so an older response must never put a
      // waiting/terminal run back into an actionable stale state.
      if (next && previous?.id === next.id) {
        const previousRevision = previous.revision ?? 0;
        const nextRevision = next.revision ?? 0;
        if (nextRevision < previousRevision) return;
        if (
          nextRevision === previousRevision &&
          (next.updateTime ?? "") < (previous.updateTime ?? "")
        ) return;
      }
      currentRunRef.current = next;
      currentRunIdRef.current = next?.id ?? null;
      setRun(next);
      if (next) onUpdateRef.current?.(next);
      if (storageKey && typeof window !== "undefined") {
        if (next && isSkillRunActive(next.status)) addStoredRunId(storageKey, next.id);
        else if (next) removeStoredRunId(storageKey, next.id);
        else if (previousId) removeStoredRunId(storageKey, previousId);
      }
      if (next && isSkillRunTerminal(next.status) && lastTerminalRef.current !== next.id) {
        lastTerminalRef.current = next.id;
        onTerminalRef.current?.(next);
      }
    },
    [storageKey],
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
        if (!resumeRetryableRef.current && storageKey) removeStoredRunId(storageKey, clean);
        return null;
      }
      resumeRetryableRef.current = false;
      setError("");
      persist(result.data);
      if (storageKey) await skillRunApi.commitCreate(`create:${storageKey}`, result.data.id);
      return result.data;
    },
    [persist, storageKey],
  );

  const start = useCallback(
    async (dto: SkillRunCreateInput): Promise<SkillRunVO | null> => {
      const seq = ++mutationSeqRef.current;
      readSeqRef.current += 1;
      setLoading(true);
      setError("");
      try {
        const result = await skillRunApi.createIdempotent(
          dto,
          storageKey ? `create:${storageKey}` : `create:${dto.entryPoint}`,
        );
        if (seq !== mutationSeqRef.current) return null;
        if (!result.success || !result.data) {
          setError(result.message || "技能启动失败");
          return null;
        }
        lastTerminalRef.current = "";
        persist(result.data);
        await skillRunApi.commitCreate(
          storageKey ? `create:${storageKey}` : `create:${dto.entryPoint}`,
          result.data.id,
        );
        return result.data;
      } finally {
        if (seq === mutationSeqRef.current) setLoading(false);
      }
    },
    [persist, storageKey],
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
      if (action === "retry" && storageKey) addStoredRunId(storageKey, runId);
      try {
        const result = await skillRunApi.actionIdempotent(runId, {
          action,
          expectedRevision: runRevision,
          ...payload,
          clientRequestId: createSkillRunRequestId(`skill-${action}`),
        }, `action:${storageKey || "shared"}:${runId}`);
        if (seq !== mutationSeqRef.current) return null;
        if (!result.success || !result.data) {
          setError(result.message || "操作失败，请重试");
          // A definitive client rejection means retry never became active. Network,
          // timeout, rate-limit and server errors retain the pointer for recovery.
          if (
            action === "retry" &&
            storageKey &&
            result.code >= 400 &&
            result.code < 500 &&
            result.code !== 408 &&
            result.code !== 429
          ) {
            removeStoredRunId(storageKey, runId);
          }
          return null;
        }
        if (action === "retry") lastTerminalRef.current = "";
        persist(result.data);
        return result.data;
      } finally {
        if (seq === mutationSeqRef.current) {
          actionBusyRef.current = false;
          setActionBusy(false);
        }
      }
    },
    [persist, runId, runRevision, storageKey],
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
    persist(null);
    // A second tab may have appended another active run while this hook was
    // displaying a terminal one. Trigger a fresh storage scan after dismiss.
    setRestoreGeneration((value) => value + 1);
  }, [persist]);

  // Refresh-resume: active IDs are stored as a bounded list so independent tabs
  // cannot delete each other's pointer. The former single-ID value is migrated
  // on read; terminal IDs remove only themselves.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1_000;
    const restore = async (quiet = false) => {
      for (const id of skillRunApi.resolvedCreateIds(`create:${storageKey}`)) {
        addStoredRunId(storageKey, id);
      }
      const ids = storedRunIds(storageKey);
      const id = ids.at(-1);
      if (cancelled || !id || currentRunIdRef.current) return;
      const restored = await resume(id, quiet);
      if (cancelled || restored) return;
      if (resumeRetryableRef.current) {
        timer = setTimeout(() => {
          timer = null;
          void restore(true);
        }, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      } else if (storedRunIds(storageKey).length) {
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
      if (event.key !== storageKey || currentRunIdRef.current || timer) return;
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
  }, [resume, restoreGeneration, storageKey]);

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
