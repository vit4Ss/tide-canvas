"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { NodeChrome } from "./base/node-chrome";

/** Attach the editor to the preview itself. The canvas transform moves both
 * together; NodeChrome cancels only zoom so controls keep their screen size. */
export function ImageComposerAnchor({ children }: { children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      // Fit-to-view reserves editor space, but never repositions the editor.
      panel.dataset.contentHeight = `${panel.offsetHeight}`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    // Native canvas wheel handling runs before React's onWheel. Keep scrolling
    // inside editor controls from moving the node beneath the pointer.
    const stopWheel = (event: WheelEvent) => event.stopPropagation();
    panel.addEventListener("wheel", stopWheel, { passive: true });
    return () => {
      observer.disconnect();
      panel.removeEventListener("wheel", stopWheel);
    };
  }, []);

  return (
    <NodeChrome placement="bottom-center" gap={16} zIndex={60}>
      <div
        ref={panelRef}
        className="image-composer-attached select-text notranslate"
        translate="no"
        data-image-composer-anchor
        data-placement="below"
        style={{ width: 660, maxWidth: "calc(100vw - 32px)" }}
        onMouseDown={(event) => event.stopPropagation()}
      >{children}</div>
    </NodeChrome>
  );
}
