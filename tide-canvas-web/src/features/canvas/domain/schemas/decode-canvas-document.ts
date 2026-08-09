import type {
  CanvasDocumentSnapshot,
  CanvasGroup,
  CanvasNode,
  CanvasSkillRunPersistence,
  Connection,
} from "../models/canvas-document";
import {
  persistedCanvasGroupSchema,
  persistedCanvasDocumentSchema,
  persistedCanvasNodeSchema,
  persistedConnectionSchema,
  type ParsedPersistedCanvasDocument,
} from "./persisted-canvas.schema";

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 240;
const DEFAULT_GROUP_COLOR = "#3b82f6";

export interface DecodedCanvasDocument {
  document: CanvasDocumentSnapshot;
  /** 不属于标准结构的顶层字段，保存时必须继续带回。 */
  extensions: Record<string, unknown>;
  warnings: string[];
}

function emptyDocument(): CanvasDocumentSnapshot {
  return { nodes: [], connections: [], groups: [], skillRuns: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueId(candidate: string | undefined, prefix: string, index: number, used: Set<string>): string {
  const base = candidate?.trim() || `${prefix}_${index + 1}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeNodes(parsed: ParsedPersistedCanvasDocument, warnings: string[]): CanvasNode[] {
  const used = new Set<string>();
  return parsed.nodes.flatMap((candidate, index) => {
    const result = persistedCanvasNodeSchema.safeParse(candidate);
    if (!result.success) {
      warnings.push(`节点 ${index + 1} 的结构不合法，已隔离`);
      return [];
    }
    const raw = result.data;
    const id = uniqueId(raw.id, "legacy_node", index, used);
    if (!raw.id || id !== raw.id) warnings.push(`节点 ${index + 1} 的 ID 缺失或重复，已安全补全`);
    const type = raw.type?.trim() || "unknown";
    const normalized = {
      ...raw,
      id,
      type,
      x: finiteNumber(raw.x, 0),
      y: finiteNumber(raw.y, 0),
      width: positiveNumber(raw.width, DEFAULT_NODE_WIDTH),
      height: positiveNumber(raw.height, DEFAULT_NODE_HEIGHT),
      title: raw.title?.trim() || `${type} 节点`,
    };

    // Zod 已在边界验证基础字段；宽松字段通过索引签名继续保留。
    return [normalized as CanvasNode];
  });
}

function normalizeConnections(
  parsed: ParsedPersistedCanvasDocument,
  nodeIds: ReadonlySet<string>,
  warnings: string[],
): Connection[] {
  const used = new Set<string>();
  const normalized: Connection[] = [];

  parsed.connections.forEach((candidate, index) => {
    const result = persistedConnectionSchema.safeParse(candidate);
    if (!result.success) {
      warnings.push(`连接 ${index + 1} 的结构不合法，已隔离`);
      return;
    }
    const raw = result.data;
    if (!raw.sourceId || !raw.targetId || !nodeIds.has(raw.sourceId) || !nodeIds.has(raw.targetId)) {
      warnings.push(`连接 ${index + 1} 引用了不存在的节点，已隔离`);
      return;
    }
    const id = uniqueId(raw.id, `legacy_connection_${raw.sourceId}_${raw.targetId}`, index, used);
    normalized.push({ ...raw, id, sourceId: raw.sourceId, targetId: raw.targetId });
  });
  return normalized;
}

function normalizeGroups(
  parsed: ParsedPersistedCanvasDocument,
  nodeIds: ReadonlySet<string>,
  warnings: string[],
): CanvasGroup[] {
  const used = new Set<string>();
  return parsed.groups.flatMap((candidate, index) => {
    const result = persistedCanvasGroupSchema.safeParse(candidate);
    if (!result.success) {
      warnings.push(`分组 ${index + 1} 的结构不合法，已隔离`);
      return [];
    }
    const raw = result.data;
    const memberIds = [...new Set(raw.nodeIds.filter((id) => nodeIds.has(id)))];
    if (memberIds.length === 0) {
      if (raw.nodeIds.length > 0) warnings.push(`分组 ${index + 1} 不再包含有效节点，已隔离`);
      return [];
    }
    return [{
      ...raw,
      id: uniqueId(raw.id, "legacy_group", index, used),
      title: raw.title?.trim() || `分组 ${index + 1}`,
      color: raw.color?.trim() || DEFAULT_GROUP_COLOR,
      nodeIds: memberIds,
    }];
  });
}

function normalizeSkillRuns(value: unknown): CanvasSkillRunPersistence {
  if (!isRecord(value)) return {};
  const strings = (candidate: unknown): string[] | undefined => {
    if (!Array.isArray(candidate)) return undefined;
    return [...new Set(candidate.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
  };
  return {
    ...value,
    trackedRunIds: strings(value.trackedRunIds),
    materializedArtifactIds: strings(value.materializedArtifactIds),
  };
}

function extensionsOf(parsed: ParsedPersistedCanvasDocument): Record<string, unknown> {
  const documentKeys = new Set(["nodes", "connections", "groups", "skillRuns", "skillRunState"]);
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !documentKeys.has(key)),
  );
}

/** 解析服务端 canvasData；任何失败都返回可渲染的空文档，而不是把异常抛进 React 树。 */
export function decodeCanvasDocument(serialized: string): DecodedCanvasDocument {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return {
      document: emptyDocument(),
      extensions: {},
      warnings: ["画布 JSON 无法解析，已使用空画布降级"],
    };
  }

  const warnings: string[] = [];
  if (isRecord(value)) {
    const labels: Record<string, string> = {
      nodes: "节点集合",
      connections: "连接集合",
      groups: "分组集合",
    };
    Object.entries(labels).forEach(([field, label]) => {
      if (value[field] !== undefined && !Array.isArray(value[field])) {
        warnings.push(`${label}不是数组，已使用空集合降级`);
      }
    });
  }

  const result = persistedCanvasDocumentSchema.safeParse(value);
  if (!result.success) {
    return {
      document: emptyDocument(),
      extensions: {},
      warnings: [...warnings, "画布顶层结构不合法，已使用空画布降级"],
    };
  }

  const nodes = normalizeNodes(result.data, warnings);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    document: {
      nodes,
      connections: normalizeConnections(result.data, nodeIds, warnings),
      groups: normalizeGroups(result.data, nodeIds, warnings),
      skillRuns: normalizeSkillRuns(result.data.skillRuns ?? result.data.skillRunState),
    },
    extensions: extensionsOf(result.data),
    warnings,
  };
}
