import { http, toParams } from "@/lib/http";
import type { PageData, Result } from "@/types/api";
import type {
  SkillRunActionDTO,
  SkillRunActionInput,
  SkillRunCreateDTO,
  SkillRunCreateInput,
  SkillRunQuery,
  SkillRunVO,
} from "@/types/skill-run";

interface PendingMutation {
  id: string;
  fingerprint: string;
  updatedAt: number;
  /** Set after the server accepted a create, cleared only after the surface persisted it. */
  resultId?: string;
  /** Reserve quota for resultId before the paid create is sent. */
  storagePadding?: string;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
// Once the server has accepted a run, the journal is a recovery pointer rather
// than a transient request retry. Keep it long enough to survive an extended
// offline/save failure without silently losing a terminal canvas result.
const RESOLVED_CREATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESULT_ID_STORAGE_PADDING = "0".repeat(64);
const pendingMemory = new Map<string, PendingMutation[]>();

function stableJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJSON(object[key])}`)
    .join(",")}}`;
}

async function mutationFingerprint(payload: unknown): Promise<string> {
  const serialized = stableJSON(payload);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(serialized);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // Old webviews without SubtleCrypto still need a stable (non-security)
  // payload identity. Two differently seeded 32-bit hashes reduce collisions.
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function requestId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pendingStorageKey(scope: string): string {
  return `tidecanvas.skill-run.pending.${encodeURIComponent(scope).slice(0, 180)}`;
}

function validPending(value: unknown): value is PendingMutation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingMutation>;
  return typeof row.id === "string" &&
    typeof row.fingerprint === "string" &&
    typeof row.updatedAt === "number" &&
    Number.isFinite(row.updatedAt) &&
    Date.now() - row.updatedAt < (row.resultId ? RESOLVED_CREATE_TTL_MS : PENDING_TTL_MS) &&
    (row.resultId === undefined || typeof row.resultId === "string") &&
    (row.storagePadding === undefined || typeof row.storagePadding === "string");
}

function readPending(scope: string): PendingMutation[] {
  const fallback = (pendingMemory.get(scope) ?? []).filter(validPending);
  if (typeof window === "undefined") return fallback;
  try {
    // A readable persisted partition is authoritative across tabs. Merging a
    // stale tab-local map would resurrect a create another tab already committed.
    const raw = localStorage.getItem(pendingStorageKey(scope));
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw || "null");
    } catch {
      parsed = null;
    }
    // Migrate the former single-record format and accept the current bounded list.
    const stored = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const merged = new Map<string, PendingMutation>();
    for (const value of stored) {
      if (!validPending(value)) continue;
      const previous = merged.get(value.fingerprint);
      if (!previous || value.updatedAt >= previous.updatedAt) merged.set(value.fingerprint, value);
    }
    const rows = [...merged.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(-40);
    if (rows.length) pendingMemory.set(scope, rows);
    else pendingMemory.delete(scope);
    return rows;
  } catch {
    // Only an unavailable read may use current-tab memory.
    return fallback;
  }
}

function writePending(scope: string, rows: readonly PendingMutation[]): boolean {
  const normalized = rows.filter(validPending).sort((a, b) => a.updatedAt - b.updatedAt).slice(-40);
  if (normalized.length) pendingMemory.set(scope, normalized);
  else pendingMemory.delete(scope);
  if (typeof window === "undefined") return false;
  try {
    if (normalized.length) localStorage.setItem(pendingStorageKey(scope), JSON.stringify(normalized));
    else localStorage.removeItem(pendingStorageKey(scope));
    const raw = localStorage.getItem(pendingStorageKey(scope));
    if (!normalized.length) return raw === null;
    const parsed: unknown = JSON.parse(raw || "null");
    return Array.isArray(parsed) && normalized.every((expected) =>
      parsed.some((value) => validPending(value) && stableJSON(value) === stableJSON(expected)),
    );
  } catch {
    // Current-tab idempotency still works when storage is unavailable.
    return false;
  }
}

async function withPendingLock<T>(scope: string, work: () => T | Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`tidecanvas.skill-run:${encodeURIComponent(scope).slice(0, 160)}`, work);
  }
  return work();
}

export function isAmbiguousSkillRunCode(code: number): boolean {
  return code === 0
    || code === 401
    || code === 408
    || code === 429
    || (code >= 500 && code <= 599);
}

function isDefinitiveResponse(result: Result<unknown>): boolean {
  // 2xxx/3xxx are explicit business rejections in the shared Result envelope,
  // not transport/server errors. They must retire the request journal.
  return result.success || !isAmbiguousSkillRunCode(result.code);
}

type PreparedMutation<TPayload extends { clientRequestId?: string }> =
  Omit<TPayload, "clientRequestId"> & { clientRequestId: string };

function journalUnavailableResult<TResult>(): Result<TResult> {
  return {
    success: false,
    code: 409,
    message: "当前浏览器无法安全保存 Skill 运行状态，请更新浏览器或开启本地存储后重试（运行尚未启动）",
    data: undefined as unknown as TResult,
    timestamp: Date.now(),
  };
}

