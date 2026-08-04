"use client";

/* PopoverSelect — 原生 <select> 的自绘替代，统一画布/面板的下拉词汇。
   - portal + fixed 定位，下方空间不足自动上翻（collision flip），不被 overflow 容器裁切
   - Esc / 外部点击关闭，关闭后焦点回触发器；↑↓/Enter/Space 键盘操作
   - 视觉只吃设计令牌：bg-popover / border / shadow-lg / rounded-lg / ring
   z 分层约定：body portal 下拉 = 90。 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PopoverSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function PopoverSelect({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
  menuClassName,
}: {
  value: string;
  options: PopoverSelectOption[];
  onChange: (value: string) => void;
  /** 无障碍名（触发器无可见文本标签时必传） */
  label?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean; width: number } | null>(null);

  const current = options.find((o) => o.value === value);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const estHeight = Math.min(options.length, 8) * 36 + 12;
    const below = window.innerHeight - r.bottom;
    const up = below < estHeight && r.top > below;
    setPos({ left: r.left, top: up ? r.top : r.bottom, up, width: Math.max(r.width, 140) });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  const pick = (idx: number) => {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || open) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "inline-flex items-center justify-between gap-1.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground transition-colors",
          "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={(el) => {
                menuRef.current = el;
                el?.focus();
              }}
              role="listbox"
              aria-label={label}
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              className={cn(
                "fixed z-[90] max-h-72 overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
                menuClassName,
              )}
              style={{
                left: pos.left,
                width: pos.width,
                ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
              }}
            >
              {options.map((opt, i) => (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  aria-disabled={opt.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    i === active && "bg-accent",
                    opt.disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", opt.value === value ? "opacity-100" : "opacity-0")} aria-hidden />
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
