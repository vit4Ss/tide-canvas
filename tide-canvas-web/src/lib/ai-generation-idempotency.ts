import { http } from "@/lib/http";
import type { Result } from "@/types/api";
import type { AiGenerateDTO, AiGenerateInput, AiTaskVO } from "@/types/ai";

interface PendingGeneration {
  clientRequestId: string;
  fingerprint: string;
  updatedAt: number;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const pendingMemory = new Map<string, PendingGeneration[]>();

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

function storageKey(scope: string): string {
  return `tidecanvas.ai-generate.pending.${encodeURIComponent(scope).slice(0, 180)}`;
}

function validPending(value: unknown): value is PendingGeneration {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingGeneration>;
  return typeof row.clientRequestId === "string" &&
    typeof row.fingerprint === "string" &&
    typeof row.updatedAt === "number" &&
    Number.isFinite(row.updatedAt) &&
    Date.now() - row.updatedAt < PENDING_TTL_MS;
}

function readPending(scope: string): PendingGeneration[] {
  const merged = new Map<string, PendingGeneration>();
  for (const row of pendingMemory.get(scope) ?? []) {
    if (validPending(row)) merged.set(row.fingerprint, row);
  }
  if (typeof window === "undefined") return [...merged.values()];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(scope)) || "null");
    // Migrate the former single-record format while allowing unrelated
    // in-flight payloads on the same surface to keep independent request IDs.
    const stored = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    for (const value of stored) {
      if (!validPending(value)) continue;
      const previous = merged.get(value.fingerprint);
      if (!previous || value.updatedAt >= previous.updatedAt) merged.set(value.fingerprint, value);
    }
  } catch {
    // Storage can be blocked in private/embedded contexts; memory still guards
    // repeated attempts in the current tab.
  }
  const rows = [...merged.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(-40);
  pendingMemory.set(scope, rows);
  return rows;
}

function writePending(scope: string, rows: readonly PendingGeneration[]): void {
  const normalized = rows.filter(validPending).sort((a, b) => a.updatedAt - b.updatedAt).slice(-40);
  if (normalized.length) pendingMemory.set(scope, normalized);
  else pendingMemory.delete(scope);
  if (typeof window === "undefined") return;
  try {
    if (normalized.length) localStorage.setItem(storageKey(scope), JSON.stringify(normalized));
    else localStorage.removeItem(storageKey(scope));
  } catch {
    // Current-tab fallback remains available.
  }
}

async function withScopeLock<T>(scope: string, work: () => T | Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`tidecanvas.ai-generate:${encodeURIComponent(scope).slice(0, 160)}`, work);
  }
  return work();
}

function definitive(result: Result<unknown>): boolean {
  return result.success || (result.code >= 400 && result.code < 500 && result.code !== 408 && result.code !== 429);
}

/**
 * Persist and reuse the same request id while a task-create response is
 * ambiguous. A retry after a lost response therefore resolves the original
 * task instead of creating and charging for a duplicate. Successful and
 * definitive client-error responses retire the key so an intentional later
 * generation with the same inputs remains a new task.
 */
export async function generateAiTaskIdempotent(
  input: AiGenerateInput,
  scope: string,
): Promise<Result<AiTaskVO>> {
  const { clientRequestId: requestedId, ...payload } = input;
  const payloadFingerprint = await fingerprint(payload);
  const pending = await withScopeLock(scope, () => {
    const rows = readPending(scope);
    const previous = rows.find((row) => row.fingerprint === payloadFingerprint);
    const next: PendingGeneration =
      previous
        ? { ...previous, updatedAt: Date.now() }
        : {
            clientRequestId: requestedId?.trim() || requestId(),
            fingerprint: payloadFingerprint,
            updatedAt: Date.now(),
          };
    writePending(scope, [...rows.filter((row) => row.fingerprint !== payloadFingerprint), next]);
    return next;
  });

  const dto: AiGenerateDTO = { ...payload, clientRequestId: pending.clientRequestId };
  const result = await http.post<AiTaskVO>("/api/ai/generate", dto);
  if (definitive(result)) {
    await withScopeLock(scope, () => {
      const rows = readPending(scope);
      const latest = rows.find((row) => row.fingerprint === pending.fingerprint);
      if (
        latest?.fingerprint === pending.fingerprint &&
        latest.clientRequestId === pending.clientRequestId
      ) {
        writePending(scope, rows.filter((row) => row.fingerprint !== pending.fingerprint));
      }
    });
  }
  return result;
}
