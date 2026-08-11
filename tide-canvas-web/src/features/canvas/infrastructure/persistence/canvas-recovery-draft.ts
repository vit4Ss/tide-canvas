const RECOVERY_DRAFT_VERSION = 1;
const RECOVERY_DRAFT_PREFIX = "tide-canvas:recovery-draft:v1:";
const RECOVERY_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface CanvasRecoverySnapshot {
  expectedRevision: number;
  canvasData: string;
  thumbnail?: string;
}

interface CanvasRecoveryDraft {
  version: typeof RECOVERY_DRAFT_VERSION;
  projectId: string;
  userId: string;
  baseRevision: number;
  canvasData: string;
  thumbnail?: string;
  updatedAt: number;
  /**
   * 当前草稿在较早快照保存期间产生时，记录那个在途快照。刷新后若服务端
   * 恰好只提交了它，就能安全地把草稿 revision 前移并继续保存。
   */
  predecessor?: CanvasRecoverySnapshot;
}

export interface CanvasRecoveryRemoteSnapshot {
  revision: number;
  canvasData: string;
  thumbnail?: string;
}

export type CanvasRecoveryResolution =
  | { kind: "remote"; canvasData: string; revision: number }
  | { kind: "recovered"; canvasData: string; revision: number }
  | { kind: "conflict"; canvasData: string; revision: number };

interface StageCanvasRecoveryDraftOptions extends CanvasRecoverySnapshot {
  projectId: string;
  userId?: string | null;
  predecessor?: CanvasRecoverySnapshot | null;
}

interface AcknowledgeCanvasRecoveryDraftOptions {
  projectId: string;
  userId?: string | null;
  snapshot: CanvasRecoverySnapshot;
  revision: number;
}

function recoveryDraftKey(projectId: string): string {
  return `${RECOVERY_DRAFT_PREFIX}${projectId}`;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecoverySnapshot(value: unknown): value is CanvasRecoverySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<CanvasRecoverySnapshot>;
  return isNonNegativeInteger(snapshot.expectedRevision)
    && typeof snapshot.canvasData === "string"
    && (snapshot.thumbnail === undefined || typeof snapshot.thumbnail === "string");
}

function isRecoveryDraft(value: unknown): value is CanvasRecoveryDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CanvasRecoveryDraft>;
  return draft.version === RECOVERY_DRAFT_VERSION
    && typeof draft.projectId === "string"
    && typeof draft.userId === "string"
    && isNonNegativeInteger(draft.baseRevision)
    && typeof draft.canvasData === "string"
    && (draft.thumbnail === undefined || typeof draft.thumbnail === "string")
    && typeof draft.updatedAt === "number"
    && Number.isFinite(draft.updatedAt)
    && (draft.predecessor === undefined || isRecoverySnapshot(draft.predecessor));
}

function readStoredDraft(projectId: string): CanvasRecoveryDraft | null {
  if (typeof window === "undefined") return null;
  const key = recoveryDraftKey(projectId);
  try {
    const serialized = window.sessionStorage.getItem(key);
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecoveryDraft(parsed) || parsed.projectId !== projectId) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - parsed.updatedAt > RECOVERY_DRAFT_MAX_AGE_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredDraft(draft: CanvasRecoveryDraft): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(recoveryDraftKey(draft.projectId), JSON.stringify(draft));
    return true;
  } catch {
    // Safari 隐私模式或配额不足时可能拒绝写入；调用方仍会继续后端保存。
    return false;
  }
}

function snapshotMatches(
  left: CanvasRecoverySnapshot,
  right: CanvasRecoverySnapshot,
): boolean {
  return left.expectedRevision === right.expectedRevision
    && left.canvasData === right.canvasData
    && left.thumbnail === right.thumbnail;
}

function snapshotMatchesRemote(
  snapshot: Pick<CanvasRecoveryDraft, "canvasData" | "thumbnail">,
  remote: CanvasRecoveryRemoteSnapshot,
): boolean {
  return snapshot.canvasData === remote.canvasData
    && (snapshot.thumbnail === undefined || snapshot.thumbnail === remote.thumbnail);
}

