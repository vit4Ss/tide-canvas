"use client";

import type { LucideIcon } from "lucide-react";
import { NodeChrome } from "./node-chrome";

interface Props {
  icon: LucideIcon;
  title: string;
  visible: boolean;
  /** 传入画布缩放 k 则启用「恒定大小·跟随节点」覆盖层模式；省略则保持旧的流式布局 */
  zoom?: number;
}

/** 节点外部标题栏 */
export function NodeHeader({ icon: Icon, title, visible, zoom }: Props) {
  const row = (
    <div className="flex items-center gap-1.5 whitespace-nowrap px-1 text-sm text-neutral-600 dark:text-neutral-300">
      <Icon className="h-4 w-4" />
      <span className="font-medium">{title}</span>
    </div>
  );

  // 覆盖层模式：恒定屏幕尺寸，吸附在卡片左上方
  if (zoom != null) {
    if (!visible) return null;
    return (
      <NodeChrome zoom={zoom} placement="top-left" gap={4}>
        {row}
      </NodeChrome>
    );
  }

  // 流式模式（旧行为）：始终占据空间避免布局跳动，仅在 visible 时显示文字
  return (
    <div className={`px-1 pb-1.5 ${visible ? "" : "invisible"}`}>{row}</div>
  );
}
