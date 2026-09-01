"use client";

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { isAmbiguousSkillRunCode, skillRunApi } from "@/lib/skill-run-api";
import {
  isSkillRunActive,
  type SkillRunActionInput,
  type SkillRunCreateInput,
  type SkillRunVO,
} from "@/types/skill-run";

const POLL_INTERVAL_MS = 2_000;
const AMBIGUOUS_CREATE_POLL_INTERVAL_MS = 10_000;

interface CanvasSkillRunState {
  projectId: string | null;
  runs: Record<string, SkillRunVO>;
  loading: boolean;
  actionBusy: Set<string>;
  /** 持久化 run ID 尚未成功对账的集合；网络恢复前保留并重试。 */
  pendingRecoveryIds: Set<string>;
  /** Create 响应不明确时，用幂等请求号向服务端对账，避免终态运行从 active 列表消失。 */
  pendingCreateRequestIds: Set<string>;
  /** Successful lookup misses are kept briefly to cover a late server commit. */
  pendingCreateMisses: Record<string, number>;
  /** 当前项目的 active 列表尚未成功拉取。 */
  discoveryPending: boolean;
  resume: (projectId: string, recoveryRunIds?: readonly string[]) => Promise<void>;
  recover: (runIds: readonly string[]) => void;
  refresh: () => Promise<void>;
  createRun: (dto: SkillRunCreateInput) => Promise<SkillRunVO>;
  performAction: (
    runId: string,
    dto: Omit<SkillRunActionInput, "expectedRevision">,
  ) => Promise<SkillRunVO>;
  forget: (runId: string) => void;
}

interface PollSession {
  projectId: string;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  refreshInFlight: Promise<void> | null;
}

let nextGeneration = 0;
let activeSession: PollSession | null = null;

function normalizeRunIds(values: readonly string[]): string[] {
  return [...new Set(values.map(String).filter(Boolean))];
}

function isCurrentSession(session: PollSession): boolean {
  return activeSession === session
    && activeSession.generation === session.generation
    && useCanvasSkillRunStore.getState().projectId === session.projectId;
}

function stopSession(session: PollSession | null) {
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  // 在途请求不能由现有 http 封装取消，但它持有旧 session；完成后不会写入新项目。
  session.refreshInFlight = null;
}

function beginSession(projectId: string): PollSession {
  stopSession(activeSession);
  const session: PollSession = {
    projectId,
    generation: ++nextGeneration,
    timer: null,
    refreshInFlight: null,
  };
  activeSession = session;
  return session;
}

function mergeRuns(current: Record<string, SkillRunVO>, incoming: readonly SkillRunVO[]) {
  if (!incoming.length) return current;
  const next = { ...current };
  for (const run of incoming) {
    const previous = next[run.id];
    // Poll/detail calls may have started before a user action. Revision is the
    // server's monotonic fence, so an older response must never roll UI state back.
    if (previous && (run.revision ?? 0) < (previous.revision ?? 0)) continue;
    if (
      previous &&
      (run.revision ?? 0) === (previous.revision ?? 0) &&
      (run.updateTime ?? "") < (previous.updateTime ?? "")
    ) continue;
    next[run.id] = run;
  }
  return next;
}

function isCanvasRunForProject(run: SkillRunVO, projectId: string): boolean {
  return run.entryPoint === "canvas" && String(run.projectId ?? "") === projectId;
}

function shouldRetry(code: number | undefined): boolean {
  return code === undefined || isAmbiguousSkillRunCode(code);
}

function needsPolling(state: CanvasSkillRunState): boolean {
  return state.discoveryPending
    || state.pendingRecoveryIds.size > 0
    || state.pendingCreateRequestIds.size > 0
    || Object.values(state.runs).some((run) => isSkillRunActive(run.status));
}

function schedulePoll(session: PollSession) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  if (!isCurrentSession(session) || !needsPolling(useCanvasSkillRunStore.getState())) return;
  const state = useCanvasSkillRunStore.getState();
  const ambiguousCreateHasRepeatedMisses = [...state.pendingCreateRequestIds]
    .some((requestId) => (state.pendingCreateMisses[requestId] ?? 0) >= 5);
  session.timer = setTimeout(() => {
    session.timer = null;
    if (!isCurrentSession(session)) return;
    void refreshSession(session);
  }, ambiguousCreateHasRepeatedMisses ? AMBIGUOUS_CREATE_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
}

