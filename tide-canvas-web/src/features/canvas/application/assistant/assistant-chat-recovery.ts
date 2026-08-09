export interface AssistantChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantChatAttachmentSnapshot {
  name: string;
  url: string;
  type: string;
  mimeType?: string;
  size: number;
}

export interface AssistantChatRequestSnapshot {
  clientRequestId: string;
  userMessageId: string;
  modelId: string;
  input: {
    prompt: string;
    messages: AssistantChatHistoryItem[];
    attachments: AssistantChatAttachmentSnapshot[];
  };
  createdAt: number;
}

const MAX_CLIENT_REQUEST_ID = 96;
const MAX_TASK_ID_LENGTH = 32;

export function normalizeAssistantTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const taskId = value.trim();
  return taskId.length > 0 && taskId.length <= MAX_TASK_ID_LENGTH && /^\d+$/.test(taskId)
    ? taskId
    : undefined;
}

function isHistoryItem(value: unknown): value is AssistantChatHistoryItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AssistantChatHistoryItem>;
  return (item.role === "user" || item.role === "assistant") && typeof item.content === "string";
}

function isAttachment(value: unknown): value is AssistantChatAttachmentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AssistantChatAttachmentSnapshot>;
  return typeof item.name === "string"
    && typeof item.url === "string"
    && typeof item.type === "string"
    && (item.mimeType === undefined || typeof item.mimeType === "string")
    && typeof item.size === "number"
    && Number.isFinite(item.size);
}

/** Reject malformed localStorage data before it can be replayed as a paid request. */
export function normalizeAssistantChatRequest(value: unknown): AssistantChatRequestSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Partial<AssistantChatRequestSnapshot>;
  const input = snapshot.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (
    typeof snapshot.clientRequestId !== "string"
    || !snapshot.clientRequestId
    || snapshot.clientRequestId.trim() !== snapshot.clientRequestId
    || snapshot.clientRequestId.length > MAX_CLIENT_REQUEST_ID
    || typeof snapshot.userMessageId !== "string"
    || !snapshot.userMessageId.trim()
    || typeof snapshot.modelId !== "string"
    || !snapshot.modelId.trim()
    || typeof snapshot.createdAt !== "number"
    || !Number.isFinite(snapshot.createdAt)
    || typeof input.prompt !== "string"
    || !Array.isArray(input.messages)
    || !input.messages.every(isHistoryItem)
    || !Array.isArray(input.attachments)
    || !input.attachments.every(isAttachment)
  ) return null;
  return {
    clientRequestId: snapshot.clientRequestId,
    userMessageId: snapshot.userMessageId,
    modelId: snapshot.modelId,
    input: {
      prompt: input.prompt,
      messages: input.messages,
      attachments: input.attachments,
    },
    createdAt: snapshot.createdAt,
  };
}

export function createAssistantChatClientRequestId(): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `canvas-chat-${suffix}`.slice(0, MAX_CLIENT_REQUEST_ID);
}

export function isAmbiguousAssistantCreateCode(code: number): boolean {
  return code === 0
    || code === 401
    || code === 408
    || code === 429
    || (code >= 500 && code <= 599);
}

export function isTerminalAssistantLookupCode(code: number): boolean {
  return code === 403 || code === 404;
}

export function assistantChatRetryDelay(failures: number, beyondForegroundBudget: boolean): number {
  const exponent = Math.max(0, Math.min(3, failures - 1));
  const backoff = Math.min(15_000, 1_500 * (2 ** exponent));
  return beyondForegroundBudget ? Math.max(10_000, backoff) : backoff;
}

/** 同步持久化栅栏：首次付费 POST 前必须写入并读回完全相同的恢复快照。 */
export function writeVerifiedAssistantRecoverySnapshot(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  serialized: string,
): boolean {
  try {
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

