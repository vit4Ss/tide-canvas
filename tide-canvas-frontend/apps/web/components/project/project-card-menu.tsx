"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, ExternalLink, Pencil, Image as ImageIcon, Copy, Trash2, X } from "lucide-react";
import { projectApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { CanvasCoverPicker } from "@/components/canvas/canvas-cover-picker";
import type { ProjectVO } from "@/types/canvas";

interface Props {
  project: ProjectVO;
  /** 任意操作（重命名/封面/副本/删除）成功后回调刷新列表 */
  onChanged: () => void;
}

/** 项目卡片「…」菜单：打开 / 重命名 / 修改封面 / 创建副本 / 移动至文件夹 / 删除项目。两处列表共用。 */
export function ProjectCardMenu({ project, onChanged }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverImages, setCoverImages] = useState<{ id: string; url: string; title: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  const handleOpen = () => { setOpen(false); window.open(`/canvas/${project.urlToken}`, "_blank", "noopener"); };

  const startRename = () => { setRenameValue(project.name); setOpen(false); setRenameOpen(true); };
  const submitRename = async () => {
    const name = renameValue.trim();
    setRenameOpen(false);
    if (!name || name === project.name) return;
    const res = await projectApi.update(project.id, { name });
    if (res.success) { toast.success("已重命名"); onChanged(); } else toast.error(res.message || "重命名失败");
  };

  const openCover = async () => {
    setOpen(false);
    const res = await projectApi.getCanvas(project.id);
    if (!res.success) { toast.error("加载画布失败"); return; }
    let imgs: { id: string; url: string; title: string }[] = [];
    try {
      const data = JSON.parse(res.data.canvasData || "{}");
      imgs = (data.nodes || [])
        .filter((n: { type?: string; imageSrc?: string }) => n.type === "image" && n.imageSrc)
        .map((n: { id: string; imageSrc: string; title?: string }) => ({ id: n.id, url: n.imageSrc, title: n.title || "图片" }));
    } catch { /* ignore parse error */ }
    if (imgs.length === 0) { toast.info("该项目画布暂无图片，无法设置封面"); return; }
    setCoverImages(imgs);
    setCoverOpen(true);
  };
  const pickCover = async (url: string) => {
    setCoverOpen(false);
    const cv = await projectApi.getCanvas(project.id);
    const canvasData = cv.success ? cv.data.canvasData || "{}" : "{}";
    const res = await projectApi.saveCanvas(project.id, { canvasData, thumbnail: url });
    if (res.success) { toast.success("封面已更新"); onChanged(); } else toast.error("封面设置失败");
  };

  const handleDuplicate = async () => {
    setOpen(false);
    if (busy) return;
    setBusy(true);
    try {
      const detail = await projectApi.get(project.id);
      if (!detail.success) { toast.error("加载项目失败"); return; }
      const created = await projectApi.create({ name: `${detail.data.name} - 副本`, description: detail.data.description });
      if (!created.success || !created.data) { toast.error(created.message || "创建副本失败"); return; }
      await projectApi.saveCanvas(created.data.id, {
        canvasData: detail.data.canvasData || "{}",
        thumbnail: detail.data.thumbnail || undefined,
      });
      toast.success("已创建副本");
      onChanged();
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    setOpen(false);
    if (!confirm("确定要删除该项目吗？")) return;
    const res = await projectApi.delete(project.id);
    if (res.success) { toast.success("已删除"); onChanged(); } else toast.error(res.message || "删除失败");
  };

  const item = "flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <div className="relative" ref={ref} onClick={stop}>
      <button
        onClick={(e) => { stop(e); setOpen((v) => !v); }}
        className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <button onClick={handleOpen} className={item}><ExternalLink className="h-4 w-4 text-neutral-400" /> 打开</button>
          <button onClick={startRename} className={item}><Pencil className="h-4 w-4 text-neutral-400" /> 重命名</button>
          <button onClick={openCover} className={item}><ImageIcon className="h-4 w-4 text-neutral-400" /> 修改封面</button>
          <button onClick={handleDuplicate} disabled={busy} className={item}><Copy className="h-4 w-4 text-neutral-400" /> 创建副本</button>
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
          <button onClick={handleDelete} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30">
            <Trash2 className="h-4 w-4" /> 删除项目
          </button>
        </div>
      )}

      {renameOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onMouseDown={() => setRenameOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">重命名项目</h3>
              <button onClick={() => setRenameOpen(false)} className="text-neutral-400 transition-colors hover:text-neutral-600"><X className="h-4 w-4" /></button>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setRenameOpen(false); }}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRenameOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800">取消</button>
              <button onClick={submitRename} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">确定</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <CanvasCoverPicker open={coverOpen} currentUrl={project.thumbnail} images={coverImages} onClose={() => setCoverOpen(false)} onPick={pickCover} />
    </div>
  );
}
