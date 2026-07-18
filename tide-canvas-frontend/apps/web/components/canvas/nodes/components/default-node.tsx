"use client";

import { memo } from "react";
import { Loader2, X } from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { cn } from "@/lib/utils";
import type { CanvasNodeProps } from "../types/node-props";
import { getNodeIcon } from "../utils/node-icons";
import styles from "../styles/default-node.module.css";

// 中文注释：默认节点只兜底未知节点类型，具体业务节点应继续使用各自的专用组件。
export const DefaultNode = memo(function DefaultNode({
  node,
  isSelected,
  isDragging = false,
  isConnectTarget,
}: CanvasNodeProps) {
  const updateNode = useCanvasStore((state) => state.updateNode);
  const removeNode = useCanvasStore((state) => state.removeNode);
  const Icon = getNodeIcon(node.type);

  return (
    <div
      data-node-id={node.id}
      data-node-selected={isSelected && !isConnectTarget ? "true" : undefined}
      data-node-native-border="true"
      className={cn(
        styles.node,
        "canvas-node-selection-surface",
        !isSelected && !isConnectTarget && styles.nodeIdle,
        isSelected && !isDragging && styles.nodeSelected,
        isConnectTarget && styles.nodeConnectTarget
      )}
      style={{
        position: "relative",
        width: node.width,
        minHeight: node.height,
      }}
    >
      <div className={styles.header}>
        <div className={styles.titleWrap}>
          <Icon className={styles.icon} />
          <span className={styles.title}>{node.title}</span>
        </div>
        <div className={styles.actions}>
          {node.status === "generating" && <Loader2 className={styles.spinner} />}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              removeNode(node.id);
            }}
            className={styles.removeButton}
            aria-label="删除节点"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <textarea
          value={node.prompt || ""}
          onChange={(event) => updateNode(node.id, { prompt: event.target.value })}
          onMouseDown={(event) => event.stopPropagation()}
          placeholder="输入提示词..."
          className={styles.promptInput}
          rows={3}
        />
      </div>
    </div>
  );
});
