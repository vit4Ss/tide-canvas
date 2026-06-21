"use client";

/* ============================================================================
   FilterChips — liuguang `.adm-chip` single-select filter row.

   Faithful to admin.js `filterChips(arr)` + the click wiring in go(): clicking a
   chip makes it `.on` and clears its siblings (single-select). This component is
   controlled-or-uncontrolled:
     - pass `value` + `onChange` for controlled selection, OR
     - omit them to let the chip row manage its own active index (defaults to 0).

   Used inside a <Panel> `tools` slot or as a standalone bar above a table.

   <FilterChips options={["全部", "免费", "Pro 会员"]} onChange={setFilter} />
   ============================================================================ */

import { useState } from "react";

export interface FilterChipsProps {
  options: string[];
  /** Controlled active value. */
  value?: string;
  /** Selection callback (value + index). */
  onChange?: (value: string, index: number) => void;
  /** Initial active index when uncontrolled (default 0). */
  defaultIndex?: number;
}

export function FilterChips({ options, value, onChange, defaultIndex = 0 }: FilterChipsProps) {
  const [internal, setInternal] = useState(defaultIndex);
  const activeIndex = value != null ? options.indexOf(value) : internal;

  return (
    <>
      {options.map((opt, i) => (
        <button
          key={opt + i}
          type="button"
          className={`adm-chip${i === activeIndex ? " on" : ""}`}
          onClick={() => {
            if (value == null) setInternal(i);
            onChange?.(opt, i);
          }}
        >
          {opt}
        </button>
      ))}
    </>
  );
}

/**
 * FilterBar — a `.adm-tools` row that hosts FilterChips on the left and any
 * trailing actions (buttons, search) on the right. Mirrors the inline
 * `${filterChips(...)}<button class="adm-btn">…` pattern from admin.js.
 */
export interface FilterBarProps extends FilterChipsProps {
  /** Trailing actions rendered after the chips (buttons / search). */
  actions?: React.ReactNode;
}

export function FilterBar({ actions, ...chips }: FilterBarProps) {
  return (
    <div className="adm-tools">
      <FilterChips {...chips} />
      {actions}
    </div>
  );
}

export default FilterChips;
