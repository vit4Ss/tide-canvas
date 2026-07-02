"use client";

import { memo, useCallback, type MouseEvent } from "react";
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
  onNodeMouseDown,
  onPortMouseDown,
}: CanvasNodeProps) {
  const updateNode = useCanvasStore((state) => state.updateNode);
  const removeNode = useCanvasStore((state) => state.removeNode);
  const Icon = getNodeIcon(node.type);

  const handleMouseDown = useCallback(
    (event: MouseEvent) => onNodeMouseDown(node.id, event),
    [node.id, onNodeMouseDown]
  );

  return (
    <div
      data-node-id={node.id}
      className={cn(
        styles.node,
        !isSelected && !isConnectTarget && styles.nodeIdle,
        isSelected && !isDragging && styles.nodeSelected,
        isConnectTarget && styles.nodeConnectTarget
      )}
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
      onMouseDown={handleMouseDown}
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

      <div
        onMouseDown={(event) => {
          event.stopPropagation();
          onPortMouseDown?.(node.id, "input", event.clientX, event.clientY);
        }}
        className={cn(styles.port, styles.inputPort)}
        title="输入端口"
      />
      <div
        onMouseDown={(event) => {
          event.stopPropagation();
          onPortMouseDown?.(node.id, "output", event.clientX, event.clientY);
        }}
        className={cn(styles.port, styles.outputPort)}
        title="输出端口"
      />
    </div>
  );
});
