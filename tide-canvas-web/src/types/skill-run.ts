import type { PageQuery } from "@/types/api";
import type { SkillEntryPoint, SkillInputSchema, SkillKind, SkillOutputType } from "@/types/skill";

export type SkillRunStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_confirmation"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SkillRunAction = "confirm" | "revise" | "submit_input" | "retry" | "cancel";

export type SkillRunAssetType = SkillOutputType;

/** One semantically-labelled input supplied by any product surface. */
export interface SkillRunAssetInput {
  id?: string;
  type: SkillRunAssetType;
  url?: string;
  content?: string;
  role?: string;
  name?: string;
  nodeType?: string;
  nodeId?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillRunMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface SkillRunInput {
  prompt: string;
  assets: SkillRunAssetInput[];
  sourceNodeIds: string[];
  parameters: Record<string, unknown>;
  /** Previous completed turns. The current request remains in prompt. */
  messages?: SkillRunMessageInput[];
}

export interface SkillRunCreateDTO {
  skillId: string;
  entryPoint: SkillEntryPoint;
  /** Placement target selected by the entry surface (canvas node / asset category). */
  targetType?: string;
  projectId?: string;
  conversationId?: string;
  /** Required by the wire API. Use createIdempotent with SkillRunCreateInput
   *  when the caller wants the client to reserve/reuse this key automatically. */
  clientRequestId: string;
  input: SkillRunInput;
}

export type SkillRunCreateInput = Omit<SkillRunCreateDTO, "clientRequestId"> & {
  clientRequestId?: string;
};

export interface SkillRunActionDTO {
  action: SkillRunAction;
  /** Optimistic concurrency fence. Every action must target the exact state the user saw. */
  expectedRevision: number;
  /** submit_input / revise 的结构化字段；confirm/retry/cancel 通常为空。 */
  input?: Record<string, unknown>;
  /** 用户对本步骤的补充或修改意见。 */
  feedback?: string;
  /** 兼容旧草案；新调用统一发送 feedback。 */
  message?: string;
  /** Required by the wire API; actionIdempotent may generate it for callers. */
  clientRequestId: string;
}

export type SkillRunActionInput = Omit<SkillRunActionDTO, "clientRequestId"> & {
  clientRequestId?: string;
};

export interface SkillRunPendingAction {
  type: "input" | "confirmation";
  title?: string;
  message?: string;
  confirmLabel?: string;
  schema?: SkillInputSchema | string | null;
  values?: Record<string, unknown>;
}

export interface SkillRunArtifactVO {
  id: string;
  runId?: string;
  stepId?: string;
  type: SkillRunArtifactType;
  role?: string;
  title?: string;
  url?: string;
  /** 文本产物的标准字段。 */
  text?: string;
  /** 兼容早期服务端字段，消费端优先读取 text。 */
  content?: string;
  taskId?: string;
  fileId?: string;
  isFinal?: boolean;
  /** 画布消费方可按此直接物化节点；未知值应回退到 artifact.type。 */
  preferredNodeType?: string;
  metadata?: Record<string, unknown> | string | null;
  createTime?: string;
}

export type SkillRunArtifactType = SkillOutputType;
export type SkillRunArtifact = SkillRunArtifactVO;

export interface SkillRunStepVO {
  id: string;
  key?: string;
  title?: string;
  status: SkillRunStatus | "pending" | "waiting" | "skipped";
  progress?: number;
  message?: string;
  errorMessage?: string;
  artifacts?: SkillRunArtifactVO[];
  createTime?: string;
  updateTime?: string;
}

export interface SkillRunVO {
  id: string;
  skillId: string;
  skillVersionId?: string;
  skillTitle?: string;
  skillKind?: SkillKind;
  userId?: string;
  entryPoint: SkillEntryPoint;
  /** Surface placement pinned when the run was created (canvas node / asset category). */
  targetType?: string;
  projectId?: string;
  conversationId?: string;
  clientRequestId?: string;
  status: SkillRunStatus;
  currentStep?: string;
  currentStepTitle?: string;
  progress: number;
  input?: SkillRunInput | Record<string, unknown> | string | null;
  pendingAction?: SkillRunPendingAction | null;
  steps?: SkillRunStepVO[];
  artifacts?: SkillRunArtifactVO[];
  errorMessage?: string;
  /** 兼容后端既有 errorMsg 命名；展示端优先 errorMessage。 */
  errorMsg?: string;
  pointCost?: number;
  /** Monotonic server-side state revision used to fence stale polls and actions. */
  revision: number;
  createTime?: string;
  updateTime?: string;
  completeTime?: string;
}

export interface SkillRunQuery extends PageQuery {
  skillId?: string;
  entryPoint?: SkillEntryPoint;
  projectId?: string;
  conversationId?: string;
  /** JSON-encoded idempotency keys used to reconcile ambiguous create responses. */
  clientRequestIds?: string;
  status?: SkillRunStatus;
  active?: boolean;
}

export const SKILL_RUN_ACTIVE_STATUSES: readonly SkillRunStatus[] = [
  "queued",
  "running",
  "waiting_input",
  "waiting_confirmation",
] as const;

export function isSkillRunActive(status: SkillRunStatus | undefined): boolean {
  return !!status && SKILL_RUN_ACTIVE_STATUSES.includes(status);
}

export function isSkillRunTerminal(status: SkillRunStatus | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function skillRunError(run: Pick<SkillRunVO, "errorMessage" | "errorMsg">): string {
  return run.errorMessage?.trim() || run.errorMsg?.trim() || "";
}
