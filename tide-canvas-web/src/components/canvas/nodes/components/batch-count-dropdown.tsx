"use client";

import { Menu } from "@mantine/core";
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

// 与参数面板共用浮层定位，窗口变化或节点移动后仍跟随触发器。
export function BatchCountDropdown({ value, options, open, onOpenChange, onChange, variant = "default", align = "left" }: BatchCountDropdownProps) {
  const normalizedOptions = normalizeBatchOptions(options);
  const effectiveValue = normalizedOptions.includes(value) ? value : normalizedOptions[0] ?? 1;

  return (
    <Menu
      opened={open}
      onChange={onOpenChange}
      width={156}
      position={align === "right" ? "bottom-end" : "bottom-start"}
      offset={8}
      withinPortal
      floatingStrategy="fixed"
      zIndex={110}
      shadow="none"
      radius={12}
      returnFocus
      middlewares={{ flip: true, shift: { padding: 12 } }}
      transitionProps={{ duration: 100, transition: "fade" }}
    >
      <Menu.Target>
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={cn(styles.trigger, variant === "ghost" && styles.triggerGhost)}
          title="选择图片张数"
        >
          <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{effectiveValue} 张</span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </Menu.Target>
      <Menu.Dropdown aria-label="图片张数" className={styles.batchPanel} onMouseDown={(event) => event.stopPropagation()}>
        <Menu.Label className={styles.batchTitle}>图片张数</Menu.Label>
        {normalizedOptions.map((count) => (
          <Menu.Item
            key={count}
            aria-label={`${count} 张${effectiveValue === count ? "，已选择" : ""}`}
            data-selected={effectiveValue === count || undefined}
            className={styles.batchOption}
            rightSection={effectiveValue === count ? <Check size={14} strokeWidth={1.8} aria-hidden /> : null}
            onClick={() => onChange(count)}
          >
            {count} 张
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
