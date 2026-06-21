"use client";

/* ============================================================================
   RowActions — liuguang `.rowacts` per-row action buttons.

   Faithful to admin.js `acts(extra)`: <td><div class="rowacts">…buttons</div></td>.
   Buttons labeled 删除 / 封禁 / 驳回 (or any in DANGER) get the `.danger` style.
   Each action takes an onClick so section pages can open the right modal/toast.

   Note: this renders the inner `.rowacts` div only (NOT a <td>), so it composes
   inside an AdminTable column cell.

   <RowActions actions={[{ label: "详情", onClick: openDetail }, { label: "封禁", onClick: ban }]} />
   ============================================================================ */

const DANGER = new Set(["删除", "封禁", "驳回", "下架", "吊销", "停用", "禁用", "下线", "清理"]);

export interface RowAction {
  label: string;
  onClick?: () => void;
  /** Force danger styling (otherwise inferred from the label). */
  danger?: boolean;
}

export interface RowActionsProps {
  actions: RowAction[];
}

export function RowActions({ actions }: RowActionsProps) {
  return (
    <div className="rowacts">
      {actions.map((a, i) => (
        <button
          key={a.label + i}
          type="button"
          className={a.danger || DANGER.has(a.label) ? "danger" : undefined}
          onClick={a.onClick}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

export default RowActions;
