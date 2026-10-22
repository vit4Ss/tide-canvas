"use client";

import type { ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { ImageComposerAnchor } from "../image-composer-anchor";

interface Props {
  label: string;
  tools?: ReactNode;
  onExpand?: () => void;
  children: ReactNode;
  status?: ReactNode;
  footer: ReactNode;
}

/** Shared screen-space editor for media and generation nodes. Place inside the
 * preview's relative container, so resizing/panning keeps the same anchor. */
export function NodeComposer({ label, tools, onExpand, children, status, footer }: Props) {
  return (
    <ImageComposerAnchor>
      <section className="image-node-composer canvas-node-composer" aria-label={label}>
        {(tools || onExpand) && (
          <div className="image-composer-heading">
            <div className="image-composer-tools">{tools}</div>
            {onExpand && <button type="button" className="image-composer-icon" aria-label={`展开${label}`} title="展开编辑" onClick={onExpand}>
              <Maximize2 size={14} aria-hidden />
            </button>}
          </div>
        )}
        <div className="image-composer-body">{children}</div>
        {status && <div className="node-composer-status">{status}</div>}
        <div className="image-composer-footer node-composer-footer">{footer}</div>
      </section>
    </ImageComposerAnchor>
  );
}
