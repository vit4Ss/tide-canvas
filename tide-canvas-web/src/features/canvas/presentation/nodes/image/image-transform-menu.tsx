"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crop, Loader2, RotateCw } from "lucide-react";
import { stopEvent } from "@/components/canvas/nodes/shared/node-utils";

const CROP_OPTIONS = [
  { ratio: "1:1", aspect: 1 },
  { ratio: "3:4", aspect: 3 / 4 },
  { ratio: "4:3", aspect: 4 / 3 },
  { ratio: "9:16", aspect: 9 / 16 },
  { ratio: "16:9", aspect: 16 / 9 },
] as const;

const ROTATE_OPTIONS = [
  { label: "向左旋转 90°", degrees: -90 },
  { label: "向右旋转 90°", degrees: 90 },
  { label: "旋转 180°", degrees: 180 },
] as const;

interface ImageTransformMenuProps {
  mode: "crop" | "rotate";
  busy: boolean;
  onCrop?: (ratio: string, aspect: number) => void;
  onRotate?: (degrees: -90 | 90 | 180) => void;
}

export function ImageTransformMenu({
  mode,
  busy,
  onCrop,
  onRotate,
}: ImageTransformMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    opensUpward: boolean;
  } | null>(null);
  const isCrop = mode === "crop";
  const Icon = isCrop ? Crop : RotateCw;

  const close = useCallback((refocus = true): void => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 160;
    const estimatedHeight = (isCrop ? CROP_OPTIONS.length : ROTATE_OPTIONS.length) * 36 + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const opensUpward = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    setPosition({
      left: Math.max(8, rect.right - menuWidth),
      top: opensUpward ? rect.top : rect.bottom,
      opensUpward,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [close, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={stopEvent}
        onClick={(event) => {
          stopEvent(event);
          if (open) close(false);
          else openMenu();
        }}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-55 ${open ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
      >
        {busy
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          : <Icon className="h-4 w-4" aria-hidden />}
        {isCrop ? "裁剪" : "旋转"}
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[90] w-40 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
          style={{
            left: position.left,
            ...(position.opensUpward
              ? { bottom: window.innerHeight - position.top + 4 }
              : { top: position.top + 4 }),
          }}
        >
          {isCrop
            ? CROP_OPTIONS.map(({ ratio, aspect }) => (
                <button
                  type="button"
                  role="menuitem"
                  key={ratio}
                  onClick={() => {
                    close();
                    onCrop?.(ratio, aspect);
                  }}
                  className="flex h-9 w-full items-center justify-between rounded-md px-2.5 text-[13px] text-popover-foreground transition-colors hover:bg-accent"
                >
                  <span>裁剪为 {ratio}</span>
                  <span className="text-[11px] text-muted-foreground">居中</span>
                </button>
              ))
            : ROTATE_OPTIONS.map(({ label, degrees }) => (
                <button
                  type="button"
                  role="menuitem"
                  key={degrees}
                  onClick={() => {
                    close();
                    onRotate?.(degrees);
                  }}
                  className="flex h-9 w-full items-center rounded-md px-2.5 text-[13px] text-popover-foreground transition-colors hover:bg-accent"
                >
                  {label}
                </button>
              ))}
        </div>,
        document.body,
      )}
    </>
  );
}
