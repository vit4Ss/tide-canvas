"use client";

/* ── reference thumbnail (composer strip, extracted verbatim from page.tsx) ─── */

import type { RefItem } from "./chat-utils";
import { fallbackOssDisplayImage, ossDisplayUrl, restoreOssDisplayImage } from "@/lib/oss-display";

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
  const imageSrc = item.kind === "image" && src ? (ossDisplayUrl(src, 160) ?? src) : src;
  const progress = Math.max(0, Math.min(100, Math.round(item.progress ?? 0)));
  // 有可用地址、且非上传中/失败时才可点开预览
  const canPreview = !!src && !item.uploading && !item.failed;
  return (
    <div
      className={`ref-thumb${item.uploading ? " uploading" : ""}${item.failed ? " failed" : ""}${canPreview ? " clickable" : ""}`}
      role={canPreview ? "button" : undefined}
      tabIndex={canPreview ? 0 : undefined}
      title={item.uploading ? `${item.name || "文件"} · 上传中 ${progress}%` : item.failed ? "上传失败，请移除后重试" : canPreview ? "点击预览" : undefined}
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
        <img
          src={imageSrc}
          alt={item.name || "参考"}
          loading="lazy"
          decoding="async"
          onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
          onError={(event) => fallbackOssDisplayImage(event.currentTarget, src)}
        />
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
      {item.uploading && (
        <span className="ref-upload-mask" aria-label={`上传中 ${progress}%`}>
          <span className="ref-spin" aria-hidden />
          <span className="ref-progress">{progress > 0 ? `${progress}%` : "准备中"}</span>
        </span>
      )}
      {item.uploading && <span className="ref-progress-bar" style={{ width: `${progress}%` }} aria-hidden />}
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
