import { http } from "@/lib/http";
import type { Result } from "@/types/api";
import type { AiGenerateDTO, AiGenerateInput, AiTaskVO } from "@/types/ai";

export interface PendingAiGeneration {
  clientRequestId: string;
  fingerprint: string;
  updatedAt: number;
  /** Account that owns this recovery pointer. Paid surfaces always set it. */
  ownerUserId?: string;
  /** Frozen request used to replay the same accepted/ambiguous create. */
  payload?: Omit<AiGenerateDTO, "clientRequestId">;
  /** Present after the server has accepted the create. */
  taskId?: string;
  /** Surface-owned state needed to rebuild its in-progress UI after reload. */
  recovery?: unknown;
  /** Reserves enough quota for taskId so the accepted write cannot grow the row. */
  storagePadding?: string;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const ACCEPTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TASK_ID_STORAGE_PADDING = "0".repeat(64);
const pendingMemory = new Map<string, PendingAiGeneration[]>();

export interface AiGenerationJournalOptions {
  /** Block the paid POST unless the frozen request is durably readable. */
  requireDurableJournal?: boolean;
  /** Keep the accepted task until the surface confirms its own recovery path. */
  retainAccepted?: boolean;
  /** Opaque, JSON-serializable surface state used only for reload recovery. */
  recovery?: unknown;
  /** Confirmed account id. Required whenever requireDurableJournal is enabled. */
  ownerUserId?: string;
}

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

async function fingerprint(value: unknown): Promise<string> {
  const serialized = stableJSON(value);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function requestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ai-${crypto.randomUUID()}`;
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizedOwnerUserId(ownerUserId?: string): string {
  return ownerUserId?.trim() ?? "";
}

/** The logical surface scope is namespaced by the authenticated account before
 * it reaches either localStorage, the in-memory fallback, or Web Locks. */
export function aiGenerationJournalPartition(scope: string, ownerUserId?: string): string {
  const owner = normalizedOwnerUserId(ownerUserId);
  return owner ? `user:${owner}:${scope}` : scope;
}

function storageKey(scope: string, ownerUserId?: string): string {
  const partition = aiGenerationJournalPartition(scope, ownerUserId);
  return `tidecanvas.ai-generate.pending.${encodeURIComponent(partition).slice(0, 220)}`;
}

function validPending(value: unknown, ownerUserId?: string): value is PendingAiGeneration {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingAiGeneration>;
  const owner = normalizedOwnerUserId(ownerUserId);
  return typeof row.clientRequestId === "string" &&
    typeof row.fingerprint === "string" &&
    typeof row.updatedAt === "number" &&
    Number.isFinite(row.updatedAt) &&
    Date.now() - row.updatedAt < (row.taskId ? ACCEPTED_TTL_MS : PENDING_TTL_MS) &&
    (owner ? row.ownerUserId === owner : row.ownerUserId === undefined) &&
    (row.taskId === undefined || typeof row.taskId === "string") &&
    (row.payload === undefined || (!!row.payload && typeof row.payload === "object"));
}

function memoryPending(scope: string, ownerUserId?: string): PendingAiGeneration[] {
  const partition = aiGenerationJournalPartition(scope, ownerUserId);
  return (pendingMemory.get(partition) ?? []).filter((row) => validPending(row, ownerUserId));
}

function readPending(scope: string, ownerUserId?: string): PendingAiGeneration[] {
  const partition = aiGenerationJournalPartition(scope, ownerUserId);
  const fallback = memoryPending(scope, ownerUserId);
  if (typeof window === "undefined") return fallback;
  try {
    // A readable localStorage partition is the cross-tab authority. Merging a
    // tab's stale memory here would resurrect rows another tab already removed.
    const raw = localStorage.getItem(storageKey(scope, ownerUserId));
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw || "null");
    } catch {
      // Corrupt persisted data is authoritative as empty; it must not revive an
      // older in-memory row. A later paid preflight will rewrite a valid row.
      parsed = null;
    }
    // Migrate the former single-record format while allowing unrelated
    // in-flight payloads on the same surface to keep independent request IDs.
    const stored = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const merged = new Map<string, PendingAiGeneration>();
    for (const value of stored) {
      if (!validPending(value, ownerUserId)) continue;
      const previous = merged.get(value.fingerprint);
      if (!previous || value.updatedAt >= previous.updatedAt) merged.set(value.fingerprint, value);
    }
    const rows = [...merged.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(-40);
    if (rows.length) pendingMemory.set(partition, rows);
    else pendingMemory.delete(partition);
    return rows;
  } catch {
    // Only an unavailable storage read may fall back to current-tab memory.
    return fallback;
  }
}

function writePending(
  scope: string,
  rows: readonly PendingAiGeneration[],
  ownerUserId?: string,
): boolean {
  const partition = aiGenerationJournalPartition(scope, ownerUserId);
  const normalized = rows
    .filter((row) => validPending(row, ownerUserId))
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-40);
  if (normalized.length) pendingMemory.set(partition, normalized);
  else pendingMemory.delete(partition);
  if (typeof window === "undefined") return false;
  try {
    if (normalized.length) localStorage.setItem(storageKey(scope, ownerUserId), JSON.stringify(normalized));
    else localStorage.removeItem(storageKey(scope, ownerUserId));
    const raw = localStorage.getItem(storageKey(scope, ownerUserId));
    if (!normalized.length) return raw === null;
    const parsed: unknown = JSON.parse(raw || "null");
    return Array.isArray(parsed) && normalized.every((expected) =>
      parsed.some((value) => validPending(value, ownerUserId) && stableJSON(value) === stableJSON(expected)),
    );
  } catch {
    // Current-tab fallback remains available.
    return false;
  }
}

async function withScopeLock<T>(
  scope: string,
  ownerUserId: string | undefined,
  work: () => T | Promise<T>,
): Promise<T> {
  const partition = aiGenerationJournalPartition(scope, ownerUserId);
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`tidecanvas.ai-generate:${encodeURIComponent(partition).slice(0, 200)}`, work);
  }
  return work();
}

export function isAmbiguousAiCreateCode(code: number): boolean {
  return code === 0
    || code === 401
    || code === 408
    || code === 429
    || (code >= 500 && code <= 599);
}

function definitive(result: Result<unknown>): boolean {
  // 2xxx/3xxx are this API's explicit business rejections (insufficient
  // points, model unavailable, invalid file, ...), not HTTP server failures.
  // Retaining/retrying those journals would lock the UI forever.
  return result.success || !isAmbiguousAiCreateCode(result.code);
}

function journalUnavailableResult(): Result<AiTaskVO> {
  return {
    success: false,
    code: 409,
    message: "当前浏览器无法安全保存生成任务状态，请更新浏览器或开启本地存储后重试（任务尚未启动）",
    data: undefined as unknown as AiTaskVO,
    timestamp: Date.now(),
  };
}

/** Recoverable creates for one surface, including ambiguous requests without taskId. */
export function recoverableAiGenerations(
  scope: string,
  ownerUserId?: string,
): PendingAiGeneration[] {
  return readPending(scope, ownerUserId).map((row) => ({ ...row }));
}

/** Retire an accepted journal only after the caller has another durable recovery path. */
export async function commitAcceptedAiGeneration(
  scope: string,
  taskId: string,
  ownerUserId?: string,
): Promise<void> {
  const clean = taskId.trim();
  if (!clean) return;
  await withScopeLock(scope, ownerUserId, () => {
    const rows = readPending(scope, ownerUserId);
    writePending(scope, rows.filter((row) => row.taskId !== clean), ownerUserId);
  });
}

/**
 * Persist and reuse the same request id while a task-create response is
 * ambiguous. A retry after a lost response therefore resolves the original
 * task instead of creating and charging for a duplicate. Definitive rejections
 * retire the key. Surfaces that request accepted-task retention explicitly
 * commit it only after terminal state or another verified recovery pointer.
 */
export async function generateAiTaskIdempotent(
  input: AiGenerateInput,
  scope: string,
  options: AiGenerationJournalOptions = {},
): Promise<Result<AiTaskVO>> {
  const ownerUserId = normalizedOwnerUserId(options.ownerUserId);
  if (
    options.requireDurableJournal &&
    (!ownerUserId || typeof navigator === "undefined" || !navigator.locks)
  ) {
    return journalUnavailableResult();
  }
  const { clientRequestId: requestedId, ...payload } = input;
  const explicitRequestId = requestedId?.trim();
  const payloadFingerprint = await fingerprint(payload);
  // Explicit request IDs identify distinct user clicks even when the prompt and
  // model are identical. Keeping them in separate journal rows allows true
  // concurrent submissions while retries of either click remain exactly-once.
  const journalFingerprint = explicitRequestId
    ? `${payloadFingerprint}:${explicitRequestId}`
    : payloadFingerprint;
  const prepared = await withScopeLock(scope, ownerUserId || undefined, () => {
    const rows = readPending(scope, ownerUserId || undefined);
    const previous = rows.find((row) => row.fingerprint === journalFingerprint);
    const next: PendingAiGeneration =
      // Recovery callers persist their own request id beside the frozen DTO.
      // That persisted id is authoritative: an older, same-payload browser
      // journal must never substitute another task and attach its result to the
      // recovering node. Implicit callers still reuse the local journal.
      previous && (!explicitRequestId || previous.clientRequestId === explicitRequestId)
        ? {
            ...previous,
            payload,
            recovery: previous.recovery ?? options.recovery,
            updatedAt: Date.now(),
            ...(!previous.taskId ? { storagePadding: TASK_ID_STORAGE_PADDING } : {}),
          }
        : {
            clientRequestId: explicitRequestId || requestId(),
            fingerprint: journalFingerprint,
            updatedAt: Date.now(),
            ...(ownerUserId ? { ownerUserId } : {}),
            payload,
            recovery: options.recovery,
            storagePadding: TASK_ID_STORAGE_PADDING,
          };
    const durable = writePending(
      scope,
      [...rows.filter((row) => row.fingerprint !== journalFingerprint), next],
      ownerUserId || undefined,
    );
    return { pending: next, durable };
  });
  if (options.requireDurableJournal && !prepared.durable) return journalUnavailableResult();
  const pending = prepared.pending;

  const dto: AiGenerateDTO = { ...payload, clientRequestId: pending.clientRequestId };
  const result = await http.post<AiTaskVO>("/api/ai/generate", dto);
  if (definitive(result)) {
    await withScopeLock(scope, ownerUserId || undefined, () => {
      const rows = readPending(scope, ownerUserId || undefined);
      const latest = rows.find((row) => row.fingerprint === pending.fingerprint);
      if (
        latest?.fingerprint === pending.fingerprint &&
        latest.clientRequestId === pending.clientRequestId
      ) {
        if (result.success && result.data?.id && options.retainAccepted) {
          // If this verified write ever fails, memory still retains both the
          // original request id and task id. Because the preflight row reserved
          // more bytes than taskId consumes, ordinary quota exhaustion cannot
          // create a response→accepted-journal gap.
          writePending(scope, [
            ...rows.filter((row) => row.fingerprint !== pending.fingerprint),
            {
              ...latest,
              payload,
              recovery: latest.recovery ?? options.recovery,
              taskId: String(result.data.id),
              storagePadding: undefined,
              updatedAt: Date.now(),
            },
          ], ownerUserId || undefined);
        } else {
          writePending(
            scope,
            rows.filter((row) => row.fingerprint !== pending.fingerprint),
            ownerUserId || undefined,
          );
        }
      }
    });
  }
  return result;
}
