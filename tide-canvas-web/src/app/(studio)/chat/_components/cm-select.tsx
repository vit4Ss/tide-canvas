"use client";

/* ── composer dropdown primitives (extracted verbatim from page.tsx) ─────────── */

import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const menuItemsOf = (menu: HTMLDivElement | null) => {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).filter(
    (item) => item.getAttribute("aria-disabled") !== "true" && !(item instanceof HTMLButtonElement && item.disabled),
  );
};

const focusMenuItem = (items: HTMLElement[], index: number) => {
  if (!items.length) return;
  const next = ((index % items.length) + items.length) % items.length;
  items.forEach((item, itemIndex) => {
    item.tabIndex = itemIndex === next ? 0 : -1;
  });
  items[next]?.focus();
};

/** an aspect-ratio glyph box for the ratio dropdown lead/item. */
export function RatioBox({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return <span className="cm-rt" style={{ width: 16, height: 16 }} />;
  const max = 16;
  const bw = Math.round((w / Math.max(w, h)) * max);
  const bh = Math.round((h / Math.max(w, h)) * max);
  return <span className="cm-rt" style={{ width: bw, height: bh }} />;
}

/** A composer dropdown (`.cm-sel` chip + `.cm-menu` popover) matching the design. */
export function CmSelect({
  open,
  onToggle,
  lead,
  label,
  menuH,
  right,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  lead?: React.ReactNode;
  label: React.ReactNode;
  menuH: string;
  right?: boolean;
  children: React.ReactNode;
}) {
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const menuId = useId();

  // Position the menu with fixed coordinates anchored to the chip, so it escapes
  // the horizontally-scrolling chip row's clipping. Recompute on scroll/resize.
  // 视口钳制：上方空间不足时压缩菜单高度（内部可滚动）；左锚菜单不许溢出右缘。
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = chipRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const st: CSSProperties = {
        position: "fixed",
        bottom: window.innerHeight - r.top + 8,
        maxHeight: Math.min(320, Math.max(120, r.top - 16)),
      };
      if (right) st.right = window.innerWidth - r.right;
      else {
        const w = menuRef.current?.offsetWidth ?? 0;
        st.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      }
      setMenuStyle(st);
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, right]);

  // A menu button moves focus into its popup when it opens. Keep just one
  // option in the tab order; arrow keys move that roving tab stop below.
  useLayoutEffect(() => {
    if (!open) return;
    const items = menuItemsOf(menuRef.current);
    const selected = items.findIndex((item) => item.getAttribute("aria-checked") === "true");
    focusMenuItem(items, selected >= 0 ? selected : 0);
  }, [open]);

  return (
    <div className={`cm-sel${open ? " open" : ""}`}>
      <button
        ref={chipRef}
        className="cm-chip"
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          onToggle();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {lead}
        <span className="cm-lab">{label}</span>
        <span className="cv" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className={`cm-menu${right ? " right" : ""}`}
          style={menuStyle}
          role="menu"
          aria-label={menuH}
          onClick={(event) => {
            event.stopPropagation();
            const target = event.target as HTMLElement;
            if (!target.closest('[role="menuitemradio"]')) return;
            // Every current option closes through its existing business handler.
            // Restore focus only after that controlled update has unmounted the menu.
            queueMicrotask(() => chipRef.current?.focus());
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              // Let the browser complete its normal Tab / Shift+Tab move first;
              // closing synchronously would remove the focused option too early.
              window.setTimeout(onToggle, 0);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onToggle();
              queueMicrotask(() => chipRef.current?.focus());
              return;
            }

            const items = menuItemsOf(menuRef.current);
            if (!items.length) return;
            const current = items.indexOf(document.activeElement as HTMLElement);
            let next = current >= 0 ? current : 0;
            if (event.key === "ArrowDown") next += 1;
            else if (event.key === "ArrowUp") next -= 1;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = items.length - 1;
            else return;

            event.preventDefault();
            event.stopPropagation();
            focusMenuItem(items, next);
          }}
        >
          <div className="cm-menu-h" aria-hidden="true">{menuH}</div>
          {children}
        </div>
      ) : null}
    </div>
  );
}
