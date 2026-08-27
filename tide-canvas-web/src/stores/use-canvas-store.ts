import { create } from "zustand";
import type {
  CanvasThreeDAsset,
  CanvasThreeDGenerateType,
  CanvasThreeDMode,
  CanvasThreeDResultFormat,
} from "@/types/canvas-three-d";

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
  /** 文本节点生成结果（relay 文本模型回复），卡片内展示 */
  content?: string;
  /** 图片节点生成时选中的风格预设，默认风格不写入。 */
  stylePresetId?: string;
  /** 图片节点选中的风格短名称，用于按钮回显。 */
  stylePresetName?: string;
  /** 图片节点选中的风格提示词快照，用于生成时提交，避免依赖前端硬编码。 */
  stylePresetPrompt?: string;
  stylePresetModelIds?: string[];
  stylePresetModelPrompts?: Record<string, string>;
  /** 图片节点选中的风格封面，用于后续回显或历史恢复。 */
  stylePresetCoverUrl?: string;
  /** 旧项目/跨页启动留下的技能溯源字段。节点自身不再提供 Skill 入口，也不会
      在单节点生成时隐式透传；新运行统一由右侧助手创建 SkillRun。 */
  skillId?: string;
  skillName?: string;
  /**
   * 正在以该节点为输入执行的 SkillRun。它只用于刷新后把运行面板重新锚定到来源节点；
   * 真正的运行状态以服务端 SkillRun 为准，不能复用 taskId/status 的单任务状态机。
   */
  skillRunId?: string;
  /** Skill 产物来源。随 canvasData 持久化，并用 artifactId 防止续跑/重连时重复落节点。 */
  provenance?: {
    skillRunId: string;
    artifactId: string;
    skillId?: string;
    skillVersion?: string;
    stepKey?: string;
  };
  imageSrc?: string;
  /** 组图：一次生成的全部图片(如 Midjourney 一组 4 张)；imageSrc 始终等于其中的「主图」 */
  images?: string[];
  /** 3D 节点的主输出；可能是 GLB/OBJ/STL/USDZ/FBX，具体格式以 modelAssets 为准。 */
  modelSrc?: string;
  /** 3D 供应商返回的封面截图；只用于轻量卡片预览，不替代真实模型。 */
  modelPreviewSrc?: string;
  /** 一次 3D 生成返回的全部可下载格式。导演台会从中优先选择 GLB。 */
  modelAssets?: CanvasThreeDAsset[];
  videoSrc?: string;
  /** 浏览器从实际视频元数据读取的时长与像素尺寸；上传素材没有生成参数时仍可供派生功能使用。 */
  mediaDuration?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  fileSize?: number;
  fileType?: string;
  mimeType?: string;
  /** 语音合成/音乐生成结果（audio 节点）；audioSrc 始终等于当前选中分轨 */
  audioSrc?: string;
  /** 音乐分轨（Suno 一次两首）：url + 歌名 + clip_id（延长/翻唱引用），节点内切换 */
  audioTracks?: { url: string; title?: string; clipId?: string }[];
  status?: "idle" | "generating" | "success" | "error";
  /** 生成中任务号：随画布持久化，重开项目时据此对账续轮（resumeGeneration）；任务终态即清除 */
  taskId?: string;
  /**
   * POST /ai/generate 的响应尚未确认时保存的冻结请求。服务端可能已经建任务并
   * 扣费，刷新后必须以同一 clientRequestId 重放来取回 taskId，不能把节点复位
   * 后让用户重新生成。取得 taskId 或收到确定性拒绝后立即清除。
   */
  pendingGeneration?: CanvasPendingGeneration;
  uploading?: boolean;
  uploadProgress?: number;
  /** 生成时选择的目标画幅；有值时图片节点按该画幅展示，避免结果卡片被自然尺寸改成其它比例 */
  aspectRatio?: string;
  /**
   * 快速开始/历史恢复所用的生成面板快照。模型与质量参数属于节点，而不是
   * 某次组件挂载的临时 state；保存在画布数据里后，快速开始创建的节点再次
   * 选中或刷新页面时仍能回显当时的选择。
   */
  generationConfig?: {
    modelId?: string;
    quality?: string;
    resolution?: string;
    duration?: number;
    batchCount?: number;
    threeDMode?: CanvasThreeDMode;
    enablePbr?: boolean;
    faceCount?: number;
    generateType?: CanvasThreeDGenerateType;
    resultFormat?: CanvasThreeDResultFormat;
    /** 图生 3D 场景的「360° 全景图」手动选择；未设置时按图片比例自动识别。
     *  必须持久化：组件态在面板收起/重开时会丢，导致勾选静默失效。 */
    isPano?: boolean;
  };
  /** 视频节点的派生创作场景；用于恢复对应模式与输入引导。 */
  videoOperation?: "clip_reshoot";
  /** 片段重拍的主来源视频节点；与其它角色/风格参考视频区分。 */
  clipReshootSourceId?: string;
  /** 片段重拍在来源视频上选中的时间区间；最多 5 段，随画布持久化。 */
  clipReshootRanges?: Array<{
    start: number;
    end: number;
  }>;
  /** 逐帧拉片节点的持久化参数与最近一次输出摘要。 */
  videoBreakdown?: {
    frameCount: number;
    framesPerGroup: number;
    lastFrameCount?: number;
    runCount?: number;
    analysisModes?: Array<"storyboard" | "motion" | "music">;
  };
  /** 拉片产出的紧凑分镜帧；仍按普通图片节点参与连接和后续创作。 */
  storyboardFrame?: {
    sourceVideoId: string;
    processorId?: string;
    timeSec: number;
    index: number;
    run?: number;
    shotSize?: string;
    motion?: string;
    description?: string;
    musicCue?: string;
  };
  /** 卡片实际渲染尺寸（按图片比例计算）；供连线层把端点锚定到卡片真实边缘中点，实现默认居中对齐 */
  contentW?: number;
  contentH?: number;
  /** 是否为 360° 全景扩图（image 节点）；为 true 时「全景」按钮直接进 360 查看而非重新生成 */
  is360?: boolean;
  /** 导演台(scene_3d)状态：JSON 字符串（各关节欧拉角/相机球坐标+target/灯光/可选 modelSrc）。
   *  单字段随节点自动序列化保存，无需后端改动；防御性 parse。 */
  scene3d?: string;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  /** 可选的结构化 Skill 输入槽；旧连线没有该字段时继续按连接顺序解释。 */
  targetSlot?: string;
  sourceOutput?: string;
}

