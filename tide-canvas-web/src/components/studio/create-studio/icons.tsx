/* 创作台 CreateStudio 的内联 SVG 图标集 — 从 create-studio.tsx 抽出（纯移动）。 */

import type { ReactNode } from "react";
import type { ArtworkType } from "./types";

export const SLOT_ICON: Record<ArtworkType, ReactNode> = {
  image: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5L5 20" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="5" width="13" height="14" rx="2.5" />
      <path d="M16 10l5-3v10l-5-3z" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 24 24">
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </svg>
  ),
  "3d": (
    <svg viewBox="0 0 24 24">
      <path d="M12 3 20 7.5 12 12 4 7.5 12 3Z" />
      <path d="M4 7.5V16.5L12 21V12" />
      <path d="M20 7.5V16.5L12 21" />
    </svg>
  ),
};

/* per-result floating toolbar (hover a finished image). The first three load the
   image into a tool's reference slot (作为垫图 / 生成视频 / 精细编辑); the rest are
   one-click edit ops wired to dedicated backend handlers (扩图 / 高清放大 /
   移除背景 / 物体移除). The `real` flag drives styling only — all are functional. */
export interface CellTool {
  act: string;
  label: string;
  real: boolean;
  icon: ReactNode;
}

export const CELL_TOOLS: CellTool[] = [
  {
    act: "pad",
    label: "作为垫图",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3l8 4-8 4-8-4 8-4z" />
        <path d="M4 12l8 4 8-4" />
        <path d="M4 16.5l8 4 8-4" />
      </svg>
    ),
  },
  {
    act: "video",
    label: "生成视频",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="13" height="14" rx="2.5" />
        <path d="M16 10l5-3v10l-5-3z" />
      </svg>
    ),
  },
  {
    act: "edit",
    label: "精细编辑",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3z" />
        <path d="M13.5 6.5l3 3" />
      </svg>
    ),
  },
  {
    act: "expand",
    label: "扩图",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
      </svg>
    ),
  },
  {
    act: "hd",
    label: "高清放大",
    real: true,
    icon: <span className="hd-glyph">HD</span>,
  },
  {
    act: "rmbg",
    label: "移除背景",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="6" cy="6" r="2.6" />
        <circle cx="6" cy="18" r="2.6" />
        <path d="M8.4 7.6L20 18M8.4 16.4L20 6" />
      </svg>
    ),
  },
  {
    act: "rmobj",
    label: "物体移除",
    real: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M5.5 15.5l5-5 5 5-3.5 3.5H9l-3.5-3.5z" />
        <path d="M10.5 10.5l5-5a2 2 0 0 1 3 0l1.5 1.5a2 2 0 0 1 0 3l-5 5" />
        <path d="M8.5 19H20" />
      </svg>
    ),
  },
];
