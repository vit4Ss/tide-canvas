import type { FileVO } from "@/types/file";
import type { SkillVO } from "@/types/skill";
import { canvasLaunchCanSubmit, canvasLaunchKindFor } from "./canvas-launch-policy";

export type CanvasLaunchMode = "image" | "video";
export type CanvasLaunchState = "prepared" | "created" | "materialized" | "submitted" | "failed";
export type CanvasLaunchKind = "direct" | "preset" | "agent";

export interface CanvasLaunchGenerationPayload {
  handler: string;
  modelId: string;
  input: Record<string, unknown>;
  gridOutput?: boolean;
}

export interface CanvasLaunchPlan {
  /** preset/agent 都交接给新画布助手；只有 direct 走单模型直接生成。 */
  launchKind: CanvasLaunchKind;
  prompt: string;
  mode: CanvasLaunchMode;
  modelId: string;
  selectedSkill: SkillVO | null;
  attachments: FileVO[];
  canvasMode: boolean;
  imageRatio: string;
  imageQuality: string;
  imageResolution: string;
  videoRatio: string;
  videoResolution: string;
  videoDuration: number;
}

export interface CanvasLaunchJournal extends CanvasLaunchPlan {
  version: 1;
  id: string;
  state: CanvasLaunchState;
  createdAt: number;
  expiresAt: number;
  creatorUserId: string;
  projectId?: string;
  urlToken?: string;
  clientRequestId: string;
  targetNodeId: string;
  sourceNodeIds: Record<string, string>;
  /** 首次请求前冻结的规范化生成载荷；同一 clientRequestId 的恢复必须原样重放。 */
  generationPayload?: CanvasLaunchGenerationPayload;
  taskId?: string;
  error?: string;
}

const STORAGE_PREFIX = "tide-canvas:launch:";
const ACTIVE_STORAGE_KEY = "tide-canvas:launch:active";
const DRAFT_TTL_MS = 30 * 60 * 1000;

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function storageKey(id: string) {
  return `${STORAGE_PREFIX}${id}`;
}

function safeRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // sessionStorage may be unavailable in hardened/private browsing contexts.
  }
}

function isCanvasLaunchJournal(value: unknown): value is CanvasLaunchJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const journal = value as Partial<CanvasLaunchJournal>;
  const sourceNodeIdsValid = !!journal.sourceNodeIds
    && typeof journal.sourceNodeIds === "object"
    && !Array.isArray(journal.sourceNodeIds)
    && Object.values(journal.sourceNodeIds).every((nodeId) => typeof nodeId === "string" && nodeId.length > 0);
  const attachmentsValid = Array.isArray(journal.attachments)
    && journal.attachments.every((file) => !!file
      && typeof file === "object"
      && typeof file.id === "string"
      && typeof file.fileUrl === "string");
  const stateValid = journal.state === "prepared"
    || journal.state === "created"
    || journal.state === "materialized"
    || journal.state === "submitted"
    || journal.state === "failed";
  const linkedProjectValid = journal.state === "prepared"
    || (typeof journal.projectId === "string" && journal.projectId.length > 0
      && typeof journal.urlToken === "string" && journal.urlToken.length > 0);
  const submittedTaskValid = journal.state !== "submitted"
    || (typeof journal.taskId === "string" && journal.taskId.length > 0);
  const generationPayloadValid = journal.generationPayload === undefined
    || (!!journal.generationPayload
      && typeof journal.generationPayload === "object"
      && typeof journal.generationPayload.handler === "string"
      && typeof journal.generationPayload.modelId === "string"
      && !!journal.generationPayload.input
      && typeof journal.generationPayload.input === "object"
      && !Array.isArray(journal.generationPayload.input)
      && (journal.generationPayload.gridOutput === undefined || typeof journal.generationPayload.gridOutput === "boolean"));
  // launchKind 曾把“无技能直接生成”也记作 preset。以 selectedSkill 为真相，
  // 兼容旧草稿的同时保证真正的 preset/agent 都走助手 SkillRun。
  const launchKind = canvasLaunchKindFor(journal.selectedSkill);
  const launchKindValid = journal.launchKind === undefined
    || journal.launchKind === "direct"
    || journal.launchKind === "preset"
    || journal.launchKind === "agent";
  const launchTargetValid = launchKind === "direct"
    ? journal.selectedSkill === null && canvasLaunchCanSubmit(null, journal.modelId)
    : !!journal.selectedSkill
      && canvasLaunchKindFor(journal.selectedSkill) === launchKind
      && canvasLaunchCanSubmit(journal.selectedSkill, journal.modelId);

  return journal.version === 1
    && typeof journal.id === "string"
    && typeof journal.createdAt === "number"
    && typeof journal.expiresAt === "number"
    && typeof journal.creatorUserId === "string"
    && typeof journal.clientRequestId === "string"
    && journal.clientRequestId.length > 0
    && journal.clientRequestId.length <= 96
    && typeof journal.targetNodeId === "string"
    && typeof journal.prompt === "string"
    && (journal.mode === "image" || journal.mode === "video")
    && typeof journal.modelId === "string"
    && launchKindValid
    && launchTargetValid
    && (journal.selectedSkill === null
      || (!!journal.selectedSkill && typeof journal.selectedSkill === "object" && typeof journal.selectedSkill.id === "string"))
    && attachmentsValid
    && typeof journal.canvasMode === "boolean"
    && typeof journal.imageRatio === "string"
    && typeof journal.imageQuality === "string"
    && typeof journal.imageResolution === "string"
    && typeof journal.videoRatio === "string"
    && typeof journal.videoResolution === "string"
    && typeof journal.videoDuration === "number"
    && Number.isFinite(journal.videoDuration)
    && sourceNodeIdsValid
    && stateValid
    && linkedProjectValid
    && submittedTaskValid
    && generationPayloadValid;
}

