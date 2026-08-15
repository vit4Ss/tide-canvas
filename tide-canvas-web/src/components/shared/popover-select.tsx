"use client";

/* PopoverSelect — 原生 <select> 的自绘替代，统一画布/面板的下拉词汇。
   - portal + fixed 定位，下方空间不足自动上翻（collision flip），不被 overflow 容器裁切
   - Esc / 外部点击关闭，关闭后焦点回触发器；↑↓/Enter/Space 键盘操作
   - 默认视觉使用站点设计令牌；director 视觉用于深色沉浸式工作台
   z 分层约定：body portal 下拉 = 260，高于业务弹窗（最高 240），低于媒体预览（300）和 Toast。 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PopoverSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type PopoverSelectTone = "default" | "dark" | "director";

export function PopoverSelect({
  value,
  options,
  onChange,
  id,
  label,
  ariaDescribedBy,
  invalid,
  disabled,
  className,
  menuClassName,
  tone = "default",
  minMenuWidth = 140,
}: {
  value: string;
  options: PopoverSelectOption[];
  onChange: (value: string) => void;
  id?: string;
  /** 无障碍名（触发器无可见文本标签时必传） */
  label?: string;
  ariaDescribedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  /** 常驻深色面板使用 dark，3D 导演台使用 director；默认跟随站点设计令牌。 */
  tone?: PopoverSelectTone;
  minMenuWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const typeaheadRef = useRef({ text: "", at: 0 });
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    up: boolean;
    width: number;
    maxHeight: number;
  } | null>(null);

  const current = options.find((o) => o.value === value);
  const menuOpen = open && !disabled;
  const selectedEnabledIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const effectiveActive = options[active] && !options[active]?.disabled
    ? active
    : selectedEnabledIndex >= 0 ? selectedEnabledIndex : options.findIndex((option) => !option.disabled);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const measureMenu = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return false;
    if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return false;
    const viewportPadding = 8;
    const menuGap = 4;
    const estHeight = Math.min(options.length, 8) * 36 + 12;
    const below = window.innerHeight - r.bottom - viewportPadding;
    const above = r.top - viewportPadding;
    const up = below < estHeight && r.top > below;
    const viewportWidth = Math.max(1, window.innerWidth - viewportPadding * 2);
    const width = Math.min(Math.max(r.width, minMenuWidth), viewportWidth);
    const left = Math.min(
      Math.max(viewportPadding, r.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const availableHeight = Math.max(1, (up ? above : below) - menuGap);
    setPos({
      left,
      top: up ? r.top : r.bottom,
      up,
      width,
      maxHeight: Math.min(288, availableHeight),
    });
    return true;
  }, [minMenuWidth, options.length]);

  const openMenu = useCallback(() => {
    if (!measureMenu()) return;
    const selected = options.findIndex((o) => o.value === value && !o.disabled);
    typeaheadRef.current = { text: "", at: 0 };
    setActive(selected >= 0 ? selected : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }, [measureMenu, options, value]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    const onWheel = (e: WheelEvent) => {
      if (menuRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    const reposition = () => {
      if (!measureMenu()) close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      reposition();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("wheel", onWheel, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen, close, measureMenu]);

  useEffect(() => {
    if (!disabled || !open) return;
    const frame = window.requestAnimationFrame(() => close(false));
    return () => window.cancelAnimationFrame(frame);
  }, [close, disabled, open]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || effectiveActive < 0) return;
    optionRefs.current[effectiveActive]?.scrollIntoView({ block: "nearest" });
  }, [effectiveActive, menuOpen]);

  const pick = (idx: number) => {
    const opt = options[idx];
    if (disabled || !opt || opt.disabled) return;
    if (opt.value !== value) onChange(opt.value);
    close();
  };

  const moveActive = (direction: -1 | 1) => {
    setActive((currentIndex) => {
      const normalizedIndex = options[currentIndex] && !options[currentIndex]?.disabled
        ? currentIndex
        : effectiveActive;
      let index = normalizedIndex < 0
        ? direction > 0 ? -1 : options.length
        : normalizedIndex;
      while (true) {
        index += direction;
        if (index < 0 || index >= options.length) return normalizedIndex;
        if (!options[index]?.disabled) return index;
      }
    });
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || menuOpen) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      openMenu();
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveActive(-1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      const index = e.key === "Home"
        ? options.findIndex((option) => !option.disabled)
        : options.map((option) => !option.disabled).lastIndexOf(true);
      if (index >= 0) setActive(index);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      pick(effectiveActive);
    } else if (e.key === "Tab") {
      // 先把焦点还给触发器，再让浏览器执行默认 Tab 顺序，避免当前菜单卸载后焦点掉到 body。
      // 若外层 focus trap 已在捕获阶段处理了首尾循环，则保留它设置的焦点。
      close(!e.defaultPrevented);
    } else if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      const previous = typeaheadRef.current.text;
      const normalizedKey = e.key.toLocaleLowerCase();
      const repeatedKey = previous.length > 0
        && [...previous].every((character) => character.toLocaleLowerCase() === normalizedKey);
      const search = now - typeaheadRef.current.at > 700 || repeatedKey
        ? e.key
        : `${previous}${e.key}`;
      typeaheadRef.current = { text: search, at: now };
      const normalized = search.toLocaleLowerCase();
      const start = effectiveActive >= 0 ? effectiveActive + 1 : 0;
      const orderedIndexes = [
        ...options.slice(start).map((_, index) => start + index),
        ...options.slice(0, start).map((_, index) => index),
      ];
      const match = orderedIndexes.find((index) => {
        const option = options[index];
        return option && !option.disabled && option.label.toLocaleLowerCase().startsWith(normalized);
      });
      if (match != null) {
        e.preventDefault();
        e.stopPropagation();
        setActive(match);
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-describedby={ariaDescribedBy}
        data-invalid={invalid || undefined}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        data-focus-trap-anchor={menuId}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => (menuOpen ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "inline-flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-[background-color,border-color,box-shadow,color] duration-150 ease-out motion-reduce:transition-none",
          tone === "director"
            ? "border-white/10 bg-white/[0.08] text-white hover:border-white/20 hover:bg-white/[0.12] focus-visible:ring-cyan-300/60"
            : tone === "dark"
              ? "border-white/10 bg-white/[0.06] text-neutral-100 hover:border-white/20 hover:bg-white/[0.1] focus-visible:ring-white/35"
            : "border-border bg-popover text-popover-foreground hover:bg-accent/60 focus-visible:ring-ring",
          "focus-visible:outline-none focus-visible:ring-2",
          "data-[invalid=true]:border-red-500/70 data-[invalid=true]:focus-visible:ring-red-400/40",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-150 motion-reduce:transition-none", menuOpen && "rotate-180")} aria-hidden />
      </button>
      {menuOpen && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-label={label}
              aria-activedescendant={effectiveActive >= 0 ? `${menuId}-option-${effectiveActive}` : undefined}
              data-focus-trap-portal={menuId}
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
              className={cn(
                "fixed overscroll-contain overflow-y-auto rounded-xl border p-1.5 outline-none",
                tone === "director"
                  ? "z-[260] border-white/10 bg-slate-950 text-white shadow-[0_12px_32px_rgba(0,0,0,0.38)] [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
                  : tone === "dark"
                    ? "z-[260] border-white/10 bg-[#1c1c1f] text-neutral-100 shadow-[0_12px_32px_rgba(0,0,0,0.36)] [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
                  : "z-[260] border-border bg-popover text-popover-foreground shadow-md",
                menuClassName,
              )}
              style={{
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
                ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
              }}
            >
              {options.map((opt, i) => (
                <div
                  key={opt.value}
                  ref={(element) => { optionRefs.current[i] = element; }}
                  id={`${menuId}-option-${i}`}
                  role="option"
                  aria-selected={opt.value === value}
                  aria-disabled={opt.disabled}
                  onPointerMove={() => { if (!opt.disabled) setActive(i); }}
                  onClick={() => pick(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 motion-reduce:transition-none",
                    tone === "director"
                      ? opt.value === value
                        ? "bg-white/[0.12] text-white"
                        : i === effectiveActive ? "bg-white/10 text-white" : "text-white/70"
                      : tone === "dark"
                        ? opt.value === value
                          ? "bg-white/[0.14] text-white"
                          : i === effectiveActive ? "bg-white/[0.09] text-white" : "text-neutral-300"
                      : i === effectiveActive && "bg-accent",
                    opt.disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Check className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    opt.value === value
                      ? tone === "director" ? "text-cyan-300 opacity-100" : "opacity-100"
                      : "opacity-0",
                  )} aria-hidden />
                  <span className="truncate">{opt.label}</span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