function refreshSession(session: PollSession): Promise<void> {
  if (!isCurrentSession(session)) return Promise.resolve();
  if (session.refreshInFlight) return session.refreshInFlight;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;

  const snapshot = useCanvasSkillRunStore.getState();
  const createScope = `create:canvas:${session.projectId}`;
  // The durable journal owns the ambiguity window. Once its 24h pending TTL
  // expires, the in-memory poll set must stop too instead of empty-querying forever.
  const durablePendingCreateRequestIds = new Set(
    skillRunApi.unresolvedCreateRequestIds(createScope),
  );
  const snapshotPendingCreateRequestIds = new Set(snapshot.pendingCreateRequestIds);
  const detailIds = normalizeRunIds([
    ...snapshot.pendingRecoveryIds,
    ...Object.values(snapshot.runs)
      .filter((run) => isSkillRunActive(run.status))
      .map((run) => run.id),
  ]);
  const pendingCreateRequestIds = [...snapshot.pendingCreateRequestIds]
    .filter((requestId) => durablePendingCreateRequestIds.has(requestId));
  const pendingCreateBatches: string[][] = [];
  for (let index = 0; index < pendingCreateRequestIds.length; index += 10) {
    pendingCreateBatches.push(pendingCreateRequestIds.slice(index, index + 10));
  }
  const request = (async () => {
    const [activeResponse, detailResponses, pendingCreateResponses] = await Promise.all([
      skillRunApi.listActive({
        projectId: session.projectId,
        entryPoint: "canvas",
        pageNum: 1,
        pageSize: 100,
      }),
      Promise.all(detailIds.map(async (runId) => ({
        runId,
        response: await skillRunApi.detail(runId),
      }))),
      Promise.all(pendingCreateBatches.map(async (requestIds) => ({
        requestIds,
        response: await skillRunApi.list({
          projectId: session.projectId,
          entryPoint: "canvas",
          clientRequestIds: JSON.stringify(requestIds),
          pageNum: 1,
          pageSize: requestIds.length,
        }),
      }))),
    ]);

    const recoveredCreates: SkillRunVO[] = [];
    const settledCreateRequestIds = new Set<string>();
    const missedCreateRequests = new Map<string, number>();
    const settlementTasks: Promise<void>[] = [];
    for (const { requestIds, response } of pendingCreateResponses) {
      if (response.success && response.data) {
        const byRequestId = new Map(
          (response.data.records ?? [])
            .filter((run) => isCanvasRunForProject(run, session.projectId) && !!run.clientRequestId)
            .map((run) => [run.clientRequestId as string, run]),
        );
        for (const requestId of requestIds) {
          const run = byRequestId.get(requestId);
          if (run) {
            recoveredCreates.push(run);
            settledCreateRequestIds.add(requestId);
            settlementTasks.push(skillRunApi.settlePendingCreate(createScope, requestId, run.id));
            continue;
          }
          // A successful empty lookup is still not proof that an ambiguous
          // POST was never accepted (gateway buffering/server commit can lag).
          // Retain the original request id and only reduce poll frequency.
          missedCreateRequests.set(requestId, (snapshot.pendingCreateMisses[requestId] ?? 0) + 1);
        }
      } else {
        for (const requestId of requestIds) {
          missedCreateRequests.set(requestId, (snapshot.pendingCreateMisses[requestId] ?? 0) + 1);
        }
      }
    }
    await Promise.all(settlementTasks);

    if (!isCurrentSession(session)) return;
    useCanvasSkillRunStore.setState((state) => {
      if (state.projectId !== session.projectId) return state;
      let runs = state.runs;
      const pendingRecoveryIds = new Set(state.pendingRecoveryIds);
      const nextPendingCreateRequestIds = new Set(state.pendingCreateRequestIds);
      const pendingCreateMisses = { ...state.pendingCreateMisses };
      let discoveryPending = state.discoveryPending;

      for (const requestId of nextPendingCreateRequestIds) {
        if (
          !snapshotPendingCreateRequestIds.has(requestId) ||
          durablePendingCreateRequestIds.has(requestId)
        ) continue;
        nextPendingCreateRequestIds.delete(requestId);
        delete pendingCreateMisses[requestId];
      }

      for (const requestId of settledCreateRequestIds) {
        nextPendingCreateRequestIds.delete(requestId);
        delete pendingCreateMisses[requestId];
      }
      for (const [requestId, misses] of missedCreateRequests) {
        if (nextPendingCreateRequestIds.has(requestId)) pendingCreateMisses[requestId] = misses;
      }
      runs = mergeRuns(runs, recoveredCreates);

      if (activeResponse.success && activeResponse.data) {
        runs = mergeRuns(
          runs,
          (activeResponse.data.records ?? []).filter((run) => isCanvasRunForProject(run, session.projectId)),
        );
        discoveryPending = false;
      } else if (!shouldRetry(activeResponse.code)) {
        discoveryPending = false;
      }

      const recovered: SkillRunVO[] = [];
      for (const { runId, response } of detailResponses) {
        if (response.success && response.data) {
          // canvasData is user-editable project JSON. A copied/stale run ID must
          // never materialize another project's artifacts into this canvas.
          if (isCanvasRunForProject(response.data, session.projectId)) {
            recovered.push(response.data);
          }
          pendingRecoveryIds.delete(runId);
        } else if (!shouldRetry(response.code)) {
          // 404/403 等永久失败不能让画布永远轮询；ID 仍保存在 canvasData 供后续人工排查。
          // 同时必须给 UI 一个终态:引用该 runId 的会话消息还在等它,只删轮询集合
          // 会让消息永远停在"运行中"。查无记录就合成失败终态,已有记录则原地落败。
          pendingRecoveryIds.delete(runId);
          const existing = runs[runId];
          const errorMessage = response.message || "技能运行记录已不存在或不可访问，无法恢复结果";
          recovered.push(existing
            ? { ...existing, status: "failed", errorMessage }
            : {
                id: runId,
                skillId: "",
                entryPoint: "canvas",
                projectId: session.projectId,
                status: "failed",
                progress: 0,
                revision: 0,
                errorMessage,
              });
        }
      }
      runs = mergeRuns(runs, recovered);
      return {
        runs,
        pendingRecoveryIds,
        pendingCreateRequestIds: nextPendingCreateRequestIds,
        pendingCreateMisses,
        discoveryPending,
        loading: false,
      };
    });
  })().finally(() => {
    // 旧项目请求的 finally 不能清空或重排新项目的轮询。
    if (activeSession !== session) return;
    if (session.refreshInFlight === request) session.refreshInFlight = null;
    schedulePoll(session);
  });

  session.refreshInFlight = request;
  return request;
}

