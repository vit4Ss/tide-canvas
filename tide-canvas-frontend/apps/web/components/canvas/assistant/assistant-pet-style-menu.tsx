"use client";

import type { RefObject } from "react";
import { Bot, Check, Palette, RefreshCw } from "lucide-react";
import type { AssistantPetStyle } from "@/types/assistant";
import { AssistantPetSprite } from "./assistant-pet-sprite";

interface AssistantPetStyleMenuProps {
  rootRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  styles: AssistantPetStyle[];
  loading: boolean;
  selectedStyleId: string | null;
  defaultStyle: AssistantPetStyle | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (style: AssistantPetStyle | null) => void;
  onReload: () => void;
}

export function AssistantPetStyleMenu({
  rootRef,
  open,
  styles,
  loading,
  selectedStyleId,
  defaultStyle,
  onOpenChange,
  onSelect,
  onReload,
}: AssistantPetStyleMenuProps) {
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={(open ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white") + " flex h-8 w-8 items-center justify-center rounded-lg transition-colors"}
        title="选择助手样式"
        aria-label="选择助手样式"
        aria-expanded={open}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-40 w-[288px] rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl shadow-neutral-900/10 dark:border-white/10 dark:bg-[#222329]">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <div className="text-sm font-semibold text-neutral-950 dark:text-white">助手样式</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">选择管理员启用的样式</div>
            </div>
            <button
              type="button"
              onClick={onReload}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
              title="刷新样式"
              aria-label="刷新样式"
            >
              <RefreshCw className={(loading ? "animate-spin" : "") + " h-3.5 w-3.5"} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onSelect(null)}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
              {defaultStyle?.imageUrl ? (
                <AssistantPetSprite petStyle={defaultStyle} size={34} alt={defaultStyle.name} />
              ) : (
                <Bot className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-neutral-950 dark:text-white">跟随默认</span>
              <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                {defaultStyle?.name ?? "管理员未设置默认样式"}
              </span>
            </span>
            {!selectedStyleId && <Check className="h-4 w-4 text-neutral-950 dark:text-white" />}
          </button>

          <div className="mt-1 max-h-[320px] space-y-1 overflow-y-auto pr-1">
            {styles.length === 0 && (
              <div className="rounded-xl px-3 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                管理员暂未启用样式
              </div>
            )}

            {styles.map((style) => (
              <button
                key={style.id}
                type="button"
                onClick={() => onSelect(style)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-white/10"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-100 dark:bg-white/10">
                  <AssistantPetSprite petStyle={style} size={34} alt={style.name} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-950 dark:text-white">{style.name}</span>
                  <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {style.isDefault ? "管理员默认" : "可选样式"}
                  </span>
                </span>
                {selectedStyleId === style.id && <Check className="h-4 w-4 text-neutral-950 dark:text-white" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