/** 分组（libTV 风格）：标题栏 + 自动外扩边框紧贴成员包围盒。一个节点至多属于一个分组。 */
export interface CanvasGroup {
  id: string;
  title: string;
  /** 边框/标题色（hex） */
  color: string;
  /** 成员节点 id（显式归属；边框由成员位置实时计算） */
  nodeIds: string[];
}

/**
 * SkillRun 的画布级消费状态。它独立于 undo 历史：用户撤销/删除产物节点时，
 * 已消费标记仍然保留，避免下一次轮询把相同产物重新插回画布。
 */
export interface CanvasSkillRunPersistence {
  trackedRunIds?: string[];
  materializedArtifactIds?: string[];
}

interface HistorySnapshot {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
}

interface CanvasState {
  nodes: CanvasNode[];
  connections: Connection[];
  groups: CanvasGroup[];
  selectedNodeIds: Set<string>;
  selectedNodeId: string | null; // 兼容字段：单选时为该 ID
  selectedConnectionId: string | null;
  // 视口 transform 已拆到 use-canvas-view-store（性能：平移/缩放高频 set 不应
  // 触发本 store 全部订阅者的 selector 重算）
  /** 当前画布项目数值ID（字符串，雪花），供生成/历史按画布过滤 */
  currentProjectId: string | null;

  /** 需要在刷新后向服务端恢复详情的运行；随 canvasData 持久化。 */
  trackedSkillRunIds: string[];
  /** 已经由该画布消费过的产物；不进入 undo/redo，保证一次物化。 */
  materializedArtifactIds: string[];

  // 历史栈
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  // 节点操作
  addNode: (node: CanvasNode, recordHistory?: boolean) => void;
  /** Skill 多产物一次性落画布：单次 undo、单次 store 通知，避免自动保存中间态。 */
  addNodesAndConnections: (
    nodes: CanvasNode[],
    connections: Connection[],
    selectNodeId?: string,
    groups?: CanvasGroup[],
  ) => void;
  updateNode: (id: string, data: Partial<CanvasNode>, recordHistory?: boolean) => void;
  /** 批量移动节点位置（拖拽多选时使用，单次 set，不记录历史） */
  updateNodePositions: (updates: Array<{ id: string; x: number; y: number }>) => void;
  removeNode: (id: string, recordHistory?: boolean) => void;
  removeNodes: (ids: string[]) => void;

