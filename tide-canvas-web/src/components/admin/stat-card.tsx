/* ============================================================================
   StatCard / StatCardGrid — compact metric strip (.kpi / .adm-kpis).

   Honest deltas only:
   - dir is optional; no default "up"
   - green/red arrows render only when dir is explicitly "up" | "down"
   - bare annotation text (d without dir) stays muted
   ============================================================================ */

import type { Kpi } from "@/components/admin/admin-constants";

export type StatCardProps = Kpi;

export function StatCard({ k, v, d, dir }: StatCardProps) {
  const deltaClass =
    dir === "up" ? "d up" : dir === "down" ? "d down" : d ? "d" : "";
  return (
    <div className="kpi">
      <dt className="k">{k}</dt>
      <dd className="v">{v}</dd>
      {d ? <div className={deltaClass || "d"}>{d}</div> : null}
    </div>
  );
}

export interface StatCardGridProps {
  items: Kpi[];
}

/** Compact horizontal metric strip (not a vanity card wall). */
export function StatCardGrid({ items }: StatCardGridProps) {
  if (!items.length) return null;
  return (
    <dl className="adm-kpis">
      {items.map((it, i) => (
        <StatCard key={it.k + i} {...it} />
      ))}
    </dl>
  );
}

export default StatCard;
