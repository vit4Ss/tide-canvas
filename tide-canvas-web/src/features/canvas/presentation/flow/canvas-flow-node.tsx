"use client";

import { memo, useCallback, useEffect, type PointerEvent } from "react";
import { useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { CanvasNodeComponent } from "@/components/canvas/canvas-node";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { CanvasFlowNodeProvider } from "../../infrastructure/react-flow/canvas-flow-context";
import type { CanvasFlowNode } from "../../infrastructure/react-flow/canvas-flow-types";
import { CanvasErrorBoundary } from "../errors/canvas-error-boundary";
import styles from "./canvas-flow.module.css";

const ignoreLegacyDrag = () => undefined;
const INTERACTIVE_SELECTOR = [
  ".nodrag",
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "video",
  "audio",
  "[contenteditable='true']",
  "[role='button']",
  "[role='slider']",
  "[role='textbox']",
].join(",");

/** React Flow 只接管节点外壳；节点内部业务组件和视觉保持原样。 */
export const CanvasFlowNodeView = memo(function CanvasFlowNodeView({
  id,
  data,
  selected,
  dragging,
}: NodeProps<CanvasFlowNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const node = data.node;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, node.contentH, node.contentW, node.height, node.width, updateNodeInternals]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(INTERACTIVE_SELECTOR)) return;

    // 只停止画布手势，不 preventDefault：输入框仍由浏览器在本次按下时获得焦点。
    // 未选中节点上的按钮也会在第一次交互时同步进入选中态。
    event.stopPropagation();
    if (!selected) useCanvasStore.getState().selectNode(id);
  }, [id, selected]);

  return (
    <CanvasFlowNodeProvider>
      <div className={styles.nodeHost} data-canvas-flow-node-host onPointerDown={handlePointerDown}>
        <CanvasErrorBoundary scope="node" resetKey={node}>
          <CanvasNodeComponent
            node={node}
            isSelected={selected}
            isDragging={dragging}
            isConnectTarget={false}
            onNodeMouseDown={ignoreLegacyDrag}
          />
        </CanvasErrorBoundary>
      </div>
    </CanvasFlowNodeProvider>
  );
});
