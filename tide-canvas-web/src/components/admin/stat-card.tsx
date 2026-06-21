/* ============================================================================
   StatCard / StatCardGrid — liuguang `.kpi` cards.

   Faithful to admin.js `kpi(k, v, d, dir)` + `kpis(arr)`:
     <div class="adm-kpis"><div class="kpi"><div class="k"/><div class="v"/>
       <div class="d up|down"/></div>…</div>

   `.d.up`/`.d.down` inject the ↑/↓ arrow via CSS ::before, so do NOT prefix the
   delta text with an arrow here. An empty/undefined delta hides the row.

   Server-safe (no client hooks).

   <StatCardGrid items={[{ k: "总用户", v: "5.2M", d: "+12k 今日", dir: "up" }]} />
   ============================================================================ */

import type { Kpi } from "@/mock/admin";

export type StatCardProps = Kpi;

export function StatCard({ k, v, d, dir = "up" }: StatCardProps) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {d ? <div className={`d ${dir}`}>{d}</div> : null}
    </div>
  );
}

export interface StatCardGridProps {
  items: Kpi[];
}

/** The `.adm-kpis` responsive grid wrapper around a list of StatCards. */
export function StatCardGrid({ items }: StatCardGridProps) {
  return (
    <div className="adm-kpis">
      {items.map((it, i) => (
        <StatCard key={it.k + i} {...it} />
      ))}
    </div>
  );
}

export default StatCard;
