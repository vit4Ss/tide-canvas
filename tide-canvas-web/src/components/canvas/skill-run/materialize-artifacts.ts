import { createNode } from "@/lib/canvas-helpers";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";
import type { CanvasNode, Connection } from "@/stores/use-canvas-store";
import type { SkillRunArtifactVO, SkillRunVO } from "@/types/skill-run";

interface MaterializeOptions {
  run: SkillRunVO;
  artifacts: readonly SkillRunArtifactVO[];
  nodes: readonly CanvasNode[];
  sourceNodeIds?: readonly string[];
}

export interface MaterializedSkillArtifacts {
  nodes: CanvasNode[];
  connections: Connection[];
}

function outputNodeType(artifact: SkillRunArtifactVO): string | null {
  const preferred = artifact.preferredNodeType;
  if (artifact.type === "image" && (preferred === CHARACTER_NODE_TYPE || preferred === SCENE_NODE_TYPE)) {
    return preferred;
  }
  switch (artifact.type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "text":
      return "text";
    default:
      return null;
  }
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-64);
}

function artifactNodePatch(artifact: SkillRunArtifactVO): Partial<CanvasNode> | null {
  switch (artifact.type) {
    case "image":
      return artifact.url ? { imageSrc: artifact.url } : null;
    case "video":
      return artifact.url ? { videoSrc: artifact.url } : null;
    case "audio":
      return artifact.url ? { audioSrc: artifact.url } : null;
    case "text":
      {
        const textValue = (artifact as SkillRunArtifactVO & { text?: string }).text?.trim() || artifact.content?.trim();
        return textValue ? { content: textValue } : null;
      }
    default:
      return null;
  }
}

function metadataRecord(metadata: SkillRunArtifactVO["metadata"]): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (typeof metadata === "string") {
    try {
      const parsed: unknown = JSON.parse(metadata);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }
  return metadata;
}

function metadataString(metadata: SkillRunArtifactVO["metadata"], key: string): string | undefined {
  const value = metadataRecord(metadata)?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Skill artifact -> 普通画布节点。输出类型只由 artifact 决定，不继承来源角色/场景类型。
 * `preferredNodeType` 只有显式为 character/scene 时才允许创建概念节点。
 */
export function buildSkillArtifactNodes(options: MaterializeOptions): MaterializedSkillArtifacts {
  const existingArtifactIds = new Set(
    options.nodes.flatMap((node) => node.provenance?.artifactId ? [node.provenance.artifactId] : []),
  );
  const sourceNodes = options.sourceNodeIds
    ?.map((id) => options.nodes.find((node) => node.id === id))
    .filter((node): node is CanvasNode => !!node) ?? [];
  const anchor = sourceNodes[0];
  const startX = anchor ? anchor.x + (anchor.contentW ?? anchor.width) + 96 : 80;
  const startY = anchor?.y ?? 80;
  const pending: CanvasNode[] = [];
  const connections: Connection[] = [];

  for (const artifact of options.artifacts) {
    if (!artifact.id || existingArtifactIds.has(artifact.id)) continue;
    const type = outputNodeType(artifact);
    const patch = artifactNodePatch(artifact);
    if (!type || !patch) continue;

    const index = pending.length;
    const column = index % 2;
    const row = Math.floor(index / 2);
    const provisional = createNode(type, 0, 0, [...options.nodes, ...pending]);
    const aspectRatio = metadataString(artifact.metadata, "aspectRatio") ?? metadataString(artifact.metadata, "aspect_ratio");
    const node: CanvasNode = {
      ...provisional,
      x: startX + column * 680,
      y: startY + row * 470,
      title: artifact.title?.trim() || provisional.title,
      status: "success",
      ...patch,
      ...(aspectRatio ? { aspectRatio } : {}),
      provenance: {
        skillRunId: options.run.id,
        artifactId: artifact.id,
        skillId: options.run.skillId,
        skillVersion: options.run.skillVersionId,
        stepKey: artifact.stepId,
      },
    };
    pending.push(node);
    existingArtifactIds.add(artifact.id);

    if (anchor) {
      connections.push({
        id: `conn_skill_${safeIdPart(options.run.id)}_${safeIdPart(artifact.id)}`,
        sourceId: anchor.id,
        targetId: node.id,
        sourceOutput: artifact.role,
      });
    }
  }

  return { nodes: pending, connections };
}
