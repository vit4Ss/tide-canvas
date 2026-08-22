"use client";

/* ── send pipeline (extracted verbatim from page.tsx) ──────────────────────────
   选图片/视频/音频模型 → aiApi.generate 计费管线 → persistTurn 原子入库整轮；
   文本模型 → streamMessage SSE 流式。乐观气泡 / 回滚 / 送出中暂停轮询、
   activeIdRef 防切对话覆盖等语义全部保持原样。 */

import { useCallback, useEffect } from "react";
import { chatApi, streamMessage } from "@/lib/chat-api";
import { aiApi } from "@/lib/api";
import { getAccessToken } from "@/lib/http";
import {
  defaultSkillInputValues,
  parseSkillInputSchema,
  validateSkillRunInputValues,
} from "@/lib/skill-api";
import { skillRunApi } from "@/lib/skill-run-api";
import { toast } from "@/components/shared/toast";
import { useAuthStore } from "@/stores/use-auth-store";
import { buildMusicInput, validateMusicParams, type MusicParams } from "@/lib/music-modes";
import type { AiGenerateDTO } from "@/types/ai";
import type { StudioModelVO } from "@/lib/market-api";
import { skillKindOf, skillSupportsOutput, type SkillVO } from "@/types/skill";
import type { SkillRunInput } from "@/types/skill-run";
import type { ContextUsageVO, ConversationVO, MessageAttachment, MessageVO } from "@/types/chat";
import { musicTurnSummary, type RefItem, type RefPolicy } from "../_components/chat-utils";
import { arbitratePendingTurn, removePendingTurnIfOwned } from "./pending-turn-arbitration";
import { historySendTargetMatches, isHistorySendTarget } from "./history-send-target";

type ComposerRefSnapshot = Pick<RefItem, "key" | "kind" | "url" | "name">;

interface ComposerSnapshot {
  draft: string;
  refs: ComposerRefSnapshot[];
}

type PersistedMediaTurn = {
  prompt: string;
  params: Record<string, unknown>;
  taskId: string;
  contentType: "image" | "video" | "audio";
};

type PendingMediaTurnTemplate = Omit<PersistedMediaTurn, "taskId">;

interface PendingMediaTurn {
  ownerKey: string;
  conversationId: string;
  requestKey: string;
  /** Frozen paid request, written before the first task-create call. Older
   * journals may only have `turn` and remain recoverable. */
  generation?: AiGenerateDTO;
  turnTemplate?: PendingMediaTurnTemplate;
  turn?: PersistedMediaTurn;
  composer?: ComposerSnapshot;
  updatedAt: number;
}

interface TextTurnPayload {
  content: string;
  attachments: MessageAttachment[];
  model?: string;
  skillId?: string;
}

interface PendingTextTurn {
  ownerKey: string;
  conversationId: string;
  requestKey: string;
  clientRequestId: string;
  payload: TextTurnPayload;
  composer: ComposerSnapshot;
  updatedAt: number;
}

const PENDING_MEDIA_TURNS_KEY = "tidecanvas.chat.pending-media-turns.v1";
const PENDING_MEDIA_TURN_TTL = 24 * 60 * 60 * 1000;
let pendingMediaTurnsMemory: PendingMediaTurn[] = [];
const PENDING_TEXT_TURNS_KEY = "tidecanvas.chat.pending-text-turns.v1";
// The server's hard text lease is 12 minutes. Never capacity-evict a credential
// that could still belong to a live worker; after one day it is safe to rely on
// durable history reconciliation/refund. A long absolute retention plus a cap
// prevents deleted/never-reopened conversations from filling localStorage and
// permanently disabling every future send.
const PENDING_TEXT_TURN_PROTECTED_MS = 24 * 60 * 60 * 1000;
const PENDING_TEXT_TURN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_TEXT_TURN_MAX_ENTRIES = 64;
let pendingTextTurnsMemory: PendingTextTurn[] = [];
const PENDING_CHAT_TURNS_LOCK = "tidecanvas.chat-journal:pending-turns";

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

