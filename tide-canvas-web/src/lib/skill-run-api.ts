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
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
// Once the server has accepted a run, the journal is a recovery pointer rather
// than a transient request retry. Keep it long enough to survive an extended
// offline/save failure without silently losing a terminal canvas result.
const RESOLVED_CREATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
    (row.resultId === undefined || typeof row.resultId === "string");
}

function readPending(scope: string): PendingMutation[] {
  const merged = new Map<string, PendingMutation>();
  for (const row of pendingMemory.get(scope) ?? []) {
    if (validPending(row)) merged.set(row.fingerprint, row);
  }
  if (typeof window === "undefined") return [...merged.values()];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pendingStorageKey(scope)) || "null");
    // Migrate the former single-record format and accept the current bounded list.
    const stored = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    for (const value of stored) {
      if (!validPending(value)) continue;
      const previous = merged.get(value.fingerprint);
      if (!previous || value.updatedAt >= previous.updatedAt) merged.set(value.fingerprint, value);
    }
  } catch {
    // Blocked storage falls back to the current-tab map.
  }
  const rows = [...merged.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(-40);
  pendingMemory.set(scope, rows);
  return rows;
}

function writePending(scope: string, rows: readonly PendingMutation[]): void {
  const normalized = rows.filter(validPending).sort((a, b) => a.updatedAt - b.updatedAt).slice(-40);
  if (normalized.length) pendingMemory.set(scope, normalized);
  else pendingMemory.delete(scope);
  if (typeof window === "undefined") return;
  try {
    if (normalized.length) localStorage.setItem(pendingStorageKey(scope), JSON.stringify(normalized));
    else localStorage.removeItem(pendingStorageKey(scope));
  } catch {
    // Current-tab idempotency still works when storage is unavailable.
  }
}

async function withPendingLock<T>(scope: string, work: () => T | Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`tidecanvas.skill-run:${encodeURIComponent(scope).slice(0, 160)}`, work);
  }
  return work();
}

function isDefinitiveResponse(result: Result<unknown>): boolean {
  return result.success || (result.code >= 400 && result.code < 500 && result.code !== 408 && result.code !== 429);
}

type PreparedMutation<TPayload extends { clientRequestId?: string }> =
  Omit<TPayload, "clientRequestId"> & { clientRequestId: string };

async function idempotentMutation<TPayload extends { clientRequestId?: string }, TResult>(
  scope: string,
  prefix: string,
  payload: TPayload,
  send: (prepared: PreparedMutation<TPayload>) => Promise<Result<TResult>>,
  retainResolved: boolean,
): Promise<Result<TResult>> {
  const { clientRequestId: _ignored, ...fingerprintPayload } = payload;
  void _ignored;
  const fingerprint = await mutationFingerprint(fingerprintPayload);
  const pending = await withPendingLock(scope, () => {
    const rows = readPending(scope);
    const previous = rows.find((row) => row.fingerprint === fingerprint);
    const reserved: PendingMutation = previous
      ? { ...previous, updatedAt: Date.now() }
      : {
          id: payload.clientRequestId?.trim() || requestId(prefix),
          fingerprint,
          updatedAt: Date.now(),
        };
    writePending(scope, [...rows.filter((row) => row.fingerprint !== fingerprint), reserved]);
    return reserved;
  });
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
          { ...latest, resultId, updatedAt: Date.now() },
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
    ),

  resolvedCreateIds: resolvedMutationIds,

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
    ),

  listActive: (query: Omit<SkillRunQuery, "active"> = {}) =>
    http.get<PageData<SkillRunVO>>("/api/skill-runs", toParams({ ...query, active: true })),
};
