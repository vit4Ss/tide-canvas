/* 全图放大灯箱（背板 / ✕ / Esc 关闭）；生成结果可选配单图工具条。 */

import { useEffect } from "react";
import { CELL_TOOLS } from "./icons";

export function Lightbox({
  url,
  onClose,
  onTool,
  alt = "生成结果预览",
}: {
  url: string;
  onClose: () => void;
  onTool?: (act: string) => void;
  alt?: string;
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
      <img src={url} alt={alt} onClick={(e) => e.stopPropagation()} />
      {onTool && (
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
      )}
    </div>
  );
}