  // 选择操作
  selectNode: (id: string | null) => void;
  toggleSelectNode: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;

  // 连接操作
  addConnection: (conn: Connection, recordHistory?: boolean) => void;
  removeConnection: (id: string, recordHistory?: boolean) => void;
  selectConnection: (id: string | null) => void;

  // 分组操作
  /** 用给定节点创建分组（自动从其它分组中移出这些节点、剔除空分组）；返回新分组 id */
  createGroup: (nodeIds: string[], title?: string) => string | null;
  updateGroup: (id: string, data: Partial<Pick<CanvasGroup, "title" | "color" | "nodeIds">>) => void;
  /** 解组：删除分组框；deleteNodes=true 时连同成员节点一并删除 */
  removeGroup: (id: string, deleteNodes?: boolean) => void;

  setCurrentProjectId: (id: string | null) => void;

  trackSkillRun: (runId: string) => void;
  settleSkillRun: (runId: string) => void;
  markSkillArtifactsMaterialized: (artifactIds: readonly string[]) => void;

  // 画布加载/清空
  loadCanvas: (
    nodes: CanvasNode[],
    connections: Connection[],
    groups?: CanvasGroup[],
    skillRuns?: CanvasSkillRunPersistence,
  ) => void;
  clearCanvas: () => void;

  // Undo/Redo
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

let nodeCounter = 0;
let groupCounter = 0;
const MAX_HISTORY = 50;
// Recovery is only needed for recent/in-flight runs. Bounding this list avoids
// turning a long-lived canvas into hundreds of detail requests on every open;
// provenance and consumed artifact IDs still preserve historical traceability.
const MAX_TRACKED_SKILL_RUNS = 50;

function uniqueNonEmptyStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function restoredSkillRunState(
  nodes: readonly CanvasNode[],
  persisted?: CanvasSkillRunPersistence,
): Required<CanvasSkillRunPersistence> {
  const persistedRunIds = Array.isArray(persisted?.trackedRunIds) ? persisted.trackedRunIds : [];
  const persistedArtifactIds = Array.isArray(persisted?.materializedArtifactIds)
    ? persisted.materializedArtifactIds
    : [];
  return {
    // 旧 canvasData 没有顶层 SkillRun 状态时，从运行锚点和产物来源自动迁移。
    trackedRunIds: uniqueNonEmptyStrings([
      ...persistedRunIds,
      ...nodes.map((node) => node.skillRunId),
      ...nodes.map((node) => node.provenance?.skillRunId),
    ]).slice(-MAX_TRACKED_SKILL_RUNS),
    materializedArtifactIds: uniqueNonEmptyStrings([
      ...persistedArtifactIds,
      ...nodes.map((node) => node.provenance?.artifactId),
    ]),
  };
}

/** 分组默认配色（按现有分组数轮转，相邻分组颜色不同） */
export const GROUP_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444"];

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Canvas JSON is persisted user data, so salvage valid rows instead of letting one bad row crash the page. */
function normalizeLoadedNodes(value: unknown): CanvasNode[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const restored: CanvasNode[] = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    const type = typeof row?.type === "string" ? row.type.trim() : "";
    if (
      !row || !id || !type || seen.has(id)
      || !finiteNumber(row.x) || !finiteNumber(row.y)
      || !finiteNumber(row.width) || row.width <= 0
      || !finiteNumber(row.height) || row.height <= 0
    ) continue;
    seen.add(id);
    restored.push(reviveNode(normalizeNode({
      ...row,
      id,
      type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      title: typeof row.title === "string" ? row.title : type,
    } as CanvasNode), { keepResumable: true }));
  }
  return restored;
}