/** Compact deterministic key for matching a retry to the exact generation DTO. */
function mediaRequestKey(value: unknown): string {
  const source = stableJSON(value);
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `${source.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function chatRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `chat-${crypto.randomUUID()}`;
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build the complete tool input from the chat composer. Tool defaults stay
 * server-compatible, while a pasted public URL is promoted to the conventional
 * `url` parameter used by webpage-analysis skills. */
function chatToolRunInput(
  skill: SkillVO,
  prompt: string,
  refs: readonly RefItem[],
): SkillRunInput {
  const parameters = defaultSkillInputValues(skill.inputSchema, skill.defaultParams);
  const schema = parseSkillInputSchema(skill.inputSchema);
  const rawAssetTypes = schema?.["x-asset-types"];
  const assetTypes = new Set(
    Array.isArray(rawAssetTypes)
      ? rawAssetTypes.filter((value): value is RefItem["kind"] =>
          value === "image" || value === "video" || value === "audio" || value === "file",
        )
      : [],
  );
  if (schema?.properties?.url && parameters.url === undefined) {
    const match = prompt.match(/https?:\/\/[^\s<>{}\[\]"']+/i)?.[0];
    if (match) parameters.url = match.replace(/[),.;!?，。；！？]+$/, "");
  }
  return {
    prompt,
    assets: refs
      .filter((ref): ref is RefItem & { url: string } => !!ref.url && assetTypes.has(ref.kind))
      .map((ref) => ({
        type: ref.kind,
        url: ref.url,
        ...(ref.name ? { name: ref.name } : {}),
      })),
    sourceNodeIds: [],
    parameters,
  };
}

function validComposerSnapshot(value: unknown): value is ComposerSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ComposerSnapshot>;
  return typeof snapshot.draft === "string" &&
    Array.isArray(snapshot.refs) &&
    snapshot.refs.every((ref) =>
      !!ref && typeof ref === "object" &&
      typeof ref.key === "string" &&
      (ref.kind === "image" || ref.kind === "video" || ref.kind === "audio" || ref.kind === "file") &&
      (ref.url === undefined || typeof ref.url === "string") &&
      (ref.name === undefined || typeof ref.name === "string"),
    );
}

function validPendingMediaTurn(value: unknown): value is PendingMediaTurn {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingMediaTurn>;
  const turn = row.turn as Partial<PersistedMediaTurn> | undefined;
  const generation = row.generation as Partial<AiGenerateDTO> | undefined;
  const template = row.turnTemplate as Partial<PendingMediaTurnTemplate> | undefined;
  const generationRequestKey = generation
    ? mediaRequestKey(Object.fromEntries(
        Object.entries(generation).filter(([key]) => key !== "clientRequestId"),
      ))
    : "";
  const validTurn = !!turn &&
    typeof turn.prompt === "string" &&
    typeof turn.taskId === "string" &&
    (turn.contentType === "image" || turn.contentType === "video" || turn.contentType === "audio") &&
    !!turn.params && typeof turn.params === "object" && !Array.isArray(turn.params);
  const validIntent = !!generation &&
    typeof generation.handler === "string" &&
    typeof generation.modelId === "string" &&
    typeof generation.clientRequestId === "string" &&
    generation.clientRequestId.trim() === generation.clientRequestId &&
    generation.clientRequestId.length > 0 && generation.clientRequestId.length <= 96 &&
    !!generation.input && typeof generation.input === "object" && !Array.isArray(generation.input) &&
    row.requestKey === generationRequestKey &&
    !!template && typeof template.prompt === "string" &&
    (template.contentType === "image" || template.contentType === "video" || template.contentType === "audio") &&
    !!template.params && typeof template.params === "object" && !Array.isArray(template.params);
  return typeof row.ownerKey === "string" &&
    typeof row.conversationId === "string" &&
    typeof row.requestKey === "string" &&
    typeof row.updatedAt === "number" &&
    Date.now() - row.updatedAt < PENDING_MEDIA_TURN_TTL &&
    (validTurn || validIntent) &&
    (row.composer === undefined || validComposerSnapshot(row.composer));
}

function validPendingTextTurn(value: unknown): value is PendingTextTurn {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PendingTextTurn>;
  const payload = row.payload as Partial<TextTurnPayload> | undefined;
  return typeof row.ownerKey === "string" &&
    typeof row.conversationId === "string" &&
    typeof row.requestKey === "string" &&
    typeof row.clientRequestId === "string" &&
    row.clientRequestId.trim() === row.clientRequestId &&
    row.clientRequestId.length > 0 && row.clientRequestId.length <= 96 &&
    // A text request key is a financial recovery credential, not a cache.
    // Keep it until the durable assistant/refund state is observed; the server
    // now terminalizes expired worker leases even after a long absence.
    typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) && row.updatedAt > 0 &&
    Date.now() - row.updatedAt < PENDING_TEXT_TURN_MAX_AGE_MS &&
    !!payload && typeof payload.content === "string" &&
    Array.isArray(payload.attachments) &&
    payload.attachments.every((attachment) =>
      !!attachment && typeof attachment.url === "string" &&
      (attachment.kind === "image" || attachment.kind === "video" || attachment.kind === "audio" || attachment.kind === "file"),
    ) &&
    (payload.model === undefined || typeof payload.model === "string") &&
    (payload.skillId === undefined || typeof payload.skillId === "string") &&
    row.requestKey === mediaRequestKey(payload) &&
    validComposerSnapshot(row.composer);
}

function prunePendingTextTurns(rows: readonly PendingTextTurn[]): PendingTextTurn[] {
  const now = Date.now();
  const valid = rows.filter(validPendingTextTurn);
  const protectedRows = valid.filter((row) => now - row.updatedAt < PENDING_TEXT_TURN_PROTECTED_MS);
  const olderRows = valid
    .filter((row) => now - row.updatedAt >= PENDING_TEXT_TURN_PROTECTED_MS)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, PENDING_TEXT_TURN_MAX_ENTRIES - protectedRows.length));
  return [...protectedRows, ...olderRows].sort((left, right) => left.updatedAt - right.updatedAt);
}

function storedPendingMediaTurns(): PendingMediaTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_MEDIA_TURNS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(validPendingMediaTurn) : [];
  } catch {
    return [];
  }
}

function storedPendingTextTurns(): PendingTextTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_TEXT_TURNS_KEY) || "[]");
    return Array.isArray(parsed) ? prunePendingTextTurns(parsed) : [];
  } catch {
    return [];
  }
}

function readPendingMediaTurns(): PendingMediaTurn[] {
  const merged = new Map<string, PendingMediaTurn>();
  for (const row of pendingMediaTurnsMemory) {
    if (validPendingMediaTurn(row)) merged.set(`${row.ownerKey}:${row.conversationId}:${row.requestKey}`, row);
  }
  if (typeof window !== "undefined") {
    try {
      for (const value of storedPendingMediaTurns()) {
        const key = `${value.ownerKey}:${value.conversationId}:${value.requestKey}`;
        const previous = merged.get(key);
        if (!previous || value.updatedAt >= previous.updatedAt) merged.set(key, value);
      }
    } catch {
      // Private/embedded contexts may block storage; memory still protects the
      // current tab from generating and charging a duplicate task.
    }
  }
  pendingMediaTurnsMemory = [...merged.values()]
    .sort((a, b) => a.updatedAt - b.updatedAt);
  return pendingMediaTurnsMemory;
}

function writePendingMediaTurns(rows: readonly PendingMediaTurn[]): boolean {
  pendingMediaTurnsMemory = rows.filter(validPendingMediaTurn);
  if (typeof window === "undefined") return false;
  try {
    if (pendingMediaTurnsMemory.length) {
      localStorage.setItem(PENDING_MEDIA_TURNS_KEY, JSON.stringify(pendingMediaTurnsMemory));
    } else {
      localStorage.removeItem(PENDING_MEDIA_TURNS_KEY);
    }
    const stored = localStorage.getItem(PENDING_MEDIA_TURNS_KEY);
    if (!pendingMediaTurnsMemory.length) return stored === null;
    const parsed: unknown = JSON.parse(stored || "null");
    return Array.isArray(parsed) && pendingMediaTurnsMemory.every((expected) =>
      parsed.some((value) => validPendingMediaTurn(value) && stableJSON(value) === stableJSON(expected)),
    );
  } catch {
    // Keep the in-memory journal when storage is unavailable.
    return false;
  }
}

function readPendingTextTurns(): PendingTextTurn[] {
  const merged = new Map<string, PendingTextTurn>();
  for (const row of pendingTextTurnsMemory) {
    if (validPendingTextTurn(row)) merged.set(`${row.ownerKey}:${row.conversationId}:${row.requestKey}`, row);
  }
  if (typeof window !== "undefined") {
    try {
      for (const value of storedPendingTextTurns()) {
        const key = `${value.ownerKey}:${value.conversationId}:${value.requestKey}`;
        const previous = merged.get(key);
        if (!previous || value.updatedAt >= previous.updatedAt) merged.set(key, value);
      }
    } catch {
      // Same-tab memory still preserves the retry key when storage is blocked.
    }
  }
  pendingTextTurnsMemory = prunePendingTextTurns([...merged.values()]);
  return pendingTextTurnsMemory;
}

function writePendingTextTurns(rows: readonly PendingTextTurn[]): boolean {
  pendingTextTurnsMemory = prunePendingTextTurns(rows);
  if (typeof window === "undefined") return false;
  try {
    if (pendingTextTurnsMemory.length) {
      localStorage.setItem(PENDING_TEXT_TURNS_KEY, JSON.stringify(pendingTextTurnsMemory));
    } else {
      localStorage.removeItem(PENDING_TEXT_TURNS_KEY);
    }
    const stored = localStorage.getItem(PENDING_TEXT_TURNS_KEY);
    if (!pendingTextTurnsMemory.length) return stored === null;
    const parsed: unknown = JSON.parse(stored || "null");
    return Array.isArray(parsed) && pendingTextTurnsMemory.every((expected) =>
      parsed.some((value) => validPendingTextTurn(value) && stableJSON(value) === stableJSON(expected)),
    );
  } catch {
    // Keep the in-memory retry key for the lifetime of this tab.
    return false;
  }
}

function currentJournalOwnerKey(): string {
  const userId = useAuthStore.getState().user?.id;
  if (userId) return `user:${userId}`;
  // fetchUser may be temporarily unavailable while the still-valid access token
  // remains. The signed token's uid is stable across refresh rotations and is
  // safe to use only as a local partition key (authorization remains server-side).
  const token = getAccessToken();
  if (token && typeof atob === "function") {
    try {
      const payload = token.split(".")[1];
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const decoded = JSON.parse(atob(padded)) as { uid?: unknown };
      if (typeof decoded.uid === "string" || typeof decoded.uid === "number") {
        return `user:${String(decoded.uid)}`;
      }
    } catch {
      // Fall through to a credential fingerprint for non-JWT/custom sessions.
    }
  }
  // Store only a compact fingerprint, never the credential itself.
  return token ? `token:${mediaRequestKey(token)}` : "anonymous";
}

function pendingMediaTurnsForConversation(ownerKey: string, conversationId: string): PendingMediaTurn[] {
  return readPendingMediaTurns().filter(
    (row) => row.ownerKey === ownerKey && row.conversationId === conversationId,
  );
}

type PendingTurnEnvelope =
  | ({ kind: "media" } & Pick<PendingMediaTurn, "ownerKey" | "conversationId" | "requestKey"> & {
      value: PendingMediaTurn;
    })
  | ({ kind: "text" } & Pick<PendingTextTurn, "ownerKey" | "conversationId" | "requestKey"> & {
      value: PendingTextTurn;
    });

type JournalClaim<T> =
  | { status: "inserted"; row: T }
  | { status: "existing"; turn: PendingTurnEnvelope }
  | { status: "storage-failed" };

function pendingTurnEnvelopes(
  mediaRows: readonly PendingMediaTurn[],
  textRows: readonly PendingTextTurn[],
): PendingTurnEnvelope[] {
  return [
    ...mediaRows.map((value): PendingTurnEnvelope => ({
      kind: "media",
      ownerKey: value.ownerKey,
      conversationId: value.conversationId,
      requestKey: value.requestKey,
      value,
    })),
    ...textRows.map((value): PendingTurnEnvelope => ({
      kind: "text",
      ownerKey: value.ownerKey,
      conversationId: value.conversationId,
      requestKey: value.requestKey,
      value,
    })),
  ].sort((left, right) => left.value.updatedAt - right.value.updatedAt);
}

function mediaRequestPayload(row: PendingMediaTurn): unknown {
  if (!row.generation) return null;
  return Object.fromEntries(
    Object.entries(row.generation).filter(([key]) => key !== "clientRequestId"),
  );
}

function sameMediaIntent(left: PendingMediaTurn, right: PendingMediaTurn): boolean {
  return left.requestKey === right.requestKey &&
    stableJSON(mediaRequestPayload(left)) === stableJSON(mediaRequestPayload(right));
}

function sameTextIntent(left: PendingTextTurn, right: PendingTextTurn): boolean {
  return left.requestKey === right.requestKey && stableJSON(left.payload) === stableJSON(right.payload);
}

function sameMediaCredential(left: PendingMediaTurn, right: PendingMediaTurn): boolean {
  const leftCredential = left.generation?.clientRequestId
    ? `request:${left.generation.clientRequestId}`
    : left.turn?.taskId
      ? `task:${left.turn.taskId}`
      : "";
  const rightCredential = right.generation?.clientRequestId
    ? `request:${right.generation.clientRequestId}`
    : right.turn?.taskId
      ? `task:${right.turn.taskId}`
      : "";
  return !!leftCredential && leftCredential === rightCredential &&
    left.ownerKey === right.ownerKey && left.conversationId === right.conversationId &&
    left.requestKey === right.requestKey;
}

function sameTextCredential(left: PendingTextTurn, right: PendingTextTurn): boolean {
  return left.clientRequestId === right.clientRequestId &&
    left.ownerKey === right.ownerKey && left.conversationId === right.conversationId &&
    left.requestKey === right.requestKey;
}

function discardPendingMediaTurnFromMemory(expected: PendingMediaTurn): void {
  pendingMediaTurnsMemory = removePendingTurnIfOwned(
    pendingMediaTurnsMemory,
    expected,
    sameMediaCredential,
  );
}

function discardPendingTextTurnFromMemory(expected: PendingTextTurn): void {
  pendingTextTurnsMemory = removePendingTurnIfOwned(
    pendingTextTurnsMemory,
    expected,
    sameTextCredential,
  );
}

async function withJournalLock<T>(task: () => T | Promise<T>): Promise<T> {
  return navigator.locks.request(PENDING_CHAT_TURNS_LOCK, task);
}

function journalLocksAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.locks;
}

async function claimPendingMediaTurn(row: PendingMediaTurn): Promise<JournalClaim<PendingMediaTurn>> {
  if (!journalLocksAvailable()) return { status: "storage-failed" };
  return withJournalLock(() => {
    // Media and text share one lock and one conversation-level arbitration.
    // Re-reading both stores in the critical section makes create-if-absent
    // atomic across tabs and across output types.
    const mediaRows = storedPendingMediaTurns();
    const textRows = storedPendingTextTurns();
    const candidate: PendingTurnEnvelope = {
      kind: "media",
      ownerKey: row.ownerKey,
      conversationId: row.conversationId,
      requestKey: row.requestKey,
      value: row,
    };
    const decision = arbitratePendingTurn(pendingTurnEnvelopes(mediaRows, textRows), candidate);
    if (decision.status === "existing") return { status: "existing", turn: decision.turn };
    return writePendingMediaTurns([...mediaRows, row])
      ? { status: "inserted", row }
      : { status: "storage-failed" };
  });
}

async function updatePendingMediaTurn(row: PendingMediaTurn): Promise<boolean> {
  const update = (rows: PendingMediaTurn[]) => {
    const index = rows.findIndex((item) => sameMediaCredential(item, row));
    if (index < 0) return false;
    const next = rows.slice();
    next[index] = row;
    return writePendingMediaTurns(next);
  };
  return journalLocksAvailable()
    ? withJournalLock(() => update(storedPendingMediaTurns()))
    : update(readPendingMediaTurns());
}

async function forgetPendingMediaTurn(expected: PendingMediaTurn): Promise<void> {
  const remove = (rows: PendingMediaTurn[]) => {
    writePendingMediaTurns(removePendingTurnIfOwned(rows, expected, sameMediaCredential));
  };
  if (journalLocksAvailable()) await withJournalLock(() => remove(storedPendingMediaTurns()));
  else remove(readPendingMediaTurns());
}

function pendingTextTurnsForConversation(ownerKey: string, conversationId: string): PendingTextTurn[] {
  return readPendingTextTurns().filter(
    (row) => row.ownerKey === ownerKey && row.conversationId === conversationId,
  );
}

async function claimPendingTextTurn(row: PendingTextTurn): Promise<JournalClaim<PendingTextTurn>> {
  if (!journalLocksAvailable()) return { status: "storage-failed" };
  return withJournalLock(() => {
    const mediaRows = storedPendingMediaTurns();
    const textRows = storedPendingTextTurns();
    const candidate: PendingTurnEnvelope = {
      kind: "text",
      ownerKey: row.ownerKey,
      conversationId: row.conversationId,
      requestKey: row.requestKey,
      value: row,
    };
    const decision = arbitratePendingTurn(pendingTurnEnvelopes(mediaRows, textRows), candidate);
    if (decision.status === "existing") return { status: "existing", turn: decision.turn };
    const nextRows = prunePendingTextTurns([...textRows, row]);
    // Never evict a credential that can still be inside the server lease merely
    // to make room. Refuse an extremely high number of simultaneous unresolved
    // conversations before localStorage itself reaches quota.
    if (nextRows.length > PENDING_TEXT_TURN_MAX_ENTRIES) return { status: "storage-failed" };
    return writePendingTextTurns(nextRows)
      ? { status: "inserted", row }
      : { status: "storage-failed" };
  });
}

async function forgetPendingTextTurn(expected: PendingTextTurn): Promise<void> {
  const remove = (rows: PendingTextTurn[]) => {
    writePendingTextTurns(removePendingTurnIfOwned(rows, expected, sameTextCredential));
  };
  if (journalLocksAvailable()) await withJournalLock(() => remove(storedPendingTextTurns()));
  else remove(readPendingTextTurns());
}

/** A successful server deletion proves no paid turn is still unfinished (the
 * backend rejects deletion while a lease is live), so its local recovery rows
 * can be removed immediately instead of occupying the bounded journal forever. */
export async function clearPendingChatTurnsForConversation(conversationId: string): Promise<void> {
  const ownerKey = currentJournalOwnerKey();
  const remove = () => {
    writePendingMediaTurns(storedPendingMediaTurns().filter(
      (row) => row.ownerKey !== ownerKey || row.conversationId !== conversationId,
    ));
    writePendingTextTurns(storedPendingTextTurns().filter(
      (row) => row.ownerKey !== ownerKey || row.conversationId !== conversationId,
    ));
  };
  try {
    if (journalLocksAvailable()) await withJournalLock(remove);
    else remove();
  } catch {
    // Deletion itself is already durable. A later bounded-journal prune remains
    // the fallback when browser storage/locks are temporarily unavailable.
  }
}

function isAmbiguousFailure(code: number): boolean {
  // Result also uses 2001/2002/... for definitive business failures, so the
  // transport/server range must be bounded to real HTTP-like 5xx codes.
  return code === 0 || code === 401 || code === 408 || code === 429 || (code >= 500 && code < 600);
}

function isConversationBusy(code: number): boolean {
  return code === 409;
}

export function useSendMessage({
  draft,
  setDraft,
  busy,
  setBusy,
  setTyping,
  activeId,
  setActiveId,
  setConvos,
  setMsgs,
  loadMessages,
  ensureSession,
  selModel,
  mode,
  ratio,
  res,
  quality,
  dur,
  batch,
  refs,
  refPolicy,
  refOptional,
  clearRefsIfUnchanged,
  restoreRefsIfEmpty,
  forceBottom,
  scrollEnd,
  nearBottomRef,
  ctxUsage,
  refreshCtxUsage,
  music,
  isMusicSel,
  musicNoDraftOk,
  skill,
  toolSkill,
  setStreaming,
  chatAbortRef,
  activeIdRef,
  textRecovering,
  setTextRecovering,
}: {
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setTyping: React.Dispatch<React.SetStateAction<boolean>>;
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  setConvos: React.Dispatch<React.SetStateAction<ConversationVO[]>>;
  setMsgs: React.Dispatch<React.SetStateAction<MessageVO[]>>;
  loadMessages: (
    id: string,
    isVisible?: (records: readonly MessageVO[]) => boolean,
  ) => Promise<boolean>;
  ensureSession: () => Promise<boolean>;
  selModel: StudioModelVO | null;
  mode: string;
  ratio: string;
  res: string;
  quality: string;
  dur: string;
  batch: number;
  refs: RefItem[];
  refPolicy: RefPolicy | undefined;
  refOptional: boolean;
  clearRefsIfUnchanged: (snapshot: readonly ComposerRefSnapshot[]) => void;
  restoreRefsIfEmpty: (snapshot: readonly ComposerRefSnapshot[]) => void;
  forceBottom: () => void;
  scrollEnd: () => void;
  nearBottomRef: React.RefObject<boolean>;
  ctxUsage: ContextUsageVO | null;
  refreshCtxUsage: (id: string) => Promise<void>;
  music: MusicParams;
  isMusicSel: boolean;
  musicNoDraftOk: boolean;
  skill: SkillVO | null;
  toolSkill: SkillVO | null;
  setStreaming: React.Dispatch<React.SetStateAction<string | null>>;
  chatAbortRef: React.RefObject<AbortController | null>;
  activeIdRef: React.RefObject<string | null>;
  textRecovering: boolean;
  setTextRecovering: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // A media task can be created and billed even when the following /turn
  // response is lost. Recover these journals on mount/conversation switch, not
  // only when the user happens to send the exact same prompt again.
  useEffect(() => {
    if (!activeId || busy) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectNoticeShown = false;

    const recover = async () => {
      if (cancelled) return;
      let sessionReady = false;
      try {
        sessionReady = await ensureSession();
      } catch {
        if (!cancelled) retryTimer = setTimeout(recover, 5000);
        return;
      }
      if (!sessionReady) return;
      const ownerKey = currentJournalOwnerKey();
      const rows = pendingMediaTurnsForConversation(ownerKey, activeId);
      if (!rows.length) return;

      const recoveredRows: PendingMediaTurn[] = [];
      let shouldRetry = false;
      for (const row of rows) {
        if (cancelled) return;
        let recoveredRow = row;
        let turn = row.turn;
        if (!turn && row.generation && row.turnTemplate) {
          const generated = await aiApi.generateIdempotent(row.generation, `chat:${activeId}`);
          if (!generated.success || !generated.data?.id) {
            if (isAmbiguousFailure(generated.code)) {
              shouldRetry = true;
            } else {
              await forgetPendingMediaTurn(row);
              if (row.composer && activeIdRef.current === activeId) {
                setDraft((current) => current || row.composer?.draft || "");
                restoreRefsIfEmpty(row.composer.refs);
              }
              toast.error(generated.message || "上次生成请求失败");
            }
            continue;
          }
          turn = { ...row.turnTemplate, taskId: String(generated.data.id) };
          recoveredRow = { ...row, turn, updatedAt: Date.now() };
          // The pre-charge intent remains durable if this update cannot be
          // confirmed; replaying it uses the same generation clientRequestId.
          await updatePendingMediaTurn(recoveredRow);
        }
        if (!turn) {
          shouldRetry = true;
          continue;
        }
        const result = await chatApi.persistTurn(activeId, turn);
        if (result.success) {
          // Keep the journal until the durable turn has also been reloaded into
          // the UI. If the user starts a send meanwhile, that send still sees
          // the task and reuses it instead of generating a duplicate.
          recoveredRows.push(recoveredRow);
        } else if (result.code === 403 || result.code === 404) {
          // The current account definitively cannot attach this task.
          await forgetPendingMediaTurn(row);
        } else if (isAmbiguousFailure(result.code) || isConversationBusy(result.code)) {
          shouldRetry = true;
        } else {
          toast.error(result.message || "上次生成任务暂时无法恢复");
        }
      }

      if (recoveredRows.length && !cancelled && activeIdRef.current === activeId) {
        try {
          const recoveredTaskIds = recoveredRows
            .map((row) => row.turn?.taskId)
            .filter((taskId): taskId is string => !!taskId);
          const visible = await loadMessages(
            activeId,
            (records) => recoveredTaskIds.every((taskId) =>
              records.some((message) => message.taskId === taskId),
            ),
          );
          if (!cancelled && visible) {
            for (const row of recoveredRows) {
              await forgetPendingMediaTurn(row);
              if (row.composer) {
                setDraft((current) => (current === row.composer?.draft ? "" : current));
                clearRefsIfUnchanged(row.composer.refs);
              }
            }
            toast.success("已恢复上次生成任务");
          } else if (!cancelled) {
            shouldRetry = true;
          }
        } catch {
          // Keep the journal until a later refresh visibly reconciles the turn.
          if (!cancelled) shouldRetry = true;
        }
      }
      if (shouldRetry && !cancelled) {
        if (!reconnectNoticeShown) {
          reconnectNoticeShown = true;
          toast.info("正在恢复上次生成任务");
        }
        retryTimer = setTimeout(recover, 5000);
      }
    };

    void recover();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activeId, busy, ensureSession, loadMessages, activeIdRef, clearRefsIfUnchanged, restoreRefsIfEmpty, setDraft]);

  // A text POST can be accepted and charged even when its terminal SSE frame
  // never reaches the browser. Reconcile the durable request id first and only
  // replay the frozen payload with that SAME id. The server-side unique fence
  // then turns a transport retry into a lookup/join, never a second paid call.
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let recoveryController: AbortController | null = null;
    let reconnectNoticeShown = false;
    let composerRestored = false;
    const probeAfterByRequest = new Map<string, number>();

    const schedule = (fn: () => void, delay: number) => {
      if (cancelled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(fn, delay);
    };

    if (!activeId) {
      schedule(() => setTextRecovering(false), 0);
      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }
    if (busy) {
      return () => {
        cancelled = true;
      };
    }

    const conversationId = activeId;
    const settle = async (row: PendingTextTurn) => {
      await forgetPendingTextTurn(row);
      setDraft((current) => (current === row.composer.draft ? "" : current));
      clearRefsIfUnchanged(row.composer.refs);
    };

    const reject = async (row: PendingTextTurn, message: string, code?: string) => {
      await forgetPendingTextTurn(row);
      if (activeIdRef.current === conversationId) {
        setDraft((current) => current || row.composer.draft);
        restoreRefsIfEmpty(row.composer.refs);
      }
      if (code === "CONTEXT_LIMIT") void refreshCtxUsage(conversationId);
      toast.error(message || "生成失败");
    };

    const recover = async () => {
      if (cancelled) return;
      try {
        if (!(await ensureSession()) || cancelled) return;
        const ownerKey = currentJournalOwnerKey();
        const rows = pendingTextTurnsForConversation(ownerKey, conversationId);
        if (!rows.length) {
          setTextRecovering(false);
          return;
        }
        setTextRecovering(true);
        const row = rows[0];
        if (!composerRestored && activeIdRef.current === conversationId) {
          composerRestored = true;
          setDraft((current) => current || row.composer.draft);
          restoreRefsIfEmpty(row.composer.refs);
        }

        // First inspect durable history. This both avoids an unnecessary POST
        // and lets useResumeStream attach when only the user row is present.
        const history = await chatApi.latestMessages(conversationId);
        if (cancelled) return;
        if (!history.success || !history.data) {
          if (history.code === 403 || history.code === 404) {
            for (const pending of rows) {
              await forgetPendingTextTurn(pending);
            }
            setTextRecovering(false);
            return;
          }
          if (!reconnectNoticeShown) {
            reconnectNoticeShown = true;
            toast.info("正在确认上次发送状态");
          }
          schedule(() => void recover(), 3000);
          return;
        }

        const records = history.data.records;
        if (activeIdRef.current === conversationId) setMsgs(records);
        const assistant = records.find(
          (message) => message.role === "ai" && message.clientRequestId === row.clientRequestId,
        );
        if (assistant) {
          await settle(row);
          void refreshCtxUsage(conversationId);
          toast.success("已恢复上次回复");
          const remaining = pendingTextTurnsForConversation(ownerKey, conversationId);
          if (remaining.length) {
            schedule(() => void recover(), 0);
          } else {
            setTextRecovering(false);
          }
          return;
        }

        const userMessage = records.find(
          (message) => message.role === "user" && message.clientRequestId === row.clientRequestId,
        );
        const now = Date.now();
        const probeAfter = probeAfterByRequest.get(row.clientRequestId) ?? 0;
        if (userMessage && (now - row.updatedAt < 5000 || now < probeAfter)) {
          // The accepted request owns generation. Keep send locked while the
          // existing live-resume hook first attaches. Afterwards a same-key POST
          // periodically probes the durable server lease: a live winner returns
          // TURN_IN_PROGRESS, while a crashed winner can be claimed after expiry.
          schedule(() => void recover(), 5000);
          return;
        }

        // Give the first request a small window to publish its user row before
        // replaying. A replay after the window still carries the same id, so a
        // concurrent original can only win once at the database fence.
        if (Date.now() - row.updatedAt < 1500) {
          schedule(() => void recover(), 1500);
          return;
        }

        const ac = new AbortController();
        recoveryController = ac;
        chatAbortRef.current = ac;
        let recoveryStreamingShown = false;
        const thinkingTimer = setTimeout(() => {
          recoveryStreamingShown = true;
          setStreaming("");
        }, 250);
        let streamed = "";
        let errorMessage = "";
        let errorCode: string | undefined;
        const outcome = await streamMessage(conversationId, row.payload.content, {
          signal: ac.signal,
          attachments: row.payload.attachments,
          model: row.payload.model,
          skillId: row.payload.skillId,
          clientRequestId: row.clientRequestId,
          onDelta: (delta) => {
            clearTimeout(thinkingTimer);
            recoveryStreamingShown = true;
            streamed += delta;
            setStreaming(streamed);
            if (nearBottomRef.current) requestAnimationFrame(scrollEnd);
          },
          onError: (message, code) => {
            errorMessage = message;
            errorCode = code;
          },
        });
        clearTimeout(thinkingTimer);
        if (chatAbortRef.current === ac) chatAbortRef.current = null;
        if (recoveryController === ac) recoveryController = null;
        if (cancelled) return;
        if (recoveryStreamingShown) setStreaming(null);

        if (outcome.status === "completed") {
          const visible = activeIdRef.current === conversationId && await loadMessages(
            conversationId,
            (records) => records.some(
              (message) => message.role === "ai" && message.clientRequestId === row.clientRequestId,
            ),
          );
          if (visible) {
            await settle(row);
            void refreshCtxUsage(conversationId);
            const remaining = pendingTextTurnsForConversation(ownerKey, conversationId);
            if (remaining.length) schedule(() => void recover(), 0);
            else setTextRecovering(false);
          } else {
            schedule(() => void recover(), 2500);
          }
          return;
        }
        if (outcome.status === "rejected") {
          await reject(row, errorMessage || outcome.message || "生成失败", errorCode || outcome.code);
          setTextRecovering(false);
          return;
        }
        // pending / ambiguous / aborted: retain the journal and lock. Aborted
        // normally means the user switched conversations; cleanup prevents a
        // stale retry here and switching back starts a fresh reconciliation.
        if (!cancelled) {
          if (outcome.status === "pending") {
            probeAfterByRequest.set(
              row.clientRequestId,
              Date.now() + Math.max(1000, outcome.retryAfterMs ?? 5000),
            );
          }
          // Keep polling durable history even when the next lease probe is far
          // away; a healthy winner may finish at any time before that deadline.
          schedule(() => void recover(), 2500);
        }
      } catch {
        if (!cancelled) {
          if (!reconnectNoticeShown) {
            reconnectNoticeShown = true;
            toast.info("正在确认上次发送状态");
          }
          schedule(() => void recover(), 3000);
        }
      }
    };

    void recover();
    return () => {
      cancelled = true;
      recoveryController?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    activeId,
    busy,
    ensureSession,
    activeIdRef,
    chatAbortRef,
    clearRefsIfUnchanged,
    loadMessages,
    nearBottomRef,
    refreshCtxUsage,
    restoreRefsIfEmpty,
    scrollEnd,
    setDraft,
    setMsgs,
    setStreaming,
    setTextRecovering,
  ]);

  const send = useCallback(async (candidate?: unknown) => {
    const selectedTool = toolSkill && skillKindOf(toolSkill) === "tool" ? toolSkill : null;
    const expected = isHistorySendTarget(candidate) ? candidate : undefined;
    if (expected) {
      const effectiveSkillId = selectedTool?.id ?? (
        skill && selModel
          && skillKindOf(skill) === "preset"
          && skillSupportsOutput(skill, selModel.type)
          ? skill.id
          : null
      );
      const targetStillCurrent = historySendTargetMatches(expected, {
        conversationId: activeId,
        draft,
        model: selModel
          ? {
              id: selModel.id,
              name: selModel.name,
              modelKey: selModel.modelKey,
              type: selModel.type,
            }
          : null,
        skillId: effectiveSkillId,
      });
      if (!targetStillCurrent) {
        const modelChanged = !selModel || expected.model.id !== selModel.id;
        toast.info(modelChanged
          ? "原模型已下架或当前模型已切换，请确认当前模型后手动发送"
          : "历史输入或技能已变化，请确认后手动发送");
        return;
      }
    }
    const v = draft.trim();
    if (busy || textRecovering) return;
    // 音乐的自定义/延长/翻唱不强制描述；其余（含灵感模式/音效）仍需文字。
    if (!v && !musicNoDraftOk && !selectedTool) return;
    if (!selectedTool && isMusicSel) {
      const musicErr = validateMusicParams(v, music);
      if (musicErr) {
        toast.info(musicErr);
        return;
      }
    }

    // text-model sends are blocked once the conversation's context is full
    // (the server enforces the same cap; this just fails fast with guidance).
    if (!selectedTool && selModel?.type === "text" && ctxUsage?.full) {
      toast.error("当前会话上下文已达上限，请开启新会话");
      return;
    }

    // reference media (uploaded → hosted urls). A ref-mode requires at least one
    // usable ref and blocks while any is still uploading.
    // refPolicy disappearing means the newly selected mode/model accepts no
    // references. Treat that synchronously as an empty set instead of waiting
    // for useReferences' cleanup effect, otherwise a same-frame send can retain
    // stale attachments in history even though they are absent from the request.
    const allowedRefs = selectedTool
      ? refs
      : refPolicy
        ? refs.filter((r) => refPolicy.kinds.includes(r.kind))
        : [];
    const refImageUrls = allowedRefs.filter((r) => r.kind === "image" && r.url).map((r) => r.url as string);
    const refVideoUrls = allowedRefs.filter((r) => r.kind === "video" && r.url).map((r) => r.url as string);
    const refAudioUrls = allowedRefs.filter((r) => r.kind === "audio" && r.url).map((r) => r.url as string);
    if (refPolicy) {
      if (allowedRefs.some((r) => r.uploading)) {
        toast.info("文件上传中，请稍候");
        return;
      }
      // block on a failed upload so the user doesn't unknowingly send without it.
      if (allowedRefs.some((r) => r.failed)) {
        toast.error("有文件上传失败，请移除后重试");
        return;
      }
      // text-model uploads are optional; generation ref-modes require one.
      // omni_ref 的策略允许纯音频参考（音频驱动的视频生成），音频也算数——
      // 否则界面明示「音频已添加、可 @ 引用」，发送却被拦，自相矛盾。
      if (
        !selectedTool &&
        !refOptional &&
        refImageUrls.length === 0 &&
        refVideoUrls.length === 0 &&
        refAudioUrls.length === 0
      ) {
        toast.error("当前模式需要先添加参考素材");
        return;
      }
    }

    const toolInput = selectedTool ? chatToolRunInput(selectedTool, v, allowedRefs) : null;
    if (selectedTool && toolInput) {
      const errors = validateSkillRunInputValues(selectedTool.inputSchema, toolInput);
      const message = errors.prompt || errors.assets || errors.parameters || Object.values(errors)[0];
      if (message) {
        toast.info(message);
        return;
      }
    }

    setBusy(true);
    // Do not clear any composer state until auth and conversation creation have
    // both succeeded. These calls can redirect, fail, or return an ambiguous
    // network result before there is anywhere durable to store the user's input.
    let id = activeId;
    try {
      if (!(await ensureSession())) {
        setBusy(false);
        return;
      }
      if (!id) {
        const created = await chatApi.createConversation({});
        if (created.success && created.data) {
          id = created.data.id;
          setConvos((prev) => [created.data, ...prev]);
          setActiveId(id);
        } else {
          toast.error(created.message || "创建会话失败，请重试");
          setBusy(false);
          return;
        }
      }
    } catch {
      toast.error("会话连接失败，请重试");
      setBusy(false);
      return;
    }
    const ownerKey = currentJournalOwnerKey();
    // Close the mount/effect timing window: a durable text journal from an
    // earlier ambiguous send blocks every new turn in this conversation until
    // recovery has reconciled it.
    if (pendingTextTurnsForConversation(ownerKey, id).length) {
      setTextRecovering(true);
      toast.info("上一条消息正在确认，请稍候");
      setBusy(false);
      return;
    }
    const composerSnapshot: ComposerSnapshot = {
      draft,
      refs: refs.map(({ key, kind, url, name }) => ({ key, kind, url, name })),
    };

    const bump = (cid: string) =>
      setConvos((prev) => {
        const idx = prev.findIndex((conversation) => conversation.id === cid);
        if (idx <= 0) return prev;
        const copy = prev.slice();
        const [conversation] = copy.splice(idx, 1);
        copy.unshift(conversation);
        return copy;
      });

    // 技能工具直接从输入框启动，不打开额外参数弹窗。服务端会原子写入用户
    // 消息和 skill_run 助手消息，聊天线程继续负责轮询进度与展示产物。
    if (selectedTool && toolInput) {
      const createScope = `chat-tool:${ownerKey}:${id}:${selectedTool.id}`;
      try {
        const started = await skillRunApi.createIdempotent({
          skillId: selectedTool.id,
          entryPoint: "studio",
          conversationId: id,
          input: toolInput,
        }, createScope);
        if (!started.success || !started.data) {
          toast.error(started.message || "技能启动失败，请重试");
          return;
        }
        await skillRunApi.commitCreate(createScope, started.data.id);
        setDraft((current) => current === composerSnapshot.draft ? "" : current);
        clearRefsIfUnchanged(composerSnapshot.refs);
        bump(id);
        void refreshCtxUsage(id);
        const stillVisible = activeIdRef.current === id || (!activeId && activeIdRef.current === null);
        if (stillVisible) {
          const visible = await loadMessages(
            id,
            (records) => records.some((message) => message.skillRunId === started.data!.id),
          );
          if (!visible) toast.info("技能已启动，正在同步消息列表");
          forceBottom();
        }
      } catch {
        toast.error("技能启动连接失败，输入已保留，请重试");
      } finally {
        setBusy(false);
      }
      return;
    }

    setDraft("");

    // attachments snapshot — TEXT models only. Generation turns persist their
    // references via persistTurn (params.references), so attaching here would make
    // the optimistic bubble flash thumbnails that vanish on reload.
    // 文本模型附件收全部类型（图片给模型做多模态,视频/音频/文档落库展示）
    const attachSnapshot = refOptional
      ? allowedRefs.filter((r) => r.url).map((r) => ({ url: r.url as string, kind: r.kind }))
      : [];

    // 用户气泡/落库的提示词：音乐模式描述可留空，兜底一句模式摘要（persistTurn
    // 的 prompt 为必填，气泡也不能是空白）。
    const sendText = v || (isMusicSel ? musicTurnSummary(music) : "");

    // optimistic user bubble
    const optimistic: MessageVO = {
      id: `tmp-${Date.now()}`,
      conversationId: id,
      role: "user",
      contentType: "text",
      content: sendText,
      createTime: new Date().toISOString(),
      ...(attachSnapshot.length ? { params: { attachments: attachSnapshot } } : {}),
    };
    setMsgs((prev) => [...prev, optimistic]);
    setTyping(true);
    forceBottom();

    // 选图片/视频/音频模型 → 真实生成（一个 turn，助手消息只指向 task）；文本模型 → 文字对话。
    const wantImage = selModel?.type === "image";
    const wantVideo = selModel?.type === "video";
    const wantAudio = selModel?.type === "audio";
    let mediaTurnCommitted = false;
    let textTurnPending: PendingTextTurn | null = null;

    try {
      if ((wantImage || wantVideo || wantAudio) && selModel) {
        // 技能:只发 skillId,模板由服务端拼到描述前面。客户端先拼好的话,落库的
        // input 会变成「模板+描述」,作品标题和「重新编辑」读到的全是模板开头。
        const genPrompt = v;
        const presetSkill =
          skill && skillKindOf(skill) === "preset" && skillSupportsOutput(skill, selModel.type)
            ? skill
            : null;
        const skillInput = presetSkill ? { skillId: presetSkill.id } : {};
        // 先 submit（计费/配额走既有生成管线）；被拒时尚未持久化任何东西，无孤儿可清。
        // 音频：音乐按四创作模式组装（与创作台同构），音效只发描述。
        const input: Record<string, unknown> = wantAudio
          ? isMusicSel
            ? { ...buildMusicInput(genPrompt, music), ...skillInput }
            : { prompt: genPrompt, ...skillInput }
          : {
              prompt: genPrompt,
              ...skillInput,
              ...(ratio ? { aspectRatio: ratio, aspect_ratio: ratio, ratio } : {}),
              ...(res ? { resolution: res } : {}),
              // 图片：clarity + quality 必须一起发，服务端图片单价查的是
              // [quality][clarity]；缺 quality 会查表落空、退回模型固定价。
              ...(wantImage && res ? { clarity: res } : {}),
              ...(wantImage && quality ? { quality } : {}),
              ...(wantVideo && dur ? { duration: dur } : {}),
            };
        // pick the handler by mode + attached references (P2).
        let handler: string;
        if (wantAudio) {
          handler = "text_to_audio";
        } else if (wantVideo) {
          if (mode === "i2v" && refImageUrls.length) {
            handler = "image_to_video";
            input.sourceImage = refImageUrls[0];
            input.imageList = refImageUrls.slice(0, 1);
          } else if (mode === "keyframe" && refImageUrls.length) {
            handler = "start_end_to_video";
            input.firstFrame = refImageUrls[0];
            input.lastFrame = refImageUrls[1] ?? refImageUrls[0];
          } else if (
            mode === "omni_ref" &&
            (refImageUrls.length || refVideoUrls.length || refAudioUrls.length)
          ) {
            // 纯音频参考也走 reference_to_video（与创作台「全能参考」行为一致）
            handler = "reference_to_video";
            input.references = refImageUrls;
            if (refVideoUrls.length) input.videoReferences = refVideoUrls;
            if (refAudioUrls.length) input.audioReferences = refAudioUrls;
          } else {
            handler = "text_to_video";
          }
        } else if (mode === "i2i" && refImageUrls.length) {
          handler = "image_to_image";
          input.imageList = refImageUrls;
        } else {
          handler = "text_to_image";
        }
        // image handlers loop on batchCount → request N images when 批量 > 1 (not video).
        if (wantImage && batch > 1) input.batchCount = batch;
        const generationRequest = {
          handler,
          modelId: selModel.modelKey || selModel.id,
          ...(presetSkill
            ? { entryPoint: "chat" as const, targetType: selModel.type }
            : {}),
          input,
        };
        const requestKey = mediaRequestKey(generationRequest);

        // Snapshot first so a recovered task is persisted with the exact
        // settings from its original request, even if the visible catalog label
        // changes before the user retries.
        const params: Record<string, unknown> = {
          modelRowId: selModel.id,
          model: selModel.name,
          modelKey: selModel.modelKey,
          type: selModel.type,
          ...(presetSkill
            ? { skill: { id: presetSkill.id, title: presetSkill.title } }
            : {}),
          ...(mode ? { mode } : {}),
          ...(ratio ? { ratio } : {}),
          ...(res ? { resolution: res } : {}),
          ...(wantImage && quality ? { quality } : {}),
          ...(wantVideo && dur ? { duration: dur } : {}),
          ...(wantImage && batch > 1 ? { batch } : {}),
          // 音乐参数快照：重新编辑/再次生成时恢复四模式字段。
          ...(wantAudio && isMusicSel ? { music: { ...music } } : {}),
          ...(refImageUrls.length || refVideoUrls.length || refAudioUrls.length
            ? {
                references: [
                  ...refImageUrls.map((url) => ({ url, kind: "image" })),
                  ...refVideoUrls.map((url) => ({ url, kind: "video" })),
                  // 音频引用也要入快照：漏掉的话「重新编辑/再次生成」恢复不出
                  // 音频素材，prompt 里的「音频N」token 变成悬空引用
                  ...refAudioUrls.map((url) => ({ url, kind: "audio" })),
                ],
              }
            : {}),
        };

        // Persist the exact paid request BEFORE task creation. If the page dies
        // after the server accepts the task, recovery replays the same explicit
        // clientRequestId and receives that task instead of charging again.
        const candidate: PendingMediaTurn = {
          ownerKey,
          conversationId: id,
          requestKey,
          generation: {
            ...generationRequest,
            clientRequestId: chatRequestId(),
          },
          turnTemplate: {
            prompt: sendText,
            params,
            contentType: wantVideo ? "video" : wantAudio ? "audio" : "image",
          },
          composer: composerSnapshot,
          updatedAt: Date.now(),
        };
        const claim = await claimPendingMediaTurn(candidate);
        if (claim.status === "storage-failed") {
          // Never delete by payload here: another tab may have won the lock with
          // the same requestKey. No durable credential means no paid request.
          discardPendingMediaTurnFromMemory(candidate);
          setMsgs((prev) => prev.filter((message) => message.id !== optimistic.id));
          setDraft((current) => current || composerSnapshot.draft);
          restoreRefsIfEmpty(composerSnapshot.refs);
          toast.error("浏览器无法保存生成凭据，请检查隐私/存储设置后重试");
          return;
        }
        if (
          claim.status === "existing" &&
          (claim.turn.kind !== "media" || !sameMediaIntent(claim.turn.value, candidate))
        ) {
          setMsgs((prev) => prev.filter((message) => message.id !== optimistic.id));
          setDraft((current) => current || composerSnapshot.draft);
          restoreRefsIfEmpty(composerSnapshot.refs);
          toast.info("上一项任务正在确认，请稍候");
          return;
        }
        let journal = claim.status === "existing" ? claim.turn.value as PendingMediaTurn : claim.row;

        let turn = journal.turn;
        if (!turn) {
          if (!journal.generation || !journal.turnTemplate) {
            await forgetPendingMediaTurn(journal);
            throw new Error("invalid media recovery journal");
          }
          const gen = await aiApi.generateIdempotent(journal.generation, `chat:${id}`);
          if (!gen.success || !gen.data?.id) {
            setMsgs((prev) => prev.filter((m) => m.id !== optimistic.id));
            setDraft((cur) => (cur ? cur : draft));
            if (isAmbiguousFailure(gen.code)) {
              toast.info("生成请求状态暂未确认，正在自动恢复，不会重复扣费");
            } else {
              await forgetPendingMediaTurn(journal);
              toast.error(gen.message || "生成请求失败");
            }
            return;
          }
          turn = {
            ...journal.turnTemplate,
            taskId: String(gen.data.id),
          };
          journal = { ...journal, turn, updatedAt: Date.now() };
          // If this larger update cannot be confirmed, the already-durable
          // pre-charge intent is still enough to recover the task by request id.
          await updatePendingMediaTurn(journal);
        }

        const persisted = await chatApi.persistTurn(id, turn);
        if (!persisted.success) {
          // 403/404 prove this conversation/task can no longer be recovered by
          // the current account. Every ambiguous failure keeps the journal.
          if (persisted.code === 403 || persisted.code === 404) {
            await forgetPendingMediaTurn(journal);
          }
          setMsgs((prev) => prev.filter((m) => m.id !== optimistic.id));
          setDraft((cur) => (cur ? cur : draft));
          if (isConversationBusy(persisted.code)) {
            toast.info("当前对话正在生成，任务已保留，稍后会自动写入对话");
          } else if (isAmbiguousFailure(persisted.code)) {
            toast.info("任务已创建，保存连接中断；再次发送会恢复该任务，不会重复扣费");
          } else {
            toast.error(persisted.message || "任务已创建，但保存到会话失败");
          }
          return;
        }
        mediaTurnCommitted = true;
        // only reload into the view if still on this conversation; otherwise the
        // journal remains until the durable turn is visibly reconciled. This is
        // important when /turn succeeds but the following history request fails.
        if (activeIdRef.current === id) {
          const visible = await loadMessages(
            id,
            (records) => records.some((message) => message.taskId === turn.taskId),
          );
          if (visible) {
            const consumed = composerSnapshot;
            await forgetPendingMediaTurn(journal);
            setDraft((current) => (current === consumed.draft ? "" : current));
            clearRefsIfUnchanged(consumed.refs);
          } else {
            toast.info("任务已保存，正在同步消息列表");
          }
        }
        bump(id); // surface the conversation to the top regardless of focus
        refreshCtxUsage(id); // generation prompts count toward the context cap too
      } else {
        // text model → streamed reply (P4). The generic typing dots give way to
        // a live streaming bubble; switching conversation aborts it.
        const payload: TextTurnPayload = {
          content: v,
          attachments: attachSnapshot.map((attachment) => ({ ...attachment })),
          ...(selModel?.type === "text" && selModel.modelKey ? { model: selModel.modelKey } : {}),
          ...(skill && skillKindOf(skill) === "preset" && skillSupportsOutput(skill, "text")
            ? { skillId: skill.id }
            : {}),
        };
        const requestKey = mediaRequestKey(payload);
        const candidate: PendingTextTurn = {
          ownerKey,
          conversationId: id,
          requestKey,
          clientRequestId: chatRequestId(),
          payload,
          composer: composerSnapshot,
          updatedAt: Date.now(),
        };
        // Persist before the first network await. A lost terminal frame can now
        // only replay this exact payload with this exact server idempotency key.
        const claim = await claimPendingTextTurn(candidate);
        if (claim.status === "storage-failed") {
          discardPendingTextTurnFromMemory(candidate);
          setMsgs((prev) => prev.filter((message) => message.id !== optimistic.id));
          setDraft((current) => current || composerSnapshot.draft);
          restoreRefsIfEmpty(composerSnapshot.refs);
          toast.error("浏览器无法保存发送凭据，请检查隐私/存储设置后重试");
          return;
        }
        if (
          claim.status === "existing" &&
          (claim.turn.kind !== "text" || !sameTextIntent(claim.turn.value, candidate))
        ) {
          setMsgs((prev) => prev.filter((message) => message.id !== optimistic.id));
          setDraft((current) => current || composerSnapshot.draft);
          restoreRefsIfEmpty(composerSnapshot.refs);
          setTextRecovering(claim.turn.kind === "text");
          toast.info("上一项任务正在确认，请稍候");
          return;
        }
        textTurnPending = claim.status === "existing" ? claim.turn.value as PendingTextTurn : claim.row;

        setTyping(false);
        setStreaming("");
        const ac = new AbortController();
        chatAbortRef.current = ac;
        let acc = "";
        let errorMessage = "";
        let errorCode: string | undefined;
        const outcome = await streamMessage(id, payload.content, {
          signal: ac.signal,
          attachments: payload.attachments,
          model: payload.model,
          skillId: payload.skillId,
          clientRequestId: textTurnPending.clientRequestId,
          onDelta: (d) => {
            acc += d;
            setStreaming(acc);
            // coalesce rapid tokens into one scroll per frame to avoid judder.
            if (nearBottomRef.current) requestAnimationFrame(scrollEnd);
          },
          onError: (m, code) => {
            errorMessage = m;
            errorCode = code;
          },
        });
        // only clear OUR controller — a newer stream may have replaced it.
        if (chatAbortRef.current === ac) chatAbortRef.current = null;
        setStreaming(null);

        if (outcome.status === "completed") {
          // A terminal frame is not enough: retain the journal until the new
          // rows have also been reconciled into the visible thread.
          const clientRequestId = textTurnPending.clientRequestId;
          const visible = activeIdRef.current === id && await loadMessages(
            id,
            (records) => records.some(
              (message) => message.role === "ai" && message.clientRequestId === clientRequestId,
            ),
          );
          if (visible) {
            await forgetPendingTextTurn(textTurnPending);
            textTurnPending = null;
            setDraft((current) => (current === composerSnapshot.draft ? "" : current));
            clearRefsIfUnchanged(composerSnapshot.refs);
            bump(id);
            void refreshCtxUsage(id);
          } else if (activeIdRef.current === id) {
            setTextRecovering(true);
            toast.info("回复已生成，正在同步消息列表");
          }
        } else if (outcome.status === "rejected") {
          // Explicit business rejection means the server did not accept a paid
          // turn. Release the lock and restore only into the same conversation.
          if (activeIdRef.current === id) {
            await forgetPendingTextTurn(textTurnPending);
            textTurnPending = null;
            setMsgs((prev) => prev.filter((message) => message.id !== optimistic.id));
            setDraft((current) => current || composerSnapshot.draft);
            restoreRefsIfEmpty(composerSnapshot.refs);
            setTextRecovering(false);
            toast.error(errorMessage || outcome.message || "生成失败");
            if ((errorCode || outcome.code) === "CONTEXT_LIMIT") void refreshCtxUsage(id);
          }
        } else {
          // Transport ambiguity and TURN_IN_PROGRESS retain the journal. Keep
          // the original text visible but locked while automatic confirmation
          // proceeds, so a second click cannot start another paid request.
          setMsgs((prev) => prev.filter((message) => message.id !== optimistic.id));
          if (activeIdRef.current === id) {
            setDraft((current) => current || composerSnapshot.draft);
            restoreRefsIfEmpty(composerSnapshot.refs);
            setTextRecovering(true);
            if (outcome.status !== "aborted") {
              toast.info("连接中断，正在自动确认发送状态，不会重复扣费");
            }
          }
        }
      }
    } catch {
      // Unexpected failures must not eat the composer state. Generation and
      // turn journals (when already written) remain available for safe retry.
      if (textTurnPending) {
        setMsgs((prev) => prev.filter((message) => message.id !== optimistic.id));
        if (activeIdRef.current === id) {
          setDraft((current) => current || textTurnPending?.composer.draft || draft);
          restoreRefsIfEmpty(textTurnPending.composer.refs);
          setTextRecovering(true);
          toast.info("发送连接中断，正在自动确认状态");
        }
      } else if (!mediaTurnCommitted) {
        setMsgs((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft((cur) => (cur ? cur : draft));
        toast.error("发送失败，输入已保留，请重试");
      } else {
        toast.info("任务已保存，消息列表刷新失败，请稍后重试");
      }
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }, [draft, busy, textRecovering, activeId, ensureSession, loadMessages, selModel, mode, ratio, res, quality, dur, batch, refs, refPolicy, refOptional, clearRefsIfUnchanged, restoreRefsIfEmpty, forceBottom, scrollEnd, ctxUsage, refreshCtxUsage, music, isMusicSel, musicNoDraftOk, skill, toolSkill, activeIdRef, chatAbortRef, nearBottomRef, setActiveId, setBusy, setConvos, setDraft, setMsgs, setStreaming, setTextRecovering, setTyping]);

  return send;
}
