import type { SkillRunAssetInput, SkillRunCreateDTO } from "@/types/skill-run";
import type { CanvasNode, Connection } from "@/stores/use-canvas-store";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";

interface CanvasSnapshot {
  nodes: CanvasNode[];
  connections: Connection[];
}

interface SourceOptions {
  /** 节点顶部入口：当前节点优先，随后按连线落库顺序加入所有入边。 */
  triggerNodeId?: string;
  /** 画布级入口：显式多选覆盖自动入边收集。 */
  sourceNodeIds?: readonly string[];
}

interface BuildOptions extends SourceOptions {
  prompt?: string;
  parameters?: Record<string, unknown>;
}

function uniqueExistingNodes(nodes: CanvasNode[], ids: readonly string[]): CanvasNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const node = byId.get(id);
    return node ? [node] : [];
  });
}

/**
 * 统一解析 Skill 来源。多选入口只使用多选；节点顶部入口则使用「当前节点 + 入边」。
 * 这避免了每个节点组件分别维护一套素材拼装规则。
 */
export function resolveCanvasSkillSources(
  snapshot: CanvasSnapshot,
  options: SourceOptions,
): CanvasNode[] {
  if (options.sourceNodeIds?.length) {
    return uniqueExistingNodes(snapshot.nodes, options.sourceNodeIds);
  }
  if (!options.triggerNodeId) return [];

  const incomingIds = snapshot.connections
    .filter((connection) => connection.targetId === options.triggerNodeId)
    .map((connection) => connection.sourceId);
  return uniqueExistingNodes(snapshot.nodes, [options.triggerNodeId, ...incomingIds]);
}

function roleOf(node: CanvasNode): string {
  switch (node.type) {
    case CHARACTER_NODE_TYPE:
      return "character";
    case SCENE_NODE_TYPE:
      return "scene";
    case "script":
      return "script";
    case "text":
      return "text";
    case "video":
      return "video";
    case "audio":
      return "audio";
    default:
      return "reference";
  }
}

function commonAsset(node: CanvasNode, role: string) {
  return {
    nodeId: node.id,
    nodeType: node.type,
    role,
    name: node.title,
    metadata: {
      fileSize: node.fileSize,
      fileType: node.fileType,
      mimeType: node.mimeType,
      aspectRatio: node.aspectRatio,
      is360: node.is360,
    },
  } satisfies Partial<SkillRunAssetInput>;
}

/** 一个画布节点可展开成多个 Skill 输入（例如节点内的一组图片）。 */
export function canvasNodeToSkillAssets(node: CanvasNode, roleOverride?: string): SkillRunAssetInput[] {
  const role = roleOverride?.trim() || roleOf(node);
  const common = commonAsset(node, role);

  if (node.type === "video" && node.videoSrc) {
    return [{ type: "video", url: node.videoSrc, ...common }];
  }
  if (node.type === "audio" && node.audioSrc) {
    return [{ type: "audio", url: node.audioSrc, ...common }];
  }
  if (node.type === "text" || node.type === "script") {
    const content = node.content?.trim() || node.prompt?.trim();
    return content ? [{ type: "text", content, ...common }] : [];
  }

  const imageUrls = [...new Set([node.imageSrc, ...(node.images ?? [])].filter((url): url is string => !!url))];
  if (imageUrls.length > 0) {
    return imageUrls.map((url, index) => ({
      type: "image",
      url,
      ...common,
      metadata: { ...common.metadata, imageIndex: index },
    }));
  }

  // 尚未出图的角色/场景也可以用设定文本驱动工作流。
  const content = node.prompt?.trim() || node.content?.trim();
  return content ? [{ type: "text", content, ...common }] : [];
}

function suggestedPrompt(nodes: CanvasNode[]): string {
  return nodes
    .flatMap((node) => {
      const content = node.type === "text" || node.type === "script"
        ? node.content?.trim() || node.prompt?.trim()
        : node.type === CHARACTER_NODE_TYPE || node.type === SCENE_NODE_TYPE
          ? node.prompt?.trim()
          : "";
      if (!content) return [];
      const prefix = node.title?.trim() ? `${node.title.trim()}：` : "";
      return [`${prefix}${content}`];
    })
    .join("\n");
}

export function buildCanvasSkillRunInput(
  snapshot: CanvasSnapshot,
  options: BuildOptions,
): SkillRunCreateDTO["input"] {
  const sources = resolveCanvasSkillSources(snapshot, options);
  const slotBySourceId = new Map<string, string>();
  if (options.triggerNodeId) {
    for (const connection of snapshot.connections) {
      if (connection.targetId === options.triggerNodeId && connection.targetSlot) {
        slotBySourceId.set(connection.sourceId, connection.targetSlot);
      }
    }
  }

  return {
    prompt: options.prompt?.trim() || suggestedPrompt(sources),
    assets: sources.flatMap((node) => canvasNodeToSkillAssets(node, slotBySourceId.get(node.id))),
    sourceNodeIds: sources.map((node) => node.id),
    parameters: options.parameters ?? {},
  };
}
