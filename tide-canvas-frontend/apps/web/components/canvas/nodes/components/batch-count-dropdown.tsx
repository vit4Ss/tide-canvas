"use client";

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

// 中文注释：图片张数单独成组件，避免和画质/尺寸设置耦合，后续支持更多批量策略也更清晰。
export function BatchCountDropdown({ value, options, open, onOpenChange, onChange, variant = "default", align = "left" }: BatchCountDropdownProps) {
  const normalizedOptions = normalizeBatchOptions(options);
  const effectiveValue = normalizedOptions.includes(value) ? value : normalizedOptions[0] ?? 1;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        className={cn(styles.trigger, variant === "ghost" && styles.triggerGhost)}
        title="选择图片张数"
        aria-expanded={open}
      >
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span>{effectiveValue}张</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} />
          <div className={cn("absolute top-full z-50 mt-2", align === "right" ? "right-0" : "left-0", styles.countMenu)}>
            <div className={styles.countTitle}>图片张数</div>
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
          </div>
        </>
      )}
    </div>
  );
}
