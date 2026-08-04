"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "../styles/parameter-dropdown.module.css";
import { normalizeBatchOptions } from "../utils/quality-ratio";

interface BatchCountDropdownProps {
  value: number;
  options?: readonly number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: number) => void;
  variant?: "default" | "ghost";
  align?: "left" | "right";
}

const MENU_WIDTH = 144;

// 中文注释：图片张数单独成组件，避免和画质/尺寸设置耦合，后续支持更多批量策略也更清晰。
// 菜单 portal 到 body + fixed 按触发器 rect 定位（下方空间不足上翻），不被节点溢出/相邻节点裁切；
// Esc / 外部点击关闭，关闭后焦点回触发器。视觉与交互词汇对齐 PopoverSelect（z 分层：body portal 下拉 = 90）。
export function BatchCountDropdown({ value, options, open, onOpenChange, onChange, variant = "default", align = "left" }: BatchCountDropdownProps) {
  const normalizedOptions = normalizeBatchOptions(options);
  const effectiveValue = normalizedOptions.includes(value) ? value : normalizedOptions[0] ?? 1;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);

  const close = useCallback(
    (refocus = true) => {
      onOpenChange(false);
      if (refocus) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  // 打开时按触发器 rect 计算 fixed 定位（相对视口，脱离画布 transform 层）
  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estHeight = normalizedOptions.length * 34 + 40; // 标题 + 上下 padding 余量
    const below = window.innerHeight - rect.bottom;
    const up = below < estHeight && rect.top > below;
    const left = align === "right" ? rect.right - MENU_WIDTH : rect.left;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8)),
      top: up ? rect.top : rect.bottom,
      up,
    });
  }, [open, align, normalizedOptions.length]);

  // Esc + 外部点击关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        className={cn(styles.trigger, variant === "ghost" && styles.triggerGhost, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        title="选择图片张数"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span>{effectiveValue}张</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="图片张数"
              className="fixed z-[90] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{
                left: pos.left,
                width: MENU_WIDTH,
                ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
              }}
            >
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">图片张数</div>
              {normalizedOptions.map((count) => (
                <button
                  key={count}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChange(count);
                    close();
                  }}
                  className={cn(
                    "flex h-8 w-full items-center justify-between rounded-md px-2 text-[13px] font-medium transition-colors hover:bg-accent",
                    effectiveValue === count && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  <span>{count}张</span>
                  {effectiveValue === count && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
