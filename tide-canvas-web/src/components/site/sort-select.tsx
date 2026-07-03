"use client";

/* ============================================================================
   SortSelect — 站内自绘下拉（替代原生 <select>，其弹出菜单是系统绘制、无法
   贴合设计语言）。药丸触发器 + 玻璃卡弹层，样式在 pages.css 的 .sst 系列；
   暗场（.xp-hero 内）自动切换深色变体。

   行为：点击开合、选项单选即关、Escape / 点击外部关闭。
   ========================================================================== */

import { useEffect, useRef, useState } from "react";

export type SortOption = { value: string; label: string };

export default function SortSelect({
  value,
  options,
  onChange,
  ariaLabel = "排序方式",
}: {
  value: string;
  options: readonly SortOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Escape 关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cur = options.find((o) => o.value === value);

  return (
    <div className={`sst${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="sst-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{cur?.label ?? ""}</span>
        <i className="sst-ar" aria-hidden />
      </button>
      {open && (
        <div className="sst-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`sst-it${o.value === value ? " on" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              <i className="ck" aria-hidden>
                ✓
              </i>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
