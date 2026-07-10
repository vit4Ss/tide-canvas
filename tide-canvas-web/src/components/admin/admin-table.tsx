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
  /** Optional column width (e.g. "120px", "18%"). Applied to th + td. */
  width?: string | number;
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
  /** Empty-state content when rows is empty (default "暂无数据"). */
  empty?: React.ReactNode;
  /** Accessible label for the table region. */
  label?: string;
  /**
   * Server-paged mode: rows 已是当前页数据，翻页由父组件重新拉取。
   * 传入后 pageSize（客户端切片）被忽略，页脚渲染同一套 `.adm-pager`。
   */
  server?: {
    page: number;
    pageSize: number;
    total: number;
    onPage: (p: number) => void;
  };
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
  empty = "暂无数据",
  label = "数据表格",
  server,
}: AdminTableProps<T>) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize ?? 10);

  const paged = initialPageSize != null && server == null;

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

  const colStyle = (c: Column<T>): React.CSSProperties => {
    const s: React.CSSProperties = { ...alignStyle(c.align) };
    if (c.width != null) {
      const w = typeof c.width === "number" ? `${c.width}px` : c.width;
      s.width = w;
    }
    return s;
  };

  return (
    <>
      <div className="adm-table-wrap" role="region" aria-label={label} tabIndex={0}>
        <table className={`adm-table adm-table-fixed${className ? ` ${className}` : ""}`}>
          <colgroup>
            {columns.map((c, i) => (
              <col
                key={i}
                style={
                  c.width != null
                    ? { width: typeof c.width === "number" ? `${c.width}px` : c.width }
                    : undefined
                }
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c, i) => {
                const sortable = Boolean(c.sortable && server == null);
                const arrow = sortCol === i ? (sortDir === "asc" ? " ↑" : sortDir === "desc" ? " ↓" : "") : "";
                return (
                  <th
                    key={i}
                    aria-sort={
                      sortCol === i && sortDir === "asc"
                        ? "ascending"
                        : sortCol === i && sortDir === "desc"
                          ? "descending"
                          : sortable
                            ? "none"
                            : undefined
                    }
                    style={{
                      ...colStyle(c),
                    }}
                  >
                    {sortable ? (
                      <button type="button" className="adm-sort" onClick={() => toggleSort(i)}>
                        <span>{c.header}</span>
                        <span className="adm-sort-arrow" aria-hidden>{arrow.trim() || "↕"}</span>
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <div className="adm-empty">
                    <span className="t">暂无数据</span>
                    {empty !== "暂无数据" ? <span className="s">{empty}</span> : null}
                  </div>
                </td>
              </tr>
            ) : null}
            {visible.map((row, ri) => (
              <tr key={rowKey(row, ri)} data-rowkey={String(rowKey(row, ri))}>
                {columns.map((c, ci) => (
                  <td key={ci} className={c.className} style={colStyle(c)}>
                    {c.cell(row, ri)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {server ? (
        <AdminPager
          total={server.total}
          page={server.page}
          pageCount={Math.max(1, Math.ceil(server.total / server.pageSize))}
          pageSize={server.pageSize}
          onPage={server.onPage}
        />
      ) : paged ? (
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
  /** 省略时隐藏「N 条/页」选择器（服务端分页固定页大小）。 */
  pageSizeOptions?: number[];
  onPage: (p: number) => void;
  onPageSize?: (s: number) => void;
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
  // 滑动窗口页码：始终显示首尾页，当前页居中，两侧超出用 … 折叠，
  // 总按钮数不超过 7（含首尾），窗口随当前页移动而不是固定 1..7。
  const items: (number | "…")[] = [];
  if (pageCount <= 7) {
    for (let i = 1; i <= pageCount; i++) items.push(i);
  } else {
    const lo = Math.max(2, Math.min(page - 1, pageCount - 4));
    const hi = Math.min(pageCount - 1, Math.max(page + 1, 5));
    items.push(1);
    if (lo > 2) items.push("…");
    for (let i = lo; i <= hi; i++) items.push(i);
    if (hi < pageCount - 1) items.push("…");
    items.push(pageCount);
  }

  return (
    <div className="adm-pager">
      <span className="total">共 {total.toLocaleString()} 条</span>
      <div className="pgs">
        {onPageSize && pageSizeOptions ? (
          <select
            className="psz"
            aria-label="每页显示条数"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {pageSizeOptions.map((s) => (
              <option key={s} value={s}>
                {s} 条/页
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="pg pg-nav"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
          aria-label="上一页"
        >
          ‹
        </button>
        {items.map((it, i) =>
          it === "…" ? (
            <span key={`gap-${i}`} className="gap">
              …
            </span>
          ) : (
            <button
              key={it}
              type="button"
              className={`pg${it === page ? " on" : ""}`}
              onClick={() => onPage(it)}
              aria-current={it === page ? "page" : undefined}
              aria-label={`第 ${it} 页`}
            >
              {it}
            </button>
          ),
        )}
        <button
          type="button"
          className="pg pg-nav"
          disabled={page >= pageCount}
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
