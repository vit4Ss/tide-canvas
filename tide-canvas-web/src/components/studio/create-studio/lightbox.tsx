/* 全图放大灯箱（点已完成图片放大；背板 / ✕ / Esc 关闭；含同款单图工具条）—
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。 */

import { useEffect } from "react";
import { CELL_TOOLS } from "./icons";

export function Lightbox({
  url,
  onClose,
  onTool,
}: {
  url: string;
  onClose: () => void;
  onTool: (act: string) => void;
}) {
  // close the image lightbox on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ws-lightbox" onClick={onClose}>
      <button
        type="button"
        className="ws-lb-x"
        aria-label="关闭"
        onClick={onClose}
      >
        ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="生成结果预览" onClick={(e) => e.stopPropagation()} />
      {/* same per-result edit toolbar, always visible in the zoom view */}
      <div
        className="gen-acts ws-lb-tools"
        onClick={(e) => {
          e.stopPropagation();
          const btn = (e.target as HTMLElement).closest("button");
          if (btn) onTool(btn.dataset.act || "");
        }}
      >
        {CELL_TOOLS.map((t) => (
          <button
            key={t.act}
            type="button"
            data-act={t.act}
            className={t.real ? undefined : "soon"}
            title={t.label}
            aria-label={t.label}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
