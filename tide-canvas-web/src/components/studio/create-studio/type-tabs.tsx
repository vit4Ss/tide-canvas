/* 类型页签（图片 / 视频 / 音频 / 3D）。 */

import type { ArtworkType } from "./types";

export function TypeTabs({
  curType,
  onPick,
}: {
  curType: ArtworkType;
  onPick: (t: ArtworkType) => void;
}) {
  return (
    <div className="ws-typetabs" id="type-tabs">
      <button
        type="button"
        className={curType === "image" ? "on" : undefined}
        onClick={() => onPick("image")}
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.6" />
          <path d="M21 16l-5-5L5 20" />
        </svg>
        图片
      </button>
      <button
        type="button"
        className={curType === "video" ? "on" : undefined}
        onClick={() => onPick("video")}
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="5" width="13" height="14" rx="2" />
          <path d="M16 10l5-3v10l-5-3z" />
        </svg>
        视频
      </button>
      <button
        type="button"
        className={curType === "audio" ? "on" : undefined}
        onClick={() => onPick("audio")}
      >
        <svg viewBox="0 0 24 24">
          <path d="M9 18V6l10-2v12" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="16" cy="16" r="3" />
        </svg>
        音频
      </button>
      <button
        type="button"
        className={curType === "3d" ? "on" : undefined}
        onClick={() => onPick("3d")}
      >
        <svg viewBox="0 0 24 24">
          <path d="M12 3 20 7.5 12 12 4 7.5 12 3Z" />
          <path d="M4 7.5V16.5L12 21V12" />
          <path d="M20 7.5V16.5L12 21" />
        </svg>
        3D模型
      </button>
    </div>
  );
}