function normalizeLoadedConnections(value: unknown, nodeIds: ReadonlySet<string>): Connection[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const restored: Connection[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = recordValue(value[index]);
    const sourceId = typeof row?.sourceId === "string" ? row.sourceId : "";
    const targetId = typeof row?.targetId === "string" ? row.targetId : "";
    if (!row || !nodeIds.has(sourceId) || !nodeIds.has(targetId) || sourceId === targetId) continue;
    const targetSlot = typeof row.targetSlot === "string" ? row.targetSlot : undefined;
    const sourceOutput = typeof row.sourceOutput === "string" ? row.sourceOutput : undefined;
    const pair = `${sourceId}\u0000${targetId}\u0000${targetSlot ?? ""}`;
    if (pairs.has(pair)) continue;
    let id = typeof row.id === "string" && row.id.trim()
      ? row.id.trim()
      : `conn_loaded_${index}_${sourceId}_${targetId}`;
    if (ids.has(id)) id = `${id}_${index}`;
    ids.add(id);
    pairs.add(pair);
    restored.push({ id, sourceId, targetId, ...(targetSlot ? { targetSlot } : {}), ...(sourceOutput ? { sourceOutput } : {}) });
  }
  return restored;
}

function normalizeLoadedGroups(value: unknown, nodeIds: ReadonlySet<string>): CanvasGroup[] {
  if (!Array.isArray(value)) return [];
  const groupIds = new Set<string>();
  const assignedNodeIds = new Set<string>();
  const restored: CanvasGroup[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = recordValue(value[index]);
    if (!row || !Array.isArray(row.nodeIds)) continue;
    let id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `group_loaded_${index}`;
    if (groupIds.has(id)) id = `${id}_${index}`;
    const memberIds = [...new Set(row.nodeIds.filter((memberId): memberId is string =>
      typeof memberId === "string" && nodeIds.has(memberId) && !assignedNodeIds.has(memberId),
    ))];
    if (memberIds.length === 0) continue;
    const color = typeof row.color === "string" && /^#[0-9a-f]{6}$/i.test(row.color)
      ? row.color
      : GROUP_COLORS[restored.length % GROUP_COLORS.length];
    groupIds.add(id);
    memberIds.forEach((memberId) => assignedNodeIds.add(memberId));
    restored.push({
      id,
      title: typeof row.title === "string" && row.title.trim() ? row.title : "未命名分组",
      color,
      nodeIds: memberIds,
    });
  }
  return restored;
}

function normalizePromptText(value: string): string {
  if (!value.includes("\\u")) return value;
  let decoded = value;
  for (let i = 0; i < 4; i += 1) {
    const next = decoded.replace(/\\+u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function normalizeNode(node: CanvasNode): CanvasNode {
  return typeof node.prompt === "string" ? { ...node, prompt: normalizePromptText(node.prompt) } : node;
}

function normalizeNodePatch(data: Partial<CanvasNode>): Partial<CanvasNode> {
  return typeof data.prompt === "string" ? { ...data, prompt: normalizePromptText(data.prompt) } : data;
}

export function generateNodeId(): string {
  return `node_${Date.now()}_${++nodeCounter}`;
}

export function generateGroupId(): string {
  return `group_${Date.now()}_${++groupCounter}`;
}

/** 从各分组中剔除指定节点 id，并丢弃因此变空的分组 */
function pruneGroups(groups: CanvasGroup[], removed: Set<string>): CanvasGroup[] {
  if (removed.size === 0) return groups;
  return groups
    .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => !removed.has(id)) }))
    .filter((g) => g.nodeIds.length > 0);
}

/** 落地持久化数据时清洗瞬态状态:上传器活在页面会话里,关页即死。
 *  生成中节点分两类:带 taskId 的交由 resumeGeneration() 按任务号续轮,加载时
 *  (keepResumable)保留转圈状态;没有 taskId 的(旧数据/请求在途时关页)无从续轮,
 *  必须清洗——否则节点永久转圈、按钮永久禁用。
 *  克隆(复制/粘贴)一律不传 keepResumable:轮询登记按 nodeId 对账,克隆体若继承
 *  taskId 会与原节点争抢同一任务,或在原任务已终态时永久转圈。 */
export function reviveNode(node: CanvasNode, opts?: { keepResumable?: boolean }): CanvasNode {
  const stuckGenerating = node.status === "generating";
  const clonedActiveSkillRun = !opts?.keepResumable && !!node.skillRunId;
  if (opts?.keepResumable && stuckGenerating && (node.taskId || node.pendingGeneration)) {
    return node.uploading ? { ...node, uploading: false, uploadProgress: undefined } : node;
  }
  if (!stuckGenerating && !node.uploading && !node.taskId && !node.pendingGeneration && !clonedActiveSkillRun) return node;
  const hasResult = !!(node.imageSrc || node.videoSrc || node.audioSrc || node.modelSrc || node.content);
  return {
    ...node,
    status: stuckGenerating ? (hasResult ? "success" : "idle") : node.status,
    taskId: undefined,
    pendingGeneration: undefined,
    skillRunId: clonedActiveSkillRun ? undefined : node.skillRunId,
    uploading: false,
    uploadProgress: undefined,
  };
}

