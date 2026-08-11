/* 上传素材预览弹窗（create.js openPreview）— 从 create-studio.tsx 的
   renderPreview 抽出（纯移动，无逻辑改动）。Escape 收起自含。 */

import { useEffect, useState, type ReactNode } from "react";
import CapturableVideo from "./video-result";
import type { SlotData, SlotDef } from "./types";
import { slotTypeOf, thumbBg } from "./utils";

function VideoPreview({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);

  const unavailable = !src || failed;
  return (
    <div className="ws-prev-media ws-prev-media-video">
      {src && (
        <CapturableVideo
          src={src}
          className="ws-prev-video"
          controls
          playsInline
          preload="metadata"
          showFrameCapture={false}
          aria-label={`${name} 视频预览`}
          onLoadedMetadata={() => setFailed(false)}
          onError={() => setFailed(true)}
        />
      )}
      {unavailable && (
        <div className="ws-prev-media-error" aria-live="polite">
          <strong>{src ? "当前浏览器无法播放此视频" : "视频地址不可用"}</strong>
          <span>{src ? "可能是视频编码不受支持，可尝试打开原文件。" : "请移除后重新上传。"}</span>
          {src && (
            <a href={src} target="_blank" rel="noreferrer">
              打开原文件
            </a>
          )}
        </div>
      )}
    </div>
  );
}

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
  const typeLabel = type === "image" ? "图片" : type === "video" ? "视频" : "音频";
  const detail = f.s?.trim() || [typeLabel, f.d?.trim()].filter(Boolean).join(" · ");
  let media: ReactNode;
  if (type === "image") {
    media = <div className="ws-prev-media" style={{ background: thumbBg(f.g) }} />;
  } else if (type === "video") {
    media = <VideoPreview key={f.url || `${preview.k}-${preview.i}`} src={f.url} name={f.n} />;
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
          <span className="sz">{detail}</span>
        </div>
      </div>
    </div>
  );
}
