"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Clapperboard } from "lucide-react";

/** 底栏「模式」下拉(对齐参考产品的生成模式选择器):触发胶囊显示当前模式,
 *  面板列出该模型可用的全部模式;因连接素材不满足而不可用的模式置灰并附
 *  连接要求说明(原顶部 Tab 行的 hover 提示语义收进面板项内)。
 *  与 VideoParamPicker 同法用 fixed portal 出面板,不被卡片 overflow 裁剪。 */
export function VideoModeDropdown({ tabs, value, onChange, enabledOf, hintOf }: {
  tabs: string[];
  value: string;
  onChange: (tab: string) => void;
  enabledOf: (tab: string) => boolean;
  /** 该模式的连接要求说明(无门槛模式返回 undefined) */
  hintOf: (tab: string) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const PANEL_W = 236;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const toggle = (e: React.MouseEvent) => {
    stop(e);
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const nextOpenUp = window.innerHeight - rect.bottom < 320;
      const left = Math.min(Math.max(12, Math.round(rect.left)), Math.max(12, window.innerWidth - PANEL_W - 12));
      setOpenUp(nextOpenUp);
      setPanelPos({ left, top: Math.round(nextOpenUp ? rect.top - 8 : rect.bottom + 8) });
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={containerRef} onMouseDown={stop}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="生成模式"
        className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-2 text-xs text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/35 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <Clapperboard className="h-3.5 w-3.5 shrink-0" />
        <span>{value}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          className={`fixed z-50 w-[236px] rounded-2xl border border-neutral-200/80 bg-white/95 p-1.5 text-left shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/95 dark:shadow-black/55 ${openUp ? "-translate-y-full" : ""}`}
          style={{ left: panelPos.left, top: panelPos.top }}
          onMouseDown={stop}
        >
          <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
            <span>生成模式</span>
            <span className="font-normal text-neutral-400 dark:text-neutral-500">选择工作流</span>
          </div>
          {tabs.map((t) => {
            const enabled = enabledOf(t);
            const hint = hintOf(t);
            return (
              <button
                key={t}
                type="button"
                disabled={!enabled}
                onClick={(e) => { stop(e); onChange(t); setOpen(false); }}
                className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/35 ${
                  enabled
                    ? t === value ? "bg-neutral-100/85 dark:bg-white/10" : "hover:bg-neutral-100/65 dark:hover:bg-white/[0.07]"
                    : "cursor-not-allowed opacity-45"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] leading-5 ${t === value ? "font-semibold text-neutral-950 dark:text-white" : "text-neutral-700 dark:text-neutral-300"}`}>
                    {t}
                  </span>
                  {hint && (
                    <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">{hint}</span>
                  )}
                </span>
                {t === value && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
