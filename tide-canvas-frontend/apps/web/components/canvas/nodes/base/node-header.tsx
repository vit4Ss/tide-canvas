"use client";

import type { LucideIcon } from "lucide-react";
import { NodeChrome } from "./node-chrome";

interface Props {
  icon: LucideIcon;
  title: string;
  visible: boolean;
  /** 兼容旧调用；底层由 React Flow 的 NodeToolbar 接管 */
  zoom?: number;
}

/** 节点外部标题栏 */
export function NodeHeader({ icon: Icon, title, visible, zoom }: Props) {
  if (!visible) return null;

  const row = (
    <div className="flex items-center gap-1.5 whitespace-nowrap px-1 text-[12px] text-neutral-600 dark:text-neutral-300">
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium">{title}</span>
    </div>
  );

  return (
    <NodeChrome zoom={zoom ?? 1} placement="top-left" gap={4}>
      {row}
    </NodeChrome>
  );
}