async function idempotentMutation<TPayload extends { clientRequestId?: string }, TResult>(
  scope: string,
  prefix: string,
  payload: TPayload,
  send: (prepared: PreparedMutation<TPayload>) => Promise<Result<TResult>>,
  retainResolved: boolean,
  requireDurable: boolean,
): Promise<Result<TResult>> {
  if (
    requireDurable &&
    (typeof navigator === "undefined" || !navigator.locks)
  ) {
    return journalUnavailableResult<TResult>();
  }
  const { clientRequestId: _ignored, ...fingerprintPayload } = payload;
  void _ignored;
  const fingerprint = await mutationFingerprint(fingerprintPayload);
  const prepared = await withPendingLock(scope, () => {
    const rows = readPending(scope);
    const previous = rows.find((row) => row.fingerprint === fingerprint);
    const reserved: PendingMutation = previous
      ? {
          ...previous,
          updatedAt: Date.now(),
          ...(!previous.resultId && retainResolved ? { storagePadding: RESULT_ID_STORAGE_PADDING } : {}),
        }
      : {
          id: payload.clientRequestId?.trim() || requestId(prefix),
          fingerprint,
          updatedAt: Date.now(),
          ...(retainResolved ? { storagePadding: RESULT_ID_STORAGE_PADDING } : {}),
        };
    const durable = writePending(
      scope,
      [...rows.filter((row) => row.fingerprint !== fingerprint), reserved],
    );
    return { pending: reserved, durable };
  });
  // Create/retry/confirmation/input actions can trigger paid steps. Cancel is
  // deliberately exempt: inability to write localStorage must never prevent a
  // user from stopping work (the server receipt still makes it replay-safe).
  if (requireDurable && !prepared.durable) return journalUnavailableResult<TResult>();
  const pending = prepared.pending;
  const result = await send({ ...payload, clientRequestId: pending.id });
  if (isDefinitiveResponse(result)) {
    await withPendingLock(scope, () => {
      const rows = readPending(scope);
      const latest = rows.find((row) => row.fingerprint === fingerprint);
      if (!latest || latest.id !== pending.id) return;
      const resultId = result.success && result.data && typeof result.data === "object"
        ? String((result.data as { id?: unknown }).id ?? "").trim()
        : "";
      if (retainResolved && result.success && resultId) {
        writePending(scope, [
          ...rows.filter((row) => row.fingerprint !== fingerprint),
          { ...latest, resultId, storagePadding: undefined, updatedAt: Date.now() },
        ]);
      } else {
        writePending(scope, rows.filter((row) => row.fingerprint !== fingerprint));
      }
    });
  }
  return result;
}

function resolvedMutationIds(scope: string): string[] {
  return [...new Set(readPending(scope).flatMap((row) => row.resultId ? [row.resultId] : []))];
}

function unresolvedMutationRequestIds(scope: string): string[] {
  return [...new Set(readPending(scope).flatMap((row) => !row.resultId ? [row.id] : []))];
}

async function settlePendingCreate(scope: string, clientRequestId: string, resultId?: string): Promise<void> {
  const requestId = clientRequestId.trim();
  const resolvedId = resultId?.trim() ?? "";
  if (!requestId) return;
  await withPendingLock(scope, () => {
    const rows = readPending(scope);
    const pending = rows.find((row) => row.id === requestId);
    if (!pending) return;
    if (!resolvedId) {
      writePending(scope, rows.filter((row) => row.id !== requestId));
      return;
    }
    writePending(scope, [
      ...rows.filter((row) => row.id !== requestId),
      { ...pending, resultId: resolvedId, storagePadding: undefined, updatedAt: Date.now() },
    ]);
  });
}

async function commitResolvedMutation(scope: string, resultId: string): Promise<void> {
  const clean = resultId.trim();
  if (!clean) return;
  await withPendingLock(scope, () => {
    const rows = readPending(scope);
    writePending(scope, rows.filter((row) => row.resultId !== clean));
  });
}

export const skillRunApi = {
  create: (dto: SkillRunCreateDTO) => http.post<SkillRunVO>("/api/skill-runs", dto),

  createIdempotent: (dto: SkillRunCreateInput, scope: string) =>
    idempotentMutation(
      scope,
      dto.entryPoint,
      dto,
      (prepared: SkillRunCreateDTO) => http.post<SkillRunVO>("/api/skill-runs", prepared),
      true,
      true,
    ),

  resolvedCreateIds: resolvedMutationIds,

  unresolvedCreateRequestIds: unresolvedMutationRequestIds,

  settlePendingCreate,

  commitCreate: commitResolvedMutation,

  detail: (id: string) => http.get<SkillRunVO>(`/api/skill-runs/${id}`),

  list: (query: SkillRunQuery = {}) =>
    http.get<PageData<SkillRunVO>>("/api/skill-runs", toParams(query)),

  action: (id: string, dto: SkillRunActionDTO) =>
    http.post<SkillRunVO>(`/api/skill-runs/${id}/actions`, dto),

  actionIdempotent: (id: string, dto: SkillRunActionInput, scope = `action:${id}`) =>
    idempotentMutation(
      scope,
      `skill-${dto.action}`,
      dto,
      (prepared: SkillRunActionDTO) => http.post<SkillRunVO>(`/api/skill-runs/${id}/actions`, prepared),
      false,
      dto.action !== "cancel",
    ),

  listActive: (query: Omit<SkillRunQuery, "active"> = {}) =>
    http.get<PageData<SkillRunVO>>("/api/skill-runs", toParams({ ...query, active: true })),
};
