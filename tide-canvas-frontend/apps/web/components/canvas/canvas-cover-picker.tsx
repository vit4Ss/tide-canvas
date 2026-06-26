"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Check, ImageOff } from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";

interface Props {
  open: boolean;
  /** 当前已选封面 URL（用于高亮） */
  currentUrl?: string | null;
  /** 显式传入候选图片（如项目列表页解析自 canvasData）；不传则取当前画布的图片节点 */
  images?: { id: string; url: string; title: string }[];
  onClose: () => void;
  onPick: (url: string) => void;
}

/**
 * 项目封面选择器：从候选图片里挑一张作为项目封面（thumbnail）。
 * 候选图片来自显式 images 入参，或当前画布的图片节点；无图片时给出提示。
 */
export function CanvasCoverPicker({ open, currentUrl, images: propImages, onClose, onPick }: Props) {
  const nodes = useCanvasStore((s) => s.nodes);
  const images = useMemo(
    () =>
      propImages ??
      nodes
        .filter((n) => n.type === "image" && n.imageSrc)
        .map((n) => ({ id: n.id, url: n.imageSrc as string, title: n.title || "图片" })),
    [propImages, nodes],
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5 dark:border-neutral-800">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">选择项目封面</h3>
            <p className="mt-0.5 text-xs text-neutral-400">从画布中的图片里挑一张作为项目封面</p>
          </div>
          <button onClick={onClose} title="关闭" className="rounded-full p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {images.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-neutral-400">
              <ImageOff className="h-8 w-8" />
              画布中暂无图片，先生成或上传图片后再设置封面
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {images.map((img) => {
                const active = !!currentUrl && img.url === currentUrl;
                return (
                  <button
                    key={img.id}
                    onClick={() => onPick(img.url)}
                    title={img.title}
                    className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-colors ${
                      active ? "border-blue-500" : "border-transparent hover:border-neutral-300 dark:hover:border-neutral-600"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.title} className="h-full w-full object-cover" />
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white shadow">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
