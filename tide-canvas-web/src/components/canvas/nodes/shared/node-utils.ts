import { toast } from "@/components/shared/toast";
import { referenceKindFromMeta, resolveModelReferenceLimitBytes, validateKnownFileSize } from "@/lib/upload-limits";
import type { CanvasNode } from "@/stores/use-canvas-store";
import type { AiModelVO } from "@/types/ai";
import type { SkillVO } from "@/types/skill";
import { inlineTextRefs } from "../prompt-ref-utils";

/** 阻止画布拖拽的通用 mousedown 拦截（媒体节点的工具栏/面板到处在用） */
export const stopEvent = (e: React.MouseEvent) => e.stopPropagation();

/** 模型 config 是后台维护的 JSON 字符串；解析失败按空配置处理（各维度选择器据此回退默认档位） */
export function parseModelConfig<T extends object>(model?: AiModelVO): Partial<T> {
  if (!model?.config) return {};
  try {
    const parsed: unknown = JSON.parse(model.config);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : {};
  } catch {
    return {};
  }
}

type CanvasSnapshot = {
  connections: { targetId: string; sourceId: string }[];
  nodes: CanvasNode[];
};

/** 入边源节点（保持连接遍历序：refs 的「图片N/文本N」编号与生成时的下发顺序同源） */
export function getIncomingSources(st: CanvasSnapshot, nodeId: string): CanvasNode[] {
  return st.connections
    .filter((c) => c.targetId === nodeId)
    .map((c) => st.nodes.find((n) => n.id === c.sourceId))
    .filter((n): n is CanvasNode => !!n);
}

/** 入边文本节点的正文拼进 prompt（文本节点没有独立下发通道，顺序与 refs 的「文本N」编号同源） */
export function inlineIncomingTextRefs(prompt: string, sources: CanvasNode[]): string {
  return inlineTextRefs(
    prompt,
    sources
      .filter((n) => n.type === "text" && n.content?.trim())
      .map((n, i) => ({ label: `文本${i + 1}`, content: n.content || "" })),
  );
}

/** 生成前校验参考素材的已知文件大小（按所选模型的参考上限）；不通过则弹错并返回 false */
export function validateReferenceFileSizes(refNodes: CanvasNode[], selectedModel: AiModelVO | undefined): boolean {
  for (const refNode of refNodes) {
    const kind = referenceKindFromMeta({ fileType: refNode.fileType, mimeType: refNode.mimeType, type: refNode.type });
    const message = validateKnownFileSize(refNode.fileSize, refNode.title, {
      maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
      label: "参考文件",
    });
    if (message) {
      toast.error(message);
      return false;
    }
  }
  return true;
}

/** 技能指定了模型卡且存在 → 切换并提示（切换后不合法的档位由调用方的校正 effect 收敛） */
export function switchSkillModel(s: SkillVO, models: AiModelVO[], selectedModelId: string, setSelectedModelId: (id: string) => void) {
  if (s.modelId && models.some((m) => m.modelId === s.modelId) && s.modelId !== selectedModelId) {
    setSelectedModelId(s.modelId);
    toast.info("已切换到技能指定模型");
  }
}

/** 「右侧生成结果节点」类操作的落位：源卡片右侧一列，叠到列内已有节点（含上次结果）下方。
 *  offsetW 决定列的横向位置（源卡片宽），spanW 决定列相交判断的宽度（通常为结果卡片宽）。 */
export function findRightColumnSpot(nodes: CanvasNode[], node: CanvasNode, offsetW: number, spanW: number): { x: number; y: number } {
  const targetX = node.x + offsetW + 80;
  const colNodes = nodes.filter((n) => {
    const nw = n.contentW ?? n.width;
    return n.x < targetX + spanW && n.x + nw > targetX;
  });
  const targetY = colNodes.length
    ? Math.max(...colNodes.map((n) => n.y + (n.contentH ?? n.height ?? 0))) + 24
    : node.y;
  return { x: targetX, y: targetY };
}
