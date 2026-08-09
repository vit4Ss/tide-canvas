/**
 * 画布持久化领域模型。
 *
 * 这些字段与服务端已有 canvasData 保持兼容。框架私有状态（例如 React Flow
 * 的 measured、selected、dragging）不得进入这里，避免更换渲染引擎时污染存量数据。
 */

export interface CanvasPendingGeneration {
  version: 1;
  handler: string;
  modelId: string;
  input: Record<string, unknown>;
  clientRequestId: string;
  projectId?: string;
  entryPoint?: "canvas";
  targetType?: string;
  gridOutput?: boolean;
  createdAt: number;
}

export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  prompt?: string;
  content?: string;
  stylePresetId?: string;
  stylePresetName?: string;
  stylePresetPrompt?: string;
  stylePresetModelIds?: string[];
  stylePresetModelPrompts?: Record<string, string>;
  stylePresetCoverUrl?: string;
  skillId?: string;
  skillName?: string;
  skillRunId?: string;
  provenance?: {
    skillRunId: string;
    artifactId: string;
    skillId?: string;
    skillVersion?: string;
    stepKey?: string;
  };
  imageSrc?: string;
  images?: string[];
  videoSrc?: string;
  fileSize?: number;
  fileType?: string;
  mimeType?: string;
  audioSrc?: string;
  audioTracks?: Array<{ url: string; title?: string; clipId?: string }>;
  status?: "idle" | "generating" | "success" | "error";
  taskId?: string;
  pendingGeneration?: CanvasPendingGeneration;
  uploading?: boolean;
  uploadProgress?: number;
  aspectRatio?: string;
  generationConfig?: {
    modelId?: string;
    quality?: string;
    resolution?: string;
    duration?: number;
    batchCount?: number;
  };
  contentW?: number;
  contentH?: number;
  is360?: boolean;
  scene3d?: string;
  /** 未知历史字段需要在加载—保存往返中保留。 */
  [field: string]: unknown;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  targetSlot?: string;
  sourceOutput?: string;
  /** 为后续连接能力扩展保留未知字段。 */
  [field: string]: unknown;
}

export interface CanvasGroup {
  id: string;
  title: string;
  color: string;
  nodeIds: string[];
  /** 为后续分组能力扩展保留未知字段。 */
  [field: string]: unknown;
}

export interface CanvasSkillRunPersistence {
  trackedRunIds?: string[];
  materializedArtifactIds?: string[];
  [field: string]: unknown;
}

export interface CanvasDocumentSnapshot {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
  skillRuns?: CanvasSkillRunPersistence;
  [field: string]: unknown;
}

export interface CanvasHistorySnapshot {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
}
