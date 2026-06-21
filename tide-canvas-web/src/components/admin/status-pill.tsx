/* ============================================================================
   StatusPill — liuguang `.tag2.<tone>` status chip (a dot + label).

   Faithful to admin.js `tag(t, c)`: <span class="tag2 green"><i class="dot"/>…</span>.
   Server-safe (no client hooks); usable inside server or client pages.

   <StatusPill tone="green">正常</StatusPill>
   ============================================================================ */

import type { PillTone } from "@/mock/admin";

export interface StatusPillProps {
  /** Tone → maps to `.tag2.<tone>` (green | gray | amber | red | blue). */
  tone: PillTone;
  children: React.ReactNode;
}

export function StatusPill({ tone, children }: StatusPillProps) {
  return (
    <span className={`tag2 ${tone}`}>
      <i className="dot" />
      {children}
    </span>
  );
}

export default StatusPill;
