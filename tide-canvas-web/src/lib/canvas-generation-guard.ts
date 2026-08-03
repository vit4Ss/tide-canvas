/**
 * Minimal persisted generation state used to arbitrate asynchronous writes.
 * Keeping this helper independent from React/store code makes the rule easy to
 * test: a provider result may only mutate the exact generation that created it.
 */
export interface CanvasGenerationState {
  status?: string;
  taskId?: string;
  pendingGeneration?: { clientRequestId?: string };
  uploading?: boolean;
}

const PENDING_PREFIX = "pending:";

export function pendingGenerationIdentity(clientRequestId: string): string {
  return `${PENDING_PREFIX}${clientRequestId}`;
}

export function matchesCanvasGeneration(
  node: CanvasGenerationState | undefined,
  identity: string,
): boolean {
  if (!node || node.status !== "generating") return false;
  if (identity.startsWith(PENDING_PREFIX)) {
    return node.pendingGeneration?.clientRequestId === identity.slice(PENDING_PREFIX.length);
  }
  return node.taskId === identity;
}

/** Manual media replacement is destructive, so never admit it while a paid
 * generation is active or still recoverable. `uploading` also serializes two
 * file-picker attempts and prevents generation from starting mid-upload. */
export function canReplaceCanvasMedia(node: CanvasGenerationState | undefined): boolean {
  return canCommitCanvasMediaUpload(node) && !node?.uploading;
}

/** The upload owns `uploading:true`, but a generation starting through another
 * surface must still invalidate its eventual write before it reaches the node. */
export function canCommitCanvasMediaUpload(node: CanvasGenerationState | undefined): boolean {
  return !!node
    && node.status !== "generating"
    && !node.taskId
    && !node.pendingGeneration;
}
