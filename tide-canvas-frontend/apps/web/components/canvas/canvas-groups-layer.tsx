"use client";

import { useState } from "react";
import { Ungroup, Palette, Check } from "lucide-react";
import { useCanvasStore, GROUP_COLORS, type CanvasGroup, type CanvasNode } from "@/stores/use-canvas-store";

// 边框相对成员包围盒的内边距 / 标题栏高度（世界坐标，随画布缩放）
const PAD = 28;
const TITLE_H = 34;
const DRAG_THRESHOLD = 4;

interface LayerProps {
  groups: CanvasGroup[];
  nodes: CanvasNode[];
  selectedNodeIds: Set<string>;
}

/**
 * 分组层（libTV 风格）：每个分组按成员节点的包围盒实时画出带标题栏的圆角边框，渲染在节点之下。
 * 边框本体 pointer-events-none 不挡节点交互；仅标题栏可交互（拖动整体移动 / 双击改名 / 改色 / 解组）。
 */
export function CanvasGroupsLayer({ groups, nodes, selectedNodeIds }: LayerProps) {
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map((g) => {
        const members = nodes.filter((n) => g.nodeIds.includes(n.id));
        if (members.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of members) {
          const w = n.contentW ?? n.width;
          const h = n.contentH ?? n.height;
          if (n.x < minX) minX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.x + w > maxX) maxX = n.x + w;
          if (n.y + h > maxY) maxY = n.y + h;
        }
        const active = g.nodeIds.every((id) => selectedNodeIds.has(id));
        return (
          <CanvasGroupFrame
            key={g.id}
            group={g}
            active={active}
            left={minX - PAD}
            top={minY - PAD - TITLE_H}
            width={maxX - minX + PAD * 2}
            height={maxY - minY + PAD * 2 + TITLE_H}
          />
        );
      })}
    </>
  );
}

interface FrameProps {
  group: CanvasGroup;
  active: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

function CanvasGroupFrame({ group, active, left, top, width, height }: FrameProps) {
  const updateGroup = useCanvasStore((s) => s.updateGroup);
  const removeGroup = useCanvasStore((s) => s.removeGroup);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.title);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const startEdit = () => { setName(group.title); setEditing(true); };

  // 拖标题栏 → 整组成员同步平移（首帧记历史，可撤销）；未拖动则选中成员
  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    const store = useCanvasStore.getState();
    const initials = store.nodes
      .filter((n) => group.nodeIds.includes(n.id))
      .map((n) => ({ id: n.id, x: n.x, y: n.y }));
    const sx = e.clientX, sy = e.clientY;
    let moved = false, recorded = false;
    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < DRAG_THRESHOLD && Math.abs(ev.clientY - sy) < DRAG_THRESHOLD) return;
      moved = true;
      if (!recorded) { store.pushHistory(); recorded = true; }
      const k = useCanvasStore.getState().transform.k;
      const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      store.updateNodePositions(initials.map((i) => ({ id: i.id, x: i.x + dx, y: i.y + dy })));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!moved) store.selectMany(group.nodeIds);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const commitName = () => {
    setEditing(false);
    const t = name.trim();
    if (t && t !== group.title) updateGroup(group.id, { title: t });
    else setName(group.title);
  };

  return (
    <div
      className="pointer-events-none absolute rounded-2xl"
      style={{
        left, top, width, height,
        border: `2px solid ${group.color}${active ? "" : "99"}`,
        backgroundColor: `${group.color}14`,
        boxShadow: active ? `0 0 0 3px ${group.color}33` : undefined,
      }}
    >
      <div
        className="group/gp pointer-events-auto absolute inset-x-0 top-0 flex h-[34px] cursor-grab active:cursor-grabbing items-center gap-1.5 rounded-t-2xl px-2.5"
        style={{ backgroundColor: `${group.color}26` }}
        onMouseDown={startDrag}
        onDoubleClick={(e) => { stop(e); startEdit(); }}
        title="拖动移动分组 · 双击重命名"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onMouseDown={stop}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") { setEditing(false); setName(group.title); }
            }}
            className="h-5 min-w-0 flex-1 rounded border-0 bg-white/85 px-1.5 text-xs font-medium text-neutral-800 outline-none dark:bg-neutral-900/85 dark:text-neutral-100"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-700 dark:text-neutral-100">
            {group.title}
          </span>
        )}

        <div className="relative flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/gp:opacity-100">
          <button
            onMouseDown={stop}
            onClick={(e) => { stop(e); setPaletteOpen((v) => !v); }}
            title="分组颜色"
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-600 hover:bg-black/10 dark:text-neutral-200 dark:hover:bg-white/10"
          >
            <Palette className="h-3.5 w-3.5" />
          </button>
          <button
            onMouseDown={stop}
            onClick={(e) => { stop(e); removeGroup(group.id); }}
            title="解组（保留节点）"
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-600 hover:bg-black/10 dark:text-neutral-200 dark:hover:bg-white/10"
          >
            <Ungroup className="h-3.5 w-3.5" />
          </button>
          {paletteOpen && (
            <div
              onMouseDown={stop}
              className="absolute right-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            >
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); updateGroup(group.id, { color: c }); setPaletteOpen(false); }}
                  className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ backgroundColor: c }}
                >
                  {c === group.color && <Check className="h-3 w-3 text-white" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