export function createCanvasLaunchJournal(plan: CanvasLaunchPlan, creatorUserId: string): CanvasLaunchJournal {
  const id = randomId();
  const sourceNodeIds = Object.fromEntries(plan.attachments.map((file, index) => [file.id, `launch_source_${id}_${index}`]));
  return {
    ...plan,
    version: 1,
    id,
    state: "prepared",
    createdAt: Date.now(),
    expiresAt: Date.now() + DRAFT_TTL_MS,
    creatorUserId,
    clientRequestId: `canvas-launch-${id}`.slice(0, 96),
    targetNodeId: `launch_target_${id}`,
    sourceNodeIds,
  };
}

export function storeCanvasLaunchJournal(journal: CanvasLaunchJournal): boolean {
  if (typeof window === "undefined" || !journal.id) return false;
  try {
    window.sessionStorage.setItem(storageKey(journal.id), JSON.stringify(journal));
    window.sessionStorage.setItem(ACTIVE_STORAGE_KEY, journal.id);
    return true;
  } catch {
    // setItem 失败时保留此前最后一份可恢复 journal；更新 taskId 的失败
    // 不能反过来删除已经落下的 materialized 状态。
    return false;
  }
}

export function readCanvasLaunchJournal(id: string): CanvasLaunchJournal | null {
  if (typeof window === "undefined" || !id) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCanvasLaunchJournal(parsed) || Date.now() > parsed.expiresAt) {
      safeRemove(storageKey(id));
      return null;
    }
    const launchKind = canvasLaunchKindFor(parsed.selectedSkill);
    return parsed.launchKind === launchKind ? parsed : { ...parsed, launchKind };
  } catch {
    return null;
  }
}

export function readActiveCanvasLaunchJournal(): CanvasLaunchJournal | null {
  if (typeof window === "undefined") return null;
  try {
    const id = window.sessionStorage.getItem(ACTIVE_STORAGE_KEY);
    if (!id) return null;
    const journal = readCanvasLaunchJournal(id);
    if (!journal) safeRemove(ACTIVE_STORAGE_KEY);
    return journal;
  } catch {
    return null;
  }
}

export function dismissActiveCanvasLaunchJournal(id: string) {
  if (typeof window === "undefined" || !id) return;
  try {
    if (window.sessionStorage.getItem(ACTIVE_STORAGE_KEY) === id) {
      window.sessionStorage.removeItem(ACTIVE_STORAGE_KEY);
    }
  } catch {
    // Best effort only; the journal itself stays available by its explicit URL id.
  }
}

export function updateCanvasLaunchJournal(
  id: string,
  patch: Partial<Pick<CanvasLaunchJournal, "state" | "projectId" | "urlToken" | "generationPayload" | "taskId" | "error">>,
): CanvasLaunchJournal | null {
  const current = readCanvasLaunchJournal(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  return storeCanvasLaunchJournal(next) ? next : null;
}

export function clearCanvasLaunchJournal(id: string) {
  if (typeof window === "undefined" || !id) return;
  try {
    window.sessionStorage.removeItem(storageKey(id));
    if (window.sessionStorage.getItem(ACTIVE_STORAGE_KEY) === id) {
      window.sessionStorage.removeItem(ACTIVE_STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be unavailable in hardened/private browsing contexts.
  }
}
