"use client";

import { useCallback, useRef } from "react";
import { Popover } from "@mantine/core";
import { Check, ChevronDown, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDismissibleCanvasOverlay, useExclusiveCanvasOverlay } from "../../canvas-overlay-coordinator";
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
  composer?: boolean;
}

// 中文注释：图片张数单独成组件，避免和画质/尺寸设置耦合，后续支持更多批量策略也更清晰。
export function BatchCountDropdown({ value, options, open, onOpenChange, onChange, variant = "default", align = "left", composer = false }: BatchCountDropdownProps) {
  const normalizedOptions = normalizeBatchOptions(options);
  const effectiveValue = normalizedOptions.includes(value) ? value : normalizedOptions[0] ?? 1;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeOverlay = useCallback(() => onOpenChange(false), [onOpenChange]);
  const announceOpen = useExclusiveCanvasOverlay(open, closeOverlay, "batch-count");
  useDismissibleCanvasOverlay(open, closeOverlay, [triggerRef, panelRef]);

  return (
    <Popover
      opened={open}
      onChange={onOpenChange}
      width={156}
      position={composer ? "top-end" : align === "right" ? "bottom-end" : "bottom-start"}
      offset={8}
      withinPortal
      floatingStrategy="fixed"
      zIndex={1200}
      radius={10}
      shadow="none"
      middlewares={{ flip: true, shift: { padding: 12 }, inline: true }}
      transitionProps={{ duration: 120, transition: "pop" }}
    >
      <Popover.Target>
        <button
          ref={triggerRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!open) announceOpen();
            onOpenChange(!open);
          }}
          className={cn(styles.trigger, variant === "ghost" && styles.triggerGhost, composer && styles.triggerComposer)}
          title="选择图片张数"
          aria-expanded={open}
        >
          <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{effectiveValue}张</span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} />
        </button>
      </Popover.Target>

      <Popover.Dropdown ref={panelRef} className={cn(styles.countMenu, composer && styles.countMenuComposer)} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className={styles.countTitle}>生成张数</div>
        {normalizedOptions.map((count) => (
          <button
            key={count}
            type="button"
            onClick={() => {
              onChange(count);
              onOpenChange(false);
            }}
            className={cn(styles.countItem, effectiveValue === count && styles.countItemActive)}
          >
            <span>{count}张</span>
            {effectiveValue === count && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </Popover.Dropdown>
    </Popover>
  );
}
