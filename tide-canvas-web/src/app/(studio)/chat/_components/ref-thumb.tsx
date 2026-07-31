"use client";

/* ── reference thumbnail (composer strip, extracted verbatim from page.tsx) ─── */

import type { RefItem } from "./chat-utils";

export function RefThumb({
  item,
  onRemove,
  onOpen,
}: {
  item: RefItem;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const src = item.url || item.blobUrl;
  // 有可用地址、且非上传中/失败时才可点开预览
  const canPreview = !!src && !item.uploading && !item.failed;
  return (
    <div
      className={`ref-thumb${item.failed ? " failed" : ""}${canPreview ? " clickable" : ""}`}
      role={canPreview ? "button" : undefined}
      tabIndex={canPreview ? 0 : undefined}
      title={canPreview ? "点击预览" : undefined}
      onClick={canPreview ? onOpen : undefined}
      onKeyDown={
        canPreview
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      {item.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={item.name || "参考"} />
      ) : item.kind === "video" ? (
        <video src={src} muted />
      ) : item.kind === "audio" ? (
        <span className="ref-aud" aria-hidden>
          ♪
        </span>
      ) : (
        <span className="ref-aud" aria-hidden>
          📄
        </span>
      )}
      {item.uploading && <span className="ref-spin" aria-label="上传中" />}
      {item.failed && (
        <span className="ref-badge" title="上传失败">
          !
        </span>
      )}
      <button
        type="button"
        className="ref-x"
        onClick={(e) => {
          e.stopPropagation(); // 别触发容器的预览
          onRemove();
        }}
        aria-label="移除参考"
      >
        ×
      </button>
    </div>
  );
}