function actionRequestId(action: string): string {
  return `canvas_${action}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useCanvasSkillRunStore = create<CanvasSkillRunState>((set) => ({
  projectId: null,
  runs: {},
  loading: false,
  actionBusy: new Set(),
  pendingRecoveryIds: new Set(),
  pendingCreateRequestIds: new Set(),
  pendingCreateMisses: {},
  discoveryPending: false,

  resume: async (projectId, recoveryRunIds = []) => {
    const normalizedProjectId = String(projectId);
    const session = beginSession(normalizedProjectId);
    const createScope = `create:canvas:${normalizedProjectId}`;
    const acceptedButUncommitted = skillRunApi.resolvedCreateIds(createScope);
    const ambiguousCreateRequests = skillRunApi.unresolvedCreateRequestIds(createScope);
    set({
      projectId: normalizedProjectId,
      runs: {},
      loading: true,
      actionBusy: new Set(),
      pendingRecoveryIds: new Set(normalizeRunIds([...recoveryRunIds, ...acceptedButUncommitted])),
      pendingCreateRequestIds: new Set(ambiguousCreateRequests),
      pendingCreateMisses: Object.fromEntries(ambiguousCreateRequests.map((requestId) => [requestId, 0])),
      discoveryPending: true,
    });
    await refreshSession(session);
  },

  recover: (runIds) => {
    const session = activeSession;
    if (!session || !isCurrentSession(session)) return;
    const normalized = normalizeRunIds(runIds);
    let changed = false;
    set((state) => {
      const pendingRecoveryIds = new Set(state.pendingRecoveryIds);
      for (const runId of normalized) {
        if (state.runs[runId] || pendingRecoveryIds.has(runId)) continue;
        pendingRecoveryIds.add(runId);
        changed = true;
      }
      return changed ? { pendingRecoveryIds } : state;
    });
    if (changed) {
      if (session.refreshInFlight) schedulePoll(session);
      else void refreshSession(session);
    }
  },

  refresh: async () => {
    const session = activeSession;
    if (!session) return;
    await refreshSession(session);
  },

  createRun: async (dto) => {
    const session = activeSession;
    if (
      !session ||
      dto.entryPoint !== "canvas" ||
      String(dto.projectId ?? "") !== session.projectId
    ) {
      throw new Error("画布已切换，请在当前画布重新启动 Skill");
    }
    const clientRequestId = dto.clientRequestId?.trim() || actionRequestId("create");
    const response = await skillRunApi.createIdempotent(
      { ...dto, clientRequestId },
      `create:canvas:${session.projectId}`,
    );
    if (!response.success || !response.data) {
      if (shouldRetry(response.code) && isCurrentSession(session)) {
        const unresolvedRequestIds = skillRunApi.unresolvedCreateRequestIds(
          `create:canvas:${session.projectId}`,
        );
        set((state) => ({
          pendingCreateRequestIds: new Set([
            ...state.pendingCreateRequestIds,
            ...unresolvedRequestIds,
          ]),
          pendingCreateMisses: {
            ...state.pendingCreateMisses,
            ...Object.fromEntries(unresolvedRequestIds.map((requestId) => [requestId, 0])),
          },
        }));
        schedulePoll(session);
      }
      throw new Error(response.message || "Skill 启动失败");
    }
    if (!isCurrentSession(session)) throw new Error("画布已切换，运行不会写入当前画布");
    const run = response.data;
    if (!isCanvasRunForProject(run, session.projectId)) {
      throw new Error("Skill 返回了不属于当前画布的运行");
    }
    set((state) => {
      const pendingCreateRequestIds = new Set(state.pendingCreateRequestIds);
      pendingCreateRequestIds.delete(clientRequestId);
      const pendingCreateMisses = { ...state.pendingCreateMisses };
      delete pendingCreateMisses[clientRequestId];
      return { runs: mergeRuns(state.runs, [run]), pendingCreateRequestIds, pendingCreateMisses };
    });
    schedulePoll(session);
    return run;
  },

  performAction: async (runId, dto) => {
    const session = activeSession;
    if (!session || !isCurrentSession(session)) throw new Error("画布已切换");
    const currentRun = useCanvasSkillRunStore.getState().runs[runId];
    if (!currentRun || !isCanvasRunForProject(currentRun, session.projectId)) {
      throw new Error("该 Skill 运行不属于当前画布");
    }
    set((state) => ({ actionBusy: new Set(state.actionBusy).add(runId) }));
    try {
      const response = await skillRunApi.actionIdempotent(runId, {
        ...dto,
        expectedRevision: currentRun.revision,
        clientRequestId: dto.clientRequestId || actionRequestId(dto.action),
      }, `action:canvas:${session.projectId}:${runId}`);
      if (!response.success || !response.data) {
        // Another tab may have advanced the run. Reconcile immediately so the
        // next action is based on the current revision even for terminal runs.
        if (isCurrentSession(session)) void refreshSession(session);
        throw new Error(response.message || "操作失败");
      }
      if (!isCurrentSession(session)) throw new Error("画布已切换，操作结果不会写入当前画布");
      const run = response.data;
      if (!isCanvasRunForProject(run, session.projectId)) {
        throw new Error("Skill 操作返回了不属于当前画布的运行");
      }
      set((state) => ({ runs: mergeRuns(state.runs, [run]) }));
      schedulePoll(session);
      return run;
    } finally {
      if (isCurrentSession(session)) {
        set((state) => {
          const actionBusy = new Set(state.actionBusy);
          actionBusy.delete(runId);
          return { actionBusy };
        });
      }
    }
  },

  forget: (runId) => set((state) => {
    if (!state.runs[runId]) return state;
    const runs = { ...state.runs };
    delete runs[runId];
    return { runs };
  }),
}));

export function stopCanvasSkillRunPolling() {
  const session = activeSession;
  activeSession = null;
  stopSession(session);
  useCanvasSkillRunStore.setState({
    projectId: null,
    runs: {},
    loading: false,
    actionBusy: new Set(),
    pendingRecoveryIds: new Set(),
    pendingCreateRequestIds: new Set(),
    pendingCreateMisses: {},
    discoveryPending: false,
  });
}

/** 画布级唯一恢复入口；与普通 AiTask 的 activeTasks/stopAllGeneration 完全独立。 */
export function useSkillRuns(projectId: string | null, recoveryRunIds: readonly string[] = []) {
  const resume = useCanvasSkillRunStore((state) => state.resume);
  const recover = useCanvasSkillRunStore((state) => state.recover);
  const recoveryKey = useMemo(
    () => normalizeRunIds(recoveryRunIds).sort().join("\u0000"),
    [recoveryRunIds],
  );

  useEffect(() => {
    if (!projectId) return;
    void resume(projectId, recoveryRunIds);
    return () => {
      if (useCanvasSkillRunStore.getState().projectId === projectId) stopCanvasSkillRunPolling();
    };
    // recoveryRunIds 由下面的增量恢复 effect 处理，避免新增 run ID 时重置整个运行面板。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, resume]);

  useEffect(() => {
    if (!projectId || !recoveryKey) return;
    recover(recoveryKey.split("\u0000"));
  }, [projectId, recover, recoveryKey]);

  const runsById = useCanvasSkillRunStore((state) => state.runs);
  const loading = useCanvasSkillRunStore((state) => state.loading);
  const actionBusy = useCanvasSkillRunStore((state) => state.actionBusy);
  const createRun = useCanvasSkillRunStore((state) => state.createRun);
  const performAction = useCanvasSkillRunStore((state) => state.performAction);
  const refresh = useCanvasSkillRunStore((state) => state.refresh);
  const runs = useMemo(
    () => Object.values(runsById).sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? "")),
    [runsById],
  );
  return { runs, loading, actionBusy, createRun, performAction, refresh };
}