/** 拷贝当前 nodes+connections+groups 用于历史快照 */
function snapshot(state: { nodes: CanvasNode[]; connections: Connection[]; groups: CanvasGroup[] }): HistorySnapshot {
  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    connections: state.connections.map((c) => ({ ...c })),
    groups: state.groups.map((g) => ({ ...g, nodeIds: [...g.nodeIds] })),
  };
}

/**
 * A generating node is also the durable recovery receipt for a paid request.
 * It must not disappear merely because the user restores an older visual
 * editing snapshot: doing so would orphan the accepted task and make a second
 * click look safe even though the first request may already have been charged.
 */
function hasRecoverableGeneration(node: CanvasNode): boolean {
  return node.status === "generating" && !!(node.taskId || node.pendingGeneration);
}

/** Fields written by the generation lifecycle, rather than ordinary canvas history. */
function keepGenerationState(historical: CanvasNode, current: CanvasNode): CanvasNode {
  return normalizeNode({
    ...historical,
    status: current.status,
    taskId: current.taskId,
    pendingGeneration: current.pendingGeneration,
    imageSrc: current.imageSrc,
    images: current.images,
    videoSrc: current.videoSrc,
    audioSrc: current.audioSrc,
    audioTracks: current.audioTracks,
    modelSrc: current.modelSrc,
    modelPreviewSrc: current.modelPreviewSrc,
    modelAssets: current.modelAssets,
    content: current.content,
    fileSize: current.fileSize,
    fileType: current.fileType,
    mimeType: current.mimeType,
    aspectRatio: current.aspectRatio,
    height: current.height,
    contentW: current.contentW,
    contentH: current.contentH,
    is360: current.is360,
  });
}

/**
 * Undo/redo applies only the editable canvas snapshot. Paid generation state is
 * reconciled from the live node. Historical snapshots captured while a task
 * was running are also scrubbed after that task settles, so redo cannot revive
 * a stale spinner/task id.
 */
