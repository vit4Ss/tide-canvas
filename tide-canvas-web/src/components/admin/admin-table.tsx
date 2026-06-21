"use client";

/* ============================================================================
   AdminTable — generic typed table on liuguang `.adm-table` + `.adm-pager`.

   Faithful to admin.js `table(cols, rows)` markup plus the auto-pager that go()
   appends to list panels (>= 5 rows). Here it's a real, typed component:
     - columns define header label, an accessor/cell renderer, optional align,
       optional `sortable` (with an optional `sortValue` for non-string cells),
       and an optional `className` applied to every <td>.
     - clicking a sortable header cycles asc → desc → none.
     - client-side pagination with a page-size <select> + numbered `.pg` buttons,
       matching the `.adm-pager` look. Pagination is opt-in via `pageSize`.

   Generic over the row type so section pages stay fully typed:

   <AdminTable<AdminUser>
     rows={users}
     rowKey={(u) => u.email}
     pageSize={10}
     columns={[
       { header: "用户", cell: (u) => <UserCell u={u} />, sortable: true, sortValue: (u) => u.name },
       { header: "积分余额", align: "right", className: "mono", cell: (u) => u.credits.toLocaleString(), sortable: true, sortValue: (u) => u.credits },
       { header: "操作", align: "right", cell: (u) => <RowActions … /> },
     ]}
   />
   ============================================================================ */

import { useMemo, useState } from "react";

export type CellAlign = "left" | "right" | "center";

export interface Column<T> {
  /** Header label. */
  header: React.ReactNode;
  /** Cell renderer for a row. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Text alignment for header + cells (default "left"). */
  align?: CellAlign;
  /** Extra className applied to every <td> in this column (e.g. "mono strong"). */
  className?: string;
  /** Enable click-to-sort on this column's header. */
  sortable?: boolean;
  /** Value used for sorting (defaults to the rendered cell if it's a string/number). */
  sortValue?: (row: T) => string | number;
}

export interface AdminTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable key per row. */
  rowKey: (row: T, index: number) => string | number;
  /** Enable pagination at this page size. Omit for no pager. */
  pageSize?: number;
  /** Page-size options for the `.psz` select (default [10, 20, 50]). */
  pageSizeOptions?: number[];
  /** Optional total-count override for the "共 N 条" label (defaults to rows.length). */
  total?: number;
  /** Extra className on the `.adm-table`. */
  className?: string;
}

type SortDir = "asc" | "desc" | null;

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  pageSize: initialPageSize,
  pageSizeOptions = [10, 20, 50],
  total,
  className,
}: AdminTableProps<T>) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize ?? 10);

  const paged = initialPageSize != null;

  const sorted = useMemo(() => {
    if (sortCol == null || sortDir == null) return rows;
    const col = columns[sortCol];
    const getVal = col.sortValue;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = getVal ? getVal(a) : "";
      const vb = getVal ? getVal(b) : "";
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "zh-Hans-CN");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortCol, sortDir]);

  const pageCount = paged ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount);
  const visible = paged
    ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize)
    : sorted;

  function toggleSort(i: number) {
    if (sortCol !== i) {
      setSortCol(i);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortCol(null);
      setSortDir(null);
    } else {
      setSortDir("asc");
    }
  }

  const alignStyle = (a?: CellAlign): React.CSSProperties | undefined =>
    a === "right" ? { textAlign: "right" } : a === "center" ? { textAlign: "center" } : undefined;

  return (
    <>
      <table className={`adm-table${className ? ` ${className}` : ""}`}>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const arrow = sortCol === i ? (sortDir === "asc" ? " ↑" : sortDir === "desc" ? " ↓" : "") : "";
              return (
                <th
                  key={i}
                  style={{
                    ...alignStyle(c.align),
                    cursor: c.sortable ? "pointer" : undefined,
                    userSelect: c.sortable ? "none" : undefined,
                  }}
                  onClick={c.sortable ? () => toggleSort(i) : undefined}
                >
                  {c.header}
                  {arrow}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, ri) => (
            <tr key={rowKey(row, ri)}>
              {columns.map((c, ci) => (
                <td key={ci} className={c.className} style={alignStyle(c.align)}>
                  {c.cell(row, ri)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {paged ? (
        <AdminPager
          total={total ?? sorted.length}
          page={safePage}
          pageCount={pageCount}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPage={setPage}
          onPageSize={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      ) : null}
    </>
  );
}

interface AdminPagerProps {
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}

/** The `.adm-pager` footer — total label + page-size select + numbered buttons. */
function AdminPager({
  total,
  page,
  pageCount,
  pageSize,
  pageSizeOptions,
  onPage,
  onPageSize,
}: AdminPagerProps) {
  // window of page numbers (mirrors admin.js: up to ~7 buttons + last + …)
  const maxBtns = Math.min(7, pageCount);
  const nums: number[] = [];
  for (let i = 1; i <= maxBtns; i++) nums.push(i);
  const showLast = pageCount > maxBtns;

  return (
    <div className="adm-pager">
      <span className="total">共 {total.toLocaleString()} 条</span>
      <div className="pgs">
        <select
          className="psz"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>
              {s} 条/页
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pg nav"
          onClick={() => onPage(Math.max(1, page - 1))}
          aria-label="上一页"
        >
          ‹
        </button>
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            className={`pg${n === page ? " on" : ""}`}
            onClick={() => onPage(n)}
          >
            {n}
          </button>
        ))}
        {showLast ? (
          <>
            <span className="gap">…</span>
            <button
              type="button"
              className={`pg${page === pageCount ? " on" : ""}`}
              onClick={() => onPage(pageCount)}
            >
              {pageCount}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="pg nav"
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          aria-label="下一页"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export default AdminTable;
