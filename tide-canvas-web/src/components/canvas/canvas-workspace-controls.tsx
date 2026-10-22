"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Columns2, Loader2, MoreHorizontal, Plus, Workflow, X } from "lucide-react";
import type { CanvasViewMode } from "@/lib/canvas-document";

interface Props {
  canvases: Array<{ id: string; name: string }>;
  activeId: string;
  viewMode: CanvasViewMode;
  busy: boolean;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onViewChange: (mode: CanvasViewMode) => void;
}

export function CanvasWorkspaceControls({ canvases, activeId, viewMode, busy, onSwitch, onCreate, onOpen, onRename, onCopy, onDelete, onViewChange }: Props) {
  const [open, setOpen] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const rowTriggers = useRef(new Map<string, HTMLButtonElement>());
  const submenuId = useId();
  const active = canvases.find((canvas) => canvas.id === activeId);
  const actionCanvas = canvases.find((canvas) => canvas.id === actionId);
  const close = () => { setOpen(false); setActionId(null); setRenameId(null); };
  const openActions = (id: string, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const parent = menuRoot.current?.getBoundingClientRect() || rect;
    const width = 184;
    const height = 184;
    let left = parent.right + 8;
    let top = Math.min(rect.top, window.innerHeight - height - 8);
    if (left + width > window.innerWidth - 8) {
      left = parent.left - width - 8;
      if (left < 8) { left = Math.max(8, window.innerWidth - width - 8); top = Math.min(rect.bottom + 8, window.innerHeight - height - 8); }
    }
    setPosition({ left, top: Math.max(8, top) });
    setActionId((current) => current === id ? null : id);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !actionMenu.current?.contains(event.target as Node)) { setOpen(false); setActionId(null); setRenameId(null); } };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (actionId) { setActionId(null); rowTriggers.current.get(actionId)?.focus(); }
      else if (renameId) { setRenameId(null); rowTriggers.current.get(renameId)?.focus(); }
      else { setOpen(false); trigger.current?.focus(); }
    };
    const resize = () => setActionId(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", resize); };
  }, [open, actionId, renameId]);
  return <>
    <div ref={root} className="canvas-switcher">
      <button ref={trigger} type="button" className="canvas-switcher-trigger" aria-label={`切换画布，当前${active?.name || "画布"}`} aria-expanded={open} aria-haspopup="dialog" disabled={busy} onClick={() => { setOpen((value) => !value); setActionId(null); setRenameId(null); }}>
        <span>{active?.name || "画布"}</span>{busy ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
      </button>
      {open && <div ref={menuRoot} className="canvas-switcher-menu" role="dialog" aria-label="项目内的画布">
        <div className="canvas-switcher-heading"><span>画布</span><button type="button" aria-label="新增画布" title="新增画布" disabled={busy} onClick={() => { close(); onCreate(); }}><Plus size={16} /></button></div>
        <div className="canvas-switcher-list" onScroll={() => setActionId(null)}>{canvases.map((canvas) => <div key={canvas.id} className="canvas-switcher-row" data-actions-open={actionId === canvas.id || undefined}>
          {renameId === canvas.id ? <form className="canvas-switcher-inline-rename" onSubmit={async (event) => { event.preventDefault(); if (!draft.trim() || renaming) return; setRenaming(true); try { if (await onRename(canvas.id, draft.trim())) { close(); trigger.current?.focus(); } } finally { setRenaming(false); } }}>
            <input autoFocus aria-label={`重命名画布：${canvas.name}`} value={draft} maxLength={60} disabled={renaming} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} />
            <button type="submit" aria-label="保存画布名称" disabled={!draft.trim() || renaming}>{renaming ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}</button>
            <button type="button" aria-label="取消重命名" disabled={renaming} onClick={() => setRenameId(null)}><X size={14} /></button>
          </form> : <>
            <button className="canvas-switcher-row-name" type="button" disabled={busy} aria-current={canvas.id === activeId ? "true" : undefined} onClick={() => { close(); if (canvas.id !== activeId) onSwitch(canvas.id); }}><span>{canvas.name}</span></button>
            <div className="canvas-switcher-row-status">{canvas.id === activeId && <Check className="canvas-switcher-row-check" size={15} aria-hidden />}
              <button ref={(element) => { if (element) rowTriggers.current.set(canvas.id, element); else rowTriggers.current.delete(canvas.id); }} type="button" className="canvas-switcher-row-more" aria-label={`${canvas.name}更多操作`} title="更多操作" aria-haspopup="menu" aria-expanded={actionId === canvas.id} aria-controls={actionId === canvas.id ? submenuId : undefined} disabled={busy} onClick={(event) => openActions(canvas.id, event.currentTarget)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); openActions(canvas.id, event.currentTarget); requestAnimationFrame(() => actionMenu.current?.querySelector<HTMLButtonElement>("button")?.focus()); } }}><MoreHorizontal size={17} /></button>
            </div>
          </>}
        </div>)}</div>
      </div>}
    </div>
    {open && actionCanvas && createPortal(<div ref={actionMenu} id={submenuId} className="canvas-switcher-actions" style={position} role="menu" aria-label={`${actionCanvas.name}操作`} onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      <button type="button" role="menuitem" onClick={() => { close(); onOpen(actionCanvas.id); }}>在新窗口打开</button>
      <button type="button" role="menuitem" onClick={() => { setDraft(actionCanvas.name); setRenameId(actionCanvas.id); setActionId(null); }}>重命名画布</button>
      <button type="button" role="menuitem" onClick={() => { close(); onCopy(actionCanvas.id); }}>复制画布</button>
      <button type="button" role="menuitem" disabled={canvases.length <= 1} title={canvases.length <= 1 ? "至少保留一张画布" : undefined} onClick={() => { close(); onDelete(actionCanvas.id); }}>删除画布</button>
    </div>, document.body)}
    <div className="canvas-view-switch" role="group" aria-label="画布视图">
      <button type="button" aria-label="工作流" title="工作流" aria-pressed={viewMode === "workflow"} disabled={busy} onClick={() => onViewChange("workflow")}><Workflow size={16} /></button>
      <button type="button" aria-label="故事板" title="故事板" aria-pressed={viewMode === "storyboard"} disabled={busy} onClick={() => onViewChange("storyboard")}><Columns2 size={16} /></button>
    </div>
  </>;
}
