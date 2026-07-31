"use client";

/* ── fullscreen lightbox (extracted verbatim from page.tsx) ─────────────────── */

import { useEffect } from "react";
import { fileNameFromUrl, isInlineDoc, type LightboxItem } from "./chat-utils";

/** Fullscreen lightbox with Esc-close and ←/→ wrap-around navigation. */
export function Lightbox({
  items,
  index,
  onClose,
  onStep,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onStep(-1);
      else if (e.key === "ArrowRight") onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  const cur = items[index];
  if (!cur) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lb-x" type="button" onClick={onClose} aria-label="关闭">
        ×
      </button>
      {items.length > 1 && (
        <>
          <button
            className="lb-nav prev"
            type="button"
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation();
              onStep(-1);
            }}
          >
            ‹
          </button>
          <button
            className="lb-nav next"
            type="button"
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation();
              onStep(1);
            }}
          >
            ›
          </button>
          <span className="lb-count">
            {index + 1} / {items.length}
          </span>
        </>
      )}
      <div className="lb-stage" onClick={(e) => e.stopPropagation()}>
        {cur.kind === "video" ? (
          <video src={cur.url} controls autoPlay />
        ) : cur.kind === "audio" ? (
          <div className="lb-audio">
            <span className="lb-audio-ic" aria-hidden>
              ♪
            </span>
            <span className="lb-audio-name">{cur.name || fileNameFromUrl(cur.url)}</span>
            <audio src={cur.url} controls autoPlay />
          </div>
        ) : cur.kind === "doc" ? (
          <div className="lb-doc">
            {isInlineDoc(cur.url) ? (
              <iframe className="lb-doc-frame" src={cur.url} title={cur.name || "文件预览"} />
            ) : (
              <div className="lb-doc-fallback">
                <span className="lb-doc-ic" aria-hidden>
                  📄
                </span>
                <span className="lb-doc-name">{cur.name || fileNameFromUrl(cur.url)}</span>
                <span className="lb-doc-hint">该文件类型不支持预览</span>
              </div>
            )}
            <a className="lb-doc-dl" href={cur.url} target="_blank" rel="noopener noreferrer" download>
              下载 / 新窗口打开
            </a>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cur.url} alt={cur.name || "预览"} />
        )}
      </div>
    </div>
  );
}
