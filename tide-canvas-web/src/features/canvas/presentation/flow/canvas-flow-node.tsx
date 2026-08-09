"use client";

import { memo, useEffect, type PointerEvent } from "react";
import { useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { CanvasNodeComponent } from "@/components/canvas/canvas-node";
import { CanvasFlowNodeProvider } from "../../infrastructure/react-flow/canvas-flow-context";
import type { CanvasFlowNode } from "../../infrastructure/react-flow/canvas-flow-types";
import { CanvasErrorBoundary } from "../errors/canvas-error-boundary";
import styles from "./canvas-flow.module.css";

const ignoreLegacyDrag = () => undefined;
const INTERACTIVE_SELECTOR = [
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

function stopInteractivePointer(event: PointerEvent<HTMLDivElement>): void {
  const target = event.target;
  if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) {
    event.stopPropagation();
  }
}

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

  return (
    <CanvasFlowNodeProvider>
      <div className={styles.nodeHost} data-canvas-flow-node-host onPointerDown={stopInteractivePointer}>
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
