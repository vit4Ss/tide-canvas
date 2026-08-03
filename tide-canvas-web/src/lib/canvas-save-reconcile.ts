export interface CanvasSaveSnapshot {
  revision: number;
  canvasData: string;
  thumbnail?: string;
}

export interface CanvasSaveAttempt {
  expectedRevision: number;
  canvasData: string;
  /** Undefined means this attempt did not write the thumbnail field. */
  thumbnail?: string;
}

export type CanvasSaveReconciliation =
  | { kind: "acknowledged"; revision: number }
  | { kind: "retry" }
  | { kind: "conflict" };

/**
 * Reconcile an ambiguous whole-canvas PUT against the authoritative snapshot.
 *
 * A higher revision is safe to adopt only when every field written by this
 * attempt is already present remotely. Otherwise another editor won the CAS.
 * Equal/lower/missing revisions do not prove a conflict and must remain
 * retryable instead of permanently disabling autosave.
 */
export function reconcileCanvasSave(
  attempt: CanvasSaveAttempt,
  remote: CanvasSaveSnapshot | undefined,
): CanvasSaveReconciliation {
  if (!remote || !Number.isSafeInteger(remote.revision) || remote.revision < 0) {
    return { kind: "retry" };
  }
  if (remote.revision <= attempt.expectedRevision) {
    return { kind: "retry" };
  }

  const canvasMatches = remote.canvasData === attempt.canvasData;
  const thumbnailMatches = attempt.thumbnail === undefined
    || remote.thumbnail === attempt.thumbnail;
  if (canvasMatches && thumbnailMatches) {
    return { kind: "acknowledged", revision: remote.revision };
  }
  return { kind: "conflict" };
}

export type CanvasSaveFollowUp = "none" | "immediate" | "delayed";

/** Keep the orchestration rule testable: acknowledged saves immediately flush
 * edits queued while the request was in flight; unresolved attempts back off. */
export function nextCanvasSaveFollowUp(
  reconciliation: CanvasSaveReconciliation,
  hasQueuedSave: boolean,
  retryAutomatically = true,
): CanvasSaveFollowUp {
  if (reconciliation.kind === "conflict") return "none";
  if (reconciliation.kind === "retry") return retryAutomatically ? "delayed" : "none";
  return hasQueuedSave ? "immediate" : "none";
}

/** Codes for which the caller cannot prove that a write/read did not happen. */
export function isTransientCanvasSaveCode(code: number): boolean {
  return code === 0 || code === 408 || code === 409 || code === 429 || code >= 500;
}