function restoreHistoryNodes(currentNodes: CanvasNode[], historicalNodes: CanvasNode[]): CanvasNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const restoredIds = new Set(historicalNodes.map((node) => node.id));
  const restored = historicalNodes.map((historical) => {
    const current = currentById.get(historical.id);
    if (current && hasRecoverableGeneration(current)) {
      return keepGenerationState(historical, current);
    }
    if (current && (historical.status === "generating" || historical.taskId || historical.pendingGeneration)) {
      return keepGenerationState(historical, current);
    }
    return reviveNode(historical);
  });

  // Undoing the creation of a node that already owns an accepted request must
  // keep that node until the request reaches a terminal state. It can be
  // deleted normally afterwards.
  for (const current of currentNodes) {
    if (hasRecoverableGeneration(current) && !restoredIds.has(current.id)) restored.push(current);
  }
  return restored;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  connections: [],
  groups: [],
  selectedNodeIds: new Set(),
  selectedNodeId: null,
  selectedConnectionId: null,
  currentProjectId: null,
  trackedSkillRunIds: [],
  materializedArtifactIds: [],
  undoStack: [],
  redoStack: [],

  selectConnection: (id) => set(id
    ? { selectedConnectionId: id, selectedNodeIds: new Set(), selectedNodeId: null }
    : { selectedConnectionId: null }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  trackSkillRun: (runId) => set((state) => {
    if (!runId || state.trackedSkillRunIds.includes(runId)) return state;
    return {
      trackedSkillRunIds: [...state.trackedSkillRunIds, runId].slice(-MAX_TRACKED_SKILL_RUNS),
    };
  }),

  settleSkillRun: (runId) => set((state) => {
    const hasAnchor = state.nodes.some((node) => node.skillRunId === runId);
    const alreadyTracked = state.trackedSkillRunIds.includes(runId);
    if (!hasAnchor && alreadyTracked) return state;
    return {
      nodes: hasAnchor
        ? state.nodes.map((node) => node.skillRunId === runId ? { ...node, skillRunId: undefined } : node)
        : state.nodes,
      trackedSkillRunIds: alreadyTracked
        ? state.trackedSkillRunIds
        : [...state.trackedSkillRunIds, runId].slice(-MAX_TRACKED_SKILL_RUNS),
    };
  }),

  markSkillArtifactsMaterialized: (artifactIds) => set((state) => {
    const additions = uniqueNonEmptyStrings(artifactIds)
      .filter((artifactId) => !state.materializedArtifactIds.includes(artifactId));
    if (additions.length === 0) return state;
    return { materializedArtifactIds: [...state.materializedArtifactIds, ...additions] };
  }),

  pushHistory: () => set((state) => ({
    undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
    redoStack: [],
  })),

  undo: () => set((state) => {
    if (state.undoStack.length === 0) return state;
    const prev = state.undoStack[state.undoStack.length - 1];
    const currentSnap = snapshot(state);
    return {
      nodes: restoreHistoryNodes(state.nodes, prev.nodes),
      connections: prev.connections,
      groups: prev.groups,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnap],
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      // 回滚可能删掉当前选中的连线,悬空 id 会让 Delete 键触发无效删除并污染历史
      selectedConnectionId: null,
    };
  }),

  redo: () => set((state) => {
    if (state.redoStack.length === 0) return state;
    const next = state.redoStack[state.redoStack.length - 1];
    const currentSnap = snapshot(state);
    return {
      nodes: restoreHistoryNodes(state.nodes, next.nodes),
      connections: next.connections,
      groups: next.groups,
      undoStack: [...state.undoStack, currentSnap],
      redoStack: state.redoStack.slice(0, -1),
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      selectedConnectionId: null,
    };
  }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  addNode: (node, recordHistory = true) => set((state) => {
    if (!node.id || state.nodes.some((candidate) => candidate.id === node.id)) return state;
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      nodes: [...state.nodes, normalizeNode(node)],
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  addNodesAndConnections: (nodes, connections, selectNodeId, groups = []) => set((state) => {
    const existingNodeIds = new Set(state.nodes.map((node) => node.id));
    const collidedNodeIds = new Set(nodes
      .map((node) => node.id)
      .filter((id) => existingNodeIds.has(id)));
    const nextNodes = nodes.filter((node, index, list) =>
      !existingNodeIds.has(node.id) && list.findIndex((candidate) => candidate.id === node.id) === index,
    );
    const availableNodeIds = new Set([...existingNodeIds, ...nextNodes.map((node) => node.id)]);
    const existingConnectionIds = new Set(state.connections.map((connection) => connection.id));
    const existingPairs = new Set(state.connections.map((connection) => `${connection.sourceId}\u0000${connection.targetId}\u0000${connection.targetSlot ?? ""}`));
    const nextConnections = connections.filter((connection, index, list) => {
      if (connection.sourceId === connection.targetId) return false;
      if (collidedNodeIds.has(connection.sourceId) || collidedNodeIds.has(connection.targetId)) return false;
      if (!availableNodeIds.has(connection.sourceId) || !availableNodeIds.has(connection.targetId)) return false;
      if (existingConnectionIds.has(connection.id)) return false;
      if (list.findIndex((candidate) => candidate.id === connection.id) !== index) return false;
      const pair = `${connection.sourceId}\u0000${connection.targetId}\u0000${connection.targetSlot ?? ""}`;
      if (existingPairs.has(pair)) return false;
      return list.findIndex((candidate) =>
        `${candidate.sourceId}\u0000${candidate.targetId}\u0000${candidate.targetSlot ?? ""}` === pair,
      ) === index;
    });
    const existingGroupIds = new Set(state.groups.map((group) => group.id));
    const nextGroups = groups
      .filter((group, index, list) =>
        !existingGroupIds.has(group.id)
        && list.findIndex((candidate) => candidate.id === group.id) === index,
      )
      .map((group) => ({
        ...group,
        nodeIds: [...new Set(group.nodeIds.filter((id) => availableNodeIds.has(id)))],
      }))
      .filter((group) => group.nodeIds.length > 0);
    if (nextNodes.length === 0 && nextConnections.length === 0 && nextGroups.length === 0) return state;

    const canSelect = !!selectNodeId && availableNodeIds.has(selectNodeId);
    const groupedNodeIds = new Set(nextGroups.flatMap((group) => group.nodeIds));
    return {
      nodes: [...state.nodes, ...nextNodes.map(normalizeNode)],
      connections: [...state.connections, ...nextConnections],
      groups: [...pruneGroups(state.groups, groupedNodeIds), ...nextGroups],
      selectedNodeId: canSelect ? selectNodeId! : state.selectedNodeId,
      selectedNodeIds: canSelect ? new Set([selectNodeId]) : state.selectedNodeIds,
      undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
      redoStack: [],
    };
  }),

  updateNode: (id, data, recordHistory = false) => set((state) => {
    // 上传/生成等异步回调可能晚于节点删除返回。不存在的目标必须是严格
    // no-op，否则一次迟到的成功回调会凭空压入撤销历史并清空 redo。
    if (!state.nodes.some((node) => node.id === id)) return state;
    // 拖拽更新太频繁，默认不记录历史
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      nodes: state.nodes.map((n) => (n.id === id ? normalizeNode({ ...n, ...normalizeNodePatch(data) }) : n)),
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  updateNodePositions: (updates) => set((state) => {
    if (updates.length === 0) return state;
    const map = new Map(updates.map((u) => [u.id, u]));
    return {
      nodes: state.nodes.map((n) => {
        const u = map.get(n.id);
        return u ? { ...n, x: u.x, y: u.y } : n;
      }),
    };
  }),

  removeNode: (id, recordHistory = true) => set((state) => {
    // 目标不存在时不做空操作:否则仍会压一条无效历史并清掉 redo 栈
    const target = state.nodes.find((n) => n.id === id);
    if (!target || hasRecoverableGeneration(target)) return state;
    const newSel = new Set(state.selectedNodeIds);
    newSel.delete(id);
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    const connections = state.connections.filter((c) => c.sourceId !== id && c.targetId !== id);
    return {
      nodes: state.nodes.filter((n) => n.id !== id),
      connections,
      groups: pruneGroups(state.groups, new Set([id])),
      selectedNodeIds: newSel,
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      // 选中的连线可能随节点一起被删,悬空引用需同步清掉
      selectedConnectionId: connections.some((c) => c.id === state.selectedConnectionId)
        ? state.selectedConnectionId
        : null,
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  removeNodes: (ids) => set((state) => {
    const requested = new Set(ids);
    const idSet = new Set(
      state.nodes
        .filter((node) => requested.has(node.id) && !hasRecoverableGeneration(node))
        .map((node) => node.id),
    );
    if (idSet.size === 0) return state;
    const connections = state.connections.filter((c) => !idSet.has(c.sourceId) && !idSet.has(c.targetId));
    return {
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      connections,
      groups: pruneGroups(state.groups, idSet),
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      selectedConnectionId: connections.some((c) => c.id === state.selectedConnectionId)
        ? state.selectedConnectionId
        : null,
      undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
      redoStack: [],
    };
  }),

  selectNode: (id) => set(() => ({
    selectedNodeId: id,
    selectedNodeIds: id ? new Set([id]) : new Set(),
    ...(id ? { selectedConnectionId: null } : {}),
  })),

  toggleSelectNode: (id) => set((state) => {
    const newSel = new Set(state.selectedNodeIds);
    if (newSel.has(id)) {
      newSel.delete(id);
    } else {
      newSel.add(id);
    }
    return {
      selectedNodeIds: newSel,
      selectedNodeId: newSel.size === 1 ? Array.from(newSel)[0] : null,
      selectedConnectionId: null,
    };
  }),

  selectMany: (ids) => set(() => ({
    selectedNodeIds: new Set(ids),
    selectedNodeId: ids.length === 1 ? ids[0] : null,
    selectedConnectionId: null,
  })),

  clearSelection: () => set({
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    selectedConnectionId: null,
  }),

  selectAll: () => set((state) => ({
    selectedNodeIds: new Set(state.nodes.map((n) => n.id)),
    selectedNodeId: state.nodes.length === 1 ? state.nodes[0].id : null,
    selectedConnectionId: null,
  })),

  addConnection: (conn, recordHistory = true) => set((state) => {
    if (
      conn.sourceId === conn.targetId
      || !state.nodes.some((node) => node.id === conn.sourceId)
      || !state.nodes.some((node) => node.id === conn.targetId)
      || state.connections.some((candidate) =>
        candidate.id === conn.id
        || (
          candidate.sourceId === conn.sourceId
          && candidate.targetId === conn.targetId
          && (candidate.targetSlot ?? "") === (conn.targetSlot ?? "")
        ),
      )
    ) return state;
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      connections: [...state.connections, conn],
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  removeConnection: (id, recordHistory = true) => set((state) => {
    // 悬空 id(如撤销掉选中连线后按 Delete)不做空操作,避免压无效历史清掉 redo
    if (!state.connections.some((c) => c.id === id)) return state;
    const undo = recordHistory ? [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)] : state.undoStack;
    return {
      connections: state.connections.filter((c) => c.id !== id),
      selectedConnectionId: state.selectedConnectionId === id ? null : state.selectedConnectionId,
      undoStack: undo,
      redoStack: recordHistory ? [] : state.redoStack,
    };
  }),

  createGroup: (nodeIds, title) => {
    const state = get();
    const valid = [...new Set(nodeIds.filter((id) => state.nodes.some((n) => n.id === id)))];
    if (valid.length === 0) return null;
    const idSet = new Set(valid);
    const id = generateGroupId();
    // 先把这些节点从其它分组移出（保证唯一归属），再追加新分组
    const cleaned = pruneGroups(state.groups, idSet);
    const color = GROUP_COLORS[state.groups.length % GROUP_COLORS.length];
    const group: CanvasGroup = { id, title: title || "未命名分组", color, nodeIds: valid };
    set({
      groups: [...cleaned, group],
      undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
      redoStack: [],
    });
    return id;
  },

  updateGroup: (id, data) => set((state) => {
    if (!state.groups.some((group) => group.id === id)) return state;
    return {
      groups: state.groups.map((g) => (g.id === id ? { ...g, ...data } : g)),
      undoStack: [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)],
      redoStack: [],
    };
  }),

  removeGroup: (id, deleteNodes = false) => set((state) => {
    const group = state.groups.find((g) => g.id === id);
    if (!group) return state;
    const undo = [...state.undoStack.slice(-MAX_HISTORY + 1), snapshot(state)];
    if (group && deleteNodes) {
      const requested = new Set(group.nodeIds);
      const memberIds = new Set(
        state.nodes
          .filter((node) => requested.has(node.id) && !hasRecoverableGeneration(node))
          .map((node) => node.id),
      );
      return {
        nodes: state.nodes.filter((n) => !memberIds.has(n.id)),
        connections: state.connections.filter((c) => !memberIds.has(c.sourceId) && !memberIds.has(c.targetId)),
        groups: state.groups.filter((g) => g.id !== id),
        selectedNodeIds: new Set(),
        selectedNodeId: null,
        selectedConnectionId: state.connections.some((connection) =>
          connection.id === state.selectedConnectionId
          && !memberIds.has(connection.sourceId)
          && !memberIds.has(connection.targetId),
        ) ? state.selectedConnectionId : null,
        undoStack: undo,
        redoStack: [],
      };
    }
    return {
      groups: state.groups.filter((g) => g.id !== id),
      undoStack: undo,
      redoStack: [],
    };
  }),

  loadCanvas: (nodes, connections, groups = [], skillRuns) => {
    const restoredNodes = normalizeLoadedNodes(nodes);
    const restoredNodeIds = new Set(restoredNodes.map((node) => node.id));
    const restoredConnections = normalizeLoadedConnections(connections, restoredNodeIds);
    const restoredGroups = normalizeLoadedGroups(groups, restoredNodeIds);
    const restoredRuns = restoredSkillRunState(restoredNodes, skillRuns);
    set({
      nodes: restoredNodes,
      connections: restoredConnections,
      groups: restoredGroups,
      trackedSkillRunIds: restoredRuns.trackedRunIds,
      materializedArtifactIds: restoredRuns.materializedArtifactIds,
      selectedNodeIds: new Set(),
      selectedNodeId: null,
      selectedConnectionId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  clearCanvas: () => set({
    nodes: [],
    connections: [],
    groups: [],
    trackedSkillRunIds: [],
    materializedArtifactIds: [],
    selectedNodeIds: new Set(),
    selectedNodeId: null,
    selectedConnectionId: null,
    undoStack: [],
    redoStack: [],
  }),
}));
