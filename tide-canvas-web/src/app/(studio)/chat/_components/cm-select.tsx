"use client";

/* ── composer dropdown primitives (extracted verbatim from page.tsx) ─────────── */

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

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

  return (
    <div className={`cm-sel${open ? " open" : ""}`}>
      <button
        ref={chipRef}
        className="cm-chip"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {lead}
        <span className="cm-lab">{label}</span>
        <span className="cv">▾</span>
      </button>
      <div
        ref={menuRef}
        className={`cm-menu${right ? " right" : ""}`}
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cm-menu-h">{menuH}</div>
        {children}
      </div>
    </div>
  );
}
