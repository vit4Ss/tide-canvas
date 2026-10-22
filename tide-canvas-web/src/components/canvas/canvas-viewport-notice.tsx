"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { nodeRenderRect } from "@/lib/canvas-helpers";
import { hasCanvasNodeInViewport, type CanvasViewportSize } from "@/lib/canvas-viewport-visibility";
import type { CanvasNode } from "@/stores/use-canvas-store";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";

interface Props {
  nodes: CanvasNode[];
  viewportSize: CanvasViewportSize;
  onReturn: () => void;
}

/** Only visibility changes rerender this notice; panning never rerenders CanvasView. */
export function CanvasViewportNotice({ nodes, viewportSize, onReturn }: Props) {
  const rects = useMemo(() => nodes.map(nodeRenderRect), [nodes]);
  const hasVisibleNode = useCanvasViewStore((state) => hasCanvasNodeInViewport(rects, state.transform, viewportSize));

  if (nodes.length === 0 || viewportSize.width <= 0 || viewportSize.height <= 0 || hasVisibleNode) return null;
  // Returning to the nodes unmounts this child and resets dismissal for the
  // next time the user pans away, without effects or transform history state.
  return <DismissibleViewportNotice onReturn={onReturn} />;
}

function DismissibleViewportNotice({ onReturn }: Pick<Props, "onReturn">) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="canvas-viewport-notice" role="status" onMouseDown={(event) => event.stopPropagation()}>
      <span>当前视窗没有节点</span>
      <button type="button" className="canvas-viewport-notice-return" onClick={onReturn}>返回节点</button>
      <button type="button" className="canvas-viewport-notice-close" aria-label="关闭视窗提示" title="关闭提示" onClick={() => setDismissed(true)}>
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
