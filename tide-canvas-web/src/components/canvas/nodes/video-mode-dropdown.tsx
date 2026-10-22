"use client";

import { useState } from "react";
import { Popover } from "@mantine/core";
import { Check, ChevronDown, Clapperboard } from "lucide-react";
import styles from "./styles/parameter-dropdown.module.css";

/** Model-supported video modes, with the reference requirements kept visible. */
export function VideoModeDropdown({ tabs, value, onChange, enabledOf, hintOf }: {
  tabs: string[];
  value: string;
  onChange: (tab: string) => void;
  enabledOf: (tab: string) => boolean;
  hintOf: (tab: string) => string | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" offset={8}
      width={256} withinPortal floatingStrategy="fixed" zIndex={110} radius={12}
      shadow="none" middlewares={{ flip: true, shift: { padding: 12, crossAxis: true } }}
      clickOutsideEvents={["pointerdown"]} transitionProps={{ duration: 100, transition: "fade" }}>
      <Popover.Target>
        <button type="button" className={styles.trigger} aria-haspopup="dialog" aria-expanded={open}
          aria-label={`生成模式，当前${value}`} title="生成模式"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); setOpen(!open); }}
          onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); } }}>
          <Clapperboard className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className={styles.triggerText}>{value}</span>
          <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </Popover.Target>
      <Popover.Dropdown role="dialog" aria-label="视频生成模式" className={styles.batchPanel}
        onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.batchTitle}>生成模式</div>
        {tabs.map((tab) => (
          <button key={tab} type="button" disabled={!enabledOf(tab)} aria-pressed={tab === value}
            data-selected={tab === value || undefined}
            className={`${styles.batchOption} flex w-full items-center gap-3 text-left disabled:cursor-default disabled:opacity-45`}
            onClick={() => { onChange(tab); setOpen(false); }}>
            <span className="min-w-0 flex-1">
              <span className="block">{tab}</span>
              {hintOf(tab) && <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{hintOf(tab)}</span>}
            </span>
            {tab === value && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          </button>
        ))}
      </Popover.Dropdown>
    </Popover>
  );
}