/** 同步写入 sessionStorage，确保结果展示后的立即刷新仍有可恢复快照。 */
export function stageCanvasRecoveryDraft({
  projectId,
  userId,
  expectedRevision,
  canvasData,
  thumbnail,
  predecessor,
}: StageCanvasRecoveryDraftOptions): boolean {
  if (!projectId || !userId || !isNonNegativeInteger(expectedRevision)) return false;
  const current: CanvasRecoverySnapshot = { expectedRevision, canvasData, thumbnail };
  const safePredecessor = predecessor && !snapshotMatches(predecessor, current)
    ? predecessor
    : undefined;
  return writeStoredDraft({
    version: RECOVERY_DRAFT_VERSION,
    projectId,
    userId: String(userId),
    baseRevision: expectedRevision,
    canvasData,
    ...(thumbnail ? { thumbnail } : {}),
    updatedAt: Date.now(),
    ...(safePredecessor ? { predecessor: safePredecessor } : {}),
  });
}

/**
 * 仅清除已被服务端确认的同一快照。较旧请求返回时，不能误删在它之后产生的
 * 生成结果；若它正是 predecessor，则只推进草稿的 baseRevision。
 */
export function acknowledgeCanvasRecoveryDraft({
  projectId,
  userId,
  snapshot,
  revision,
}: AcknowledgeCanvasRecoveryDraftOptions): void {
  if (!userId || !isNonNegativeInteger(revision)) return;
  const draft = readStoredDraft(projectId);
  if (!draft || draft.userId !== String(userId)) return;
  const draftSnapshot: CanvasRecoverySnapshot = {
    expectedRevision: draft.baseRevision,
    canvasData: draft.canvasData,
    thumbnail: draft.thumbnail,
  };
  if (snapshotMatches(draftSnapshot, snapshot)) {
    clearCanvasRecoveryDraft(projectId, userId);
    return;
  }
  if (
    draft.predecessor
    && snapshotMatches(draft.predecessor, snapshot)
    && revision > snapshot.expectedRevision
  ) {
    writeStoredDraft({
      ...draft,
      baseRevision: revision,
      updatedAt: Date.now(),
      predecessor: undefined,
    });
  }
}

export function clearCanvasRecoveryDraft(projectId: string, userId?: string | null): void {
  if (typeof window === "undefined" || !projectId || !userId) return;
  const draft = readStoredDraft(projectId);
  if (!draft || draft.userId !== String(userId)) return;
  try {
    window.sessionStorage.removeItem(recoveryDraftKey(projectId));
  } catch {
    // 清理失败不会影响权威服务端快照，下次读取时仍会再次核对并清理。
  }
}

/**
 * 将服务端快照与同标签页恢复草稿对账。只在 revision 未前进，或前进内容
 * 明确等于 predecessor 时自动恢复；其它情况保留草稿并交给现有冲突保护。
 */
export function resolveCanvasRecoveryDraft(
  projectId: string,
  userId: string | null | undefined,
  remote: CanvasRecoveryRemoteSnapshot,
): CanvasRecoveryResolution {
  if (!userId) return { kind: "remote", canvasData: remote.canvasData, revision: remote.revision };
  const draft = readStoredDraft(projectId);
  if (!draft || draft.userId !== String(userId)) {
    return { kind: "remote", canvasData: remote.canvasData, revision: remote.revision };
  }

  if (snapshotMatchesRemote(draft, remote)) {
    clearCanvasRecoveryDraft(projectId, userId);
    return { kind: "remote", canvasData: remote.canvasData, revision: remote.revision };
  }

  if (remote.revision === draft.baseRevision) {
    return { kind: "recovered", canvasData: draft.canvasData, revision: remote.revision };
  }

  if (
    draft.predecessor
    && remote.revision > draft.predecessor.expectedRevision
    && snapshotMatchesRemote(draft.predecessor, remote)
  ) {
    writeStoredDraft({
      ...draft,
      baseRevision: remote.revision,
      updatedAt: Date.now(),
      predecessor: undefined,
    });
    return { kind: "recovered", canvasData: draft.canvasData, revision: remote.revision };
  }

  return { kind: "conflict", canvasData: draft.canvasData, revision: remote.revision };
}

export function hasCanvasRecoveryDraft(
  projectId: string,
  userId?: string | null,
): boolean {
  if (!userId) return false;
  return readStoredDraft(projectId)?.userId === String(userId);
}
