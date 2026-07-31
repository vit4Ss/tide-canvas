/* 上传素材预览弹窗（create.js openPreview）— 从 create-studio.tsx 的
   renderPreview 抽出（纯移动，无逻辑改动）。Escape 收起自含。 */

import { useEffect, type ReactNode } from "react";
import type { SlotData, SlotDef } from "./types";
import { refGrad, slotTypeOf, thumbBg } from "./utils";

export function PreviewModal({
  preview,
  slotData,
  slots,
  onClose,
}: {
  preview: { k: string; i: number } | null;
  slotData: SlotData;
  slots: SlotDef[] | null;
  onClose: () => void;
}) {
  // close the upload preview on Escape (create.js openPreview esc handler).
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview, onClose]);

  if (!preview) return null;
  const f = (slotData[preview.k] || [])[preview.i];
  if (!f) return null;
  const type = slotTypeOf(slots, preview.k);
  let media: ReactNode;
  if (type === "image") {
    media = <div className="ws-prev-media" style={{ background: thumbBg(f.g) }} />;
  } else if (type === "video") {
    media = (
      <div className="ws-prev-media dark" style={{ background: refGrad(preview.i * 9 + 40) }}>
        <span className="ws-prev-play">▶</span>
        <span className="ws-prev-badge">{f.d}</span>
      </div>
    );
  } else {
    media = (
      <div className="ws-prev-media dark">
        <div className="ws-prev-wave">
          {Array.from({ length: 42 }, (_, i) => (
            <i key={i} style={{ height: `${18 + ((i * 37) % 64)}%` }} />
          ))}
        </div>
        <span className="ws-prev-play sm">▶</span>
        <span className="ws-prev-badge">{f.d}</span>
      </div>
    );
  }
  return (
    <div
      className="ws-prev-mask show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ws-prev" role="dialog" aria-modal>
        <button
          className="ws-prev-x"
          type="button"
          aria-label="关闭"
          onClick={onClose}
        >
          ✕
        </button>
        {media}
        <div className="ws-prev-meta">
          <span className="nm">{f.n}</span>
          <span className="sz">
            {f.s || (type === "video" ? "视频 · " : "音频 · ") + (f.d ?? "")}
          </span>
        </div>
      </div>
    </div>
  );
}
