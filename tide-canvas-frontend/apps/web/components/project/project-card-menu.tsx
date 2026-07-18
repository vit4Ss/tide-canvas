"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ActionIcon, Menu } from "@mantine/core";
import { Copy, ExternalLink, Image as ImageIcon, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { projectApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CanvasCoverPicker } from "@/components/canvas/canvas-cover-picker";
import { displayProjectName } from "@/lib/utils";
import type { ProjectVO } from "@/types/canvas";

interface Props {
  project: ProjectVO;
  /** 任意操作成功后回调刷新列表。 */
  onChanged: () => void;
}

/** 项目卡片操作菜单，弹层走 portal，避免被卡片裁切。 */
export function ProjectCardMenu({ project, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [coverOpen, setCoverOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [coverImages, setCoverImages] = useState<{ id: string; url: string; title: string }[]>([]);

  const stop = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleOpen = () => {
    window.open(`/canvas/${project.urlToken}`, "_blank", "noopener");
  };

  const startRename = () => {
    setRenameValue(project.name);
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const name = renameValue.trim();
    setRenameOpen(false);
    if (!name || name === project.name) return;

    const res = await projectApi.update(project.id, { name });
    if (res.success) {
      toast.success("已重命名");
      onChanged();
    } else {
      toast.error(res.message || "重命名失败");
    }
  };

  const openCover = async () => {
    const res = await projectApi.getCanvas(project.id);
    if (!res.success) {
      toast.error("加载画布失败");
      return;
    }

    let images: { id: string; url: string; title: string }[] = [];
    try {
      const data = JSON.parse(res.data.canvasData || "{}");
      images = (data.nodes || [])
        .filter((node: { type?: string; imageSrc?: string }) => node.type === "image" && node.imageSrc)
        .map((node: { id: string; imageSrc: string; title?: string }) => ({ id: node.id, url: node.imageSrc, title: node.title || "图片" }));
    } catch {
      // 中文注释：历史画布数据可能不是合法 JSON，此处静默降级为无可选封面。
    }

    if (images.length === 0) {
      toast.info("该项目画布暂无图片，无法设置封面");
      return;
    }

    setCoverImages(images);
    setCoverOpen(true);
  };

  const pickCover = async (url: string) => {
    setCoverOpen(false);
    const canvas = await projectApi.getCanvas(project.id);
    const canvasData = canvas.success ? canvas.data.canvasData || "{}" : "{}";
    const res = await projectApi.saveCanvas(project.id, { canvasData, thumbnail: url });
    if (res.success) {
      toast.success("封面已更新");
      onChanged();
    } else {
      toast.error("封面设置失败");
    }
  };

  const handleDuplicate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const detail = await projectApi.get(project.id);
      if (!detail.success) {
        toast.error("加载项目失败");
        return;
      }

      const created = await projectApi.create({ name: `${detail.data.name} - 副本`, description: detail.data.description });
      if (!created.success || !created.data) {
        toast.error(created.message || "创建副本失败");
        return;
      }

      await projectApi.saveCanvas(created.data.id, {
        canvasData: detail.data.canvasData || "{}",
        thumbnail: detail.data.thumbnail || undefined,
      });
      toast.success("已创建副本");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await projectApi.delete(project.id);
      if (res.success) {
        toast.success("已删除");
        setDeleteOpen(false);
        onChanged();
      } else {
        toast.error(res.message || "删除失败");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={stop}>
      <Menu withinPortal position="bottom-end" shadow="lg" radius="md" width={176} zIndex={400}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" radius="md" size={28} aria-label="项目操作">
            <MoreHorizontal size={16} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item leftSection={<ExternalLink size={15} />} onClick={handleOpen}>打开</Menu.Item>
          <Menu.Item leftSection={<Pencil size={15} />} onClick={startRename}>重命名</Menu.Item>
          <Menu.Item leftSection={<ImageIcon size={15} />} onClick={openCover}>修改封面</Menu.Item>
          <Menu.Item leftSection={<Copy size={15} />} onClick={handleDuplicate} disabled={busy}>创建副本</Menu.Item>
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<Trash2 size={15} />} onClick={() => setDeleteOpen(true)}>删除项目</Menu.Item>
        </Menu.Dropdown>
      </Menu>

      {renameOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onMouseDown={() => setRenameOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">重命名项目</h3>
              <button onClick={() => setRenameOpen(false)} className="text-neutral-400 transition-colors hover:text-neutral-600"><X className="h-4 w-4" /></button>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitRename();
                if (event.key === "Escape") setRenameOpen(false);
              }}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRenameOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800">取消</button>
              <button onClick={() => void submitRename()} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">确定</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <CanvasCoverPicker open={coverOpen} currentUrl={project.thumbnail} images={coverImages} onClose={() => setCoverOpen(false)} onPick={pickCover} />
      <ConfirmDialog
        open={deleteOpen}
        danger
        loading={busy}
        title="删除项目？"
        message={`项目「${displayProjectName(project.name)}」删除后不可恢复，画布内容和封面也会一并删除。`}
        confirmText="删除项目"
        cancelText="取消"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
