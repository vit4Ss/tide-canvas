"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { MoreHorizontal, ExternalLink, Pencil, Image as ImageIcon, Copy, Trash2, X } from "lucide-react";
import { projectApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import { CanvasCoverPicker } from "@/components/canvas/canvas-cover-picker";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { isImageCanvasNodeType } from "@/lib/canvas-node-types";
import type { ProjectVO } from "@/types/canvas";

interface Props {
  project: ProjectVO;
  /** 任意操作（重命名/封面/副本/删除）成功后回调刷新列表 */
  onChanged: () => void;
}

/** 项目卡片「…」菜单：打开 / 重命名 / 修改封面 / 创建副本 / 移动至文件夹 / 删除项目。两处列表共用。 */
export function ProjectCardMenu({ project, onChanged }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // 菜单 portal 到 body 用 fixed 坐标：项目列表区是 overflow:auto/hidden 的滚动口，
  // 卡片内 absolute 弹层超出即被裁；坐标在打开时采集，滚动时收起。
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverImages, setCoverImages] = useState<{ id: string; url: string; title: string }[]>([]);
  const renameDialogRef = useFocusTrap<HTMLDivElement>(renameOpen);

  const restoreTriggerFocus = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const closeRename = useCallback(() => {
    setRenameOpen(false);
    // 菜单项会随 portal 卸载，显式回到稳定存在的卡片菜单触发器。
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
        ?.focus();
    });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      // 点到其它控件时保留浏览器将焦点交给点击目标的默认行为。
      closeMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeMenu(true);
    };
    const onScroll = () => closeMenu(true); // fixed 坐标滚动即失锚，直接收起
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [closeMenu, open]);

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    event.preventDefault();
    items[next]?.focus();
  };

  const handleOpen = () => { closeMenu(false); router.push(`/canvas/${project.urlToken}`); };

  const startRename = () => { setRenameValue(project.name); closeMenu(false); setRenameOpen(true); };
  const submitRename = async () => {
    const name = renameValue.trim();
    closeRename();
    if (!name || name === project.name) return;
    const res = await projectApi.update(project.id, { name });
    if (res.success) { toast.success("已重命名"); onChanged(); } else toast.error(res.message || "重命名失败");
  };

  const openCover = async () => {
    closeMenu(true);
    const res = await projectApi.getCanvas(project.id);
    if (!res.success) { toast.error("加载画布失败"); return; }
    let imgs: { id: string; url: string; title: string }[] = [];
    try {
      const data = JSON.parse(res.data.canvasData || "{}");
      imgs = (data.nodes || [])
        .filter((n: { type?: string; imageSrc?: string }) => isImageCanvasNodeType(n.type) && n.imageSrc)
        .map((n: { id: string; imageSrc: string; title?: string }) => ({ id: n.id, url: n.imageSrc, title: n.title || "图片" }));
    } catch { /* ignore parse error */ }
    if (imgs.length === 0) { toast.info("该项目画布暂无图片，无法设置封面"); return; }
    setCoverImages(imgs);
    setCoverOpen(true);
  };
  const pickCover = async (url: string) => {
    setCoverOpen(false);
    const cv = await projectApi.getCanvas(project.id);
    // 拉取失败时绝不落盘:带着 "{}" 调 saveCanvas 会把整个画布数据抹掉
    if (!cv.success) { toast.error("加载画布失败，封面未修改"); return; }
    const res = await projectApi.saveCanvas(project.id, {
      canvasData: cv.data.canvasData || "{}",
      thumbnail: url,
      expectedRevision: cv.data.revision,
    });
    if (res.success) { toast.success("封面已更新"); onChanged(); } else toast.error("封面设置失败");
  };

  const handleDuplicate = async () => {
    closeMenu(true);
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
        expectedRevision: created.data.revision,
      });
      toast.success("已创建副本");
      onChanged();
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    closeMenu(true);
    if (
      !(await confirmDialog({
        title: "删除项目",
        message: "确定要删除该项目吗？此操作不可撤销。",
        confirmText: "删除",
      }))
    )
      return;
    const res = await projectApi.delete(project.id);
    if (res.success) { toast.success("已删除"); onChanged(); } else toast.error(res.message || "删除失败");
  };

  const item = "flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <div className="relative" ref={ref} onClick={stop}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`打开“${project.name || "未命名项目"}”的项目菜单`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          stop(e);
          const r = e.currentTarget.getBoundingClientRect();
          setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
          if (open) closeMenu(true);
          else setOpen(true);
        }}
        className="project-menu-trigger flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ top: menuPos.top, right: menuPos.right }}
          className="dark fixed z-50"
          onClick={stop}
        >
          <div
            className="w-44 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
            role="menu"
            aria-label={`${project.name || "未命名项目"}的项目操作`}
            onKeyDown={handleMenuKeyDown}
          >
            <button onClick={handleOpen} className={item} role="menuitem"><ExternalLink className="h-4 w-4 text-neutral-400" /> 打开</button>
            <button onClick={startRename} className={item} role="menuitem"><Pencil className="h-4 w-4 text-neutral-400" /> 重命名</button>
            <button onClick={openCover} className={item} role="menuitem"><ImageIcon className="h-4 w-4 text-neutral-400" /> 修改封面</button>
            <button onClick={handleDuplicate} disabled={busy} className={item} role="menuitem"><Copy className="h-4 w-4 text-neutral-400" /> 创建副本</button>
            <div className="my-1 border-t border-neutral-800" />
            <button onClick={handleDelete} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/30" role="menuitem">
              <Trash2 className="h-4 w-4" /> 删除项目
            </button>
          </div>
        </div>,
        document.body,
      )}

      {renameOpen && createPortal(
        <div className="dark fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onMouseDown={closeRename}>
          <div
            ref={renameDialogRef}
            tabIndex={-1}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-rename-title"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              closeRename();
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 id="project-rename-title" className="text-sm font-semibold text-neutral-100">重命名项目</h3>
              <button type="button" aria-label="关闭重命名窗口" onClick={closeRename} className="text-neutral-400 transition-colors hover:text-neutral-200"><X className="h-4 w-4" /></button>
            </div>
            <input
              aria-label="项目名称"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void submitRename();
              }}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeRename} className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-800">取消</button>
              <button type="button" onClick={() => { void submitRename(); }} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200">确定</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <CanvasCoverPicker open={coverOpen} currentUrl={project.thumbnail} images={coverImages} onClose={() => setCoverOpen(false)} onPick={pickCover} />
    </div>
  );
}
