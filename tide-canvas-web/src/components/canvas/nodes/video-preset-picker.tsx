"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "@mantine/core";
import { Camera, Check, ChevronDown, Search, Sparkles, X } from "lucide-react";
import { findVideoPreset, videoPresetsFor, type VideoPresetKind } from "./video-creative-presets";

export interface VideoPresetPickerProps {
  kind: VideoPresetKind;
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
}

export function VideoPresetPicker({ kind, value, onChange, disabled = false }: VideoPresetPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>();
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const listId = useId();
  const titleId = useId();
  const label = kind === "effect" ? "特效" : "运镜";
  const Icon = kind === "effect" ? Sparkles : Camera;
  const selected = findVideoPreset(kind, value);
  const search = query.trim().toLocaleLowerCase();
  const filtered = videoPresetsFor(kind).filter((preset) => `${preset.label} ${preset.description}`.toLocaleLowerCase().includes(search));
  const active = filtered.find((preset) => preset.id === activeId)
    ?? filtered.find((preset) => preset.id === value) ?? filtered[0];

  const choose = (id: string | undefined) => {
    if (disabled) return;
    onChange(id);
    setOpen(false);
  };
  const focusOption = (index: number) => {
    const preset = filtered[Math.max(0, Math.min(filtered.length - 1, index))];
    if (!preset) return;
    setActiveId(preset.id);
    optionRefs.current.get(preset.id)?.focus();
    optionRefs.current.get(preset.id)?.scrollIntoView({ block: "nearest" });
  };
  const navigate = (event: KeyboardEvent, index: number) => {
    const next = event.key === "ArrowDown" ? index + 1
      : event.key === "ArrowUp" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    focusOption(next);
  };

  return <Popover opened={open && !disabled} onChange={setOpen} position="bottom-start" offset={8}
    withinPortal zIndex={110} floatingStrategy="fixed" trapFocus returnFocus
    middlewares={{ flip: true, shift: { padding: 12, crossAxis: true } }} clickOutsideEvents={["pointerdown"]}>
    <Popover.Target>
      <button type="button" disabled={disabled} className="image-composer-chip"
        aria-label={selected ? `${label}：${selected.label}` : `选择${label}`}
        aria-haspopup="dialog" aria-expanded={open && !disabled} title={selected?.description ?? `选择${label}`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}
        onClick={() => { setQuery(""); setActiveId(value); setOpen((current) => !current); }}>
        <Icon size={14} aria-hidden />
        <span className="max-w-28 truncate">{selected?.label ?? label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
    </Popover.Target>
    <Popover.Dropdown className="node-composer-popover" w={360} p={12}
      style={{ maxWidth: "calc(100vw - 24px)" }} role="dialog" aria-labelledby={titleId}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id={titleId} className="text-sm font-medium text-[var(--foreground)]">{label}</h3>
        <button type="button" disabled={!selected} onClick={() => choose(undefined)}
          className="h-7 rounded-md px-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--canvas-menu-hover)] hover:text-[var(--foreground)] disabled:cursor-default disabled:opacity-40">
          清除选择
        </button>
      </div>
      <div className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-2.5">
        <Search size={14} className="shrink-0 text-[var(--muted-foreground)]" aria-hidden />
        <input data-autofocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveId(undefined); }}
          aria-label={`搜索${label}`} aria-controls={listId} placeholder={`搜索${label}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); focusOption(0); }
            if (event.key === "ArrowUp") { event.preventDefault(); focusOption(filtered.length - 1); }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]" />
        {query && <button type="button" onClick={() => { setQuery(""); setActiveId(undefined); }}
          aria-label="清除搜索" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--canvas-menu-hover)]">
          <X size={13} aria-hidden />
        </button>}
      </div>
      <div id={listId} role="listbox" aria-label={`选择${label}`} className="max-h-72 overflow-y-auto overscroll-contain">
        {filtered.map((preset, index) => <button key={preset.id} type="button" role="option"
          aria-selected={preset.id === value} tabIndex={active?.id === preset.id ? 0 : -1}
          ref={(element) => { if (element) optionRefs.current.set(preset.id, element); else optionRefs.current.delete(preset.id); }}
          onFocus={() => setActiveId(preset.id)} onKeyDown={(event) => navigate(event, index)}
          onClick={() => choose(preset.id)}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--canvas-menu-hover)] aria-selected:bg-[var(--accent)]">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-5 text-[var(--foreground)]">{preset.label}</span>
            <span className="block text-xs leading-5 text-[var(--muted-foreground)]">{preset.description}</span>
          </span>
          {preset.id === value && <Check size={15} className="shrink-0 text-[var(--foreground)]" aria-hidden />}
        </button>)}
        {!filtered.length && <p role="status" className="px-2 py-8 text-center text-xs text-[var(--muted-foreground)]">没有匹配的{label}，试试其他关键词</p>}
      </div>
      <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] leading-4 text-[var(--muted-foreground)]">选中后用于指导视频生成，可随时清除。</p>
    </Popover.Dropdown>
  </Popover>;
}
