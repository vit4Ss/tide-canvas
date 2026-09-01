"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Loader2, X } from "lucide-react";
import type { CanvasNode } from "@/stores/use-canvas-store";
import { NodeChrome } from "../base/node-chrome";

/** 节点最外层定位壳（三媒体节点一致）：画布坐标定位 + 选中提层 + 拖拽手势 */
export function NodeShell({ node, isSelected, isDragging, onNodeMouseDown, children }: {
  node: CanvasNode;
  isSelected: boolean;
  isDragging: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: isDragging ? "grabbing" : "grab" }}
      onMouseDown={(e) => onNodeMouseDown(node.id, e)}
    >
      {children}
    </div>
  );
}

/** 生成中遮罩（图片/视频同一视觉；音频是另一套卡片样式，自行渲染） */
export function NodeGeneratingOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-neutral-900/70">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{label}</p>
      </div>
    </div>
  );
}

/** 上传中遮罩：模糊预览 + 百分比 */
export function NodeUploadingOverlay({ pct, previewSrc, kind }: { pct: number; previewSrc: string | null; kind: "image" | "video" }) {
  return (
    <div className="absolute inset-0 z-[6] overflow-hidden">
      {previewSrc ? (
        kind === "video" ? (
          <video src={previewSrc} muted className="h-full w-full scale-110 object-cover blur-xl" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="" className="h-full w-full scale-110 object-cover blur-xl" />
        )
      ) : (
        <div className="h-full w-full bg-neutral-900" />
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/55">
        <p className="text-sm text-white/90">上传中 ({pct}%) ...</p>
      </div>
    </div>
  );
}

/** 生成失败角标 */
export function NodeErrorBadge() {
  return (
    <div className="absolute right-3 top-3 z-[5] rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
      生成失败
    </div>
  );
}

/** 头部右上角「W × H」尺寸标签（上传/生成后展示） */
export function NodeDimsBadge({ dims }: { dims: { w: number; h: number } }) {
  return (
    <NodeChrome placement="top-right" gap={4}>
      <span className="whitespace-nowrap px-1 text-xs text-neutral-400">{dims.w} × {dims.h}</span>
    </NodeChrome>
  );
}

/** 查看大图：全屏 lightbox（Portal 到 body，脱离画布缩放层）；Esc 关闭；顶栏左侧文件名、右侧关闭钮 */
export function NodeMediaLightbox({ onClose, title, children }: { onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      data-canvas-modal="true"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div className="absolute inset-x-0 top-0 flex h-14 items-center justify-between gap-4 px-4">
        <span className="min-w-0 truncate text-sm text-white/90">{title ?? ""}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭 (Esc)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}

/** 提示词面板右下的圆形发送按钮（视频/音频一致；图片是另一套圆角矩形，自行渲染） */
export function GenerateSubmitButton({ disabled, generating, title, onClick }: {
  disabled: boolean;
  generating: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${disabled ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800" : "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"}`}
    >
      {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
    </button>
  );
}

/** 底部提示词面板外框（视频/音频一致的卡片样式；图片是 Mantine Paper 另一套，自行渲染） */
export function NodePanelChrome({ width, height, children }: { width: number; height?: number; children: ReactNode }) {
  return (
    <NodeChrome placement="bottom-center" gap={18} damp={0.6}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex flex-col rounded-xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/30"
        style={{ width, height, boxSizing: "border-box" }}
      >
        {children}
      </div>
    </NodeChrome>
  );
}
