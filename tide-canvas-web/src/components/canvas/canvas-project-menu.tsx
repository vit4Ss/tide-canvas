"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Layers2 } from "lucide-react";

export function CanvasProjectMenu({ disabled, onNavigate, onDelete }: { disabled: boolean; onNavigate: (path: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const navigate = (path: string) => { setOpen(false); onNavigate(path); };
  return <div ref={root} className="canvas-project-menu">
    <button ref={trigger} type="button" className="canvas-project-home" aria-label="项目菜单" title="项目菜单" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>("button")?.focus()); } }}><Layers2 size={19} strokeWidth={1.8} aria-hidden /><ChevronDown size={11} className={open ? "canvas-menu-chevron-open" : undefined} aria-hidden /></button>
    {open && <div ref={menu} className="canvas-project-menu-items" role="menu" aria-label="项目操作" onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      <button type="button" role="menuitem" onClick={() => navigate("/")}>回到主页</button>
      <button type="button" role="menuitem" onClick={() => navigate("/projects")}>全部项目</button>
      <div className="canvas-project-menu-divider" role="separator" />
      <button type="button" role="menuitem" onClick={() => navigate("/canvas/new")}>创建新项目</button>
      <button type="button" role="menuitem" className="canvas-project-delete" onClick={() => { setOpen(false); onDelete(); }}>删除项目</button>
    </div>}
  </div>;
}
