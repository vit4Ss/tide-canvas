"use client";

/* ============================================================================
   /admin/resources — 资源管理.

   Faithful port of admin.js V.res(), now wired to the REAL backend:
     GET  /api/admin/resources              -> PageData<ResourceVO>
     POST /api/admin/resources/cache/clear  -> { cleared: true }

     - 4 KPI tiles (存储占用 / CDN 月流量 / 素材库 / 回收待清) — static chrome.
     - Panel「资源管理 · 存储、CDN、素材与缓存」
         tools: 类型 filter chips (全部 / 存储桶 / 素材库 / 字体 / 缓存) +
                「清理缓存」(ghost)
         table: 资源 / 类型 / 大小 / 引用 / 更新时间 / 状态 / 操作(详情)

   清理缓存 opens a confirm modal; on confirm it calls the real
   /resources/cache/clear endpoint then refreshes the list.

   Client component (filter state, clear modal, loading/empty states).
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  FilterBar,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  type Column,
  type StatCardProps,
  type StatusPillProps,
} from "@/components/admin";
import { adminResourcesApi } from "@/lib/admin-resources-api";
import type { ResourceVO } from "@/types/admin-resources";
import { useAuthStore } from "@/stores/use-auth-store";
import { formatDateTime, formatFileSize } from "@/lib/utils";

type PillTone = StatusPillProps["tone"];

/* ── static display chrome (no longer sourced from @/mock) ───────────────── */

const RESOURCE_KPIS: StatCardProps[] = [
  { k: "存储占用", v: "38.2 TB", d: "+1.1 TB", dir: "down" },
  { k: "CDN 月流量", v: "920 TB", d: "+6%", dir: "up" },
  { k: "素材库", v: "12,408", d: "", dir: "up" },
  { k: "回收待清", v: "38 GB", d: "", dir: "down" },
];

const RESOURCE_FILTERS = ["全部", "存储桶", "素材库", "字体", "缓存"] as const;

/** Status → pill tone (待清理 → amber, otherwise green). */
function statusTone(status: string): PillTone {
  return status.includes("待清") ? "amber" : "green";
}

/** Map a filter chip to the backend type filter (素材/缓存 are client unions). */
function matchesFilter(r: ResourceVO, filter: string): boolean {
  switch (filter) {
    case "存储桶":
      return r.type === "存储桶";
    case "素材库":
      return r.type === "字体库" || r.type === "模型权重";
    case "字体":
      return r.type === "字体库";
    case "缓存":
      return r.type === "CDN" || r.type === "临时";
    default:
      return true;
  }
}

export default function AdminResourcesPage() {
  const [filter, setFilter] = useState<string>(RESOURCE_FILTERS[0]);
  const [all, setAll] = useState<ResourceVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const ensureSession = useAuthStore((s) => s.ensureSession);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await adminResourcesApi.list({ pageNum: 1, pageSize: 100 });
      if (res.success && res.data) {
        setAll(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载资源失败");
        setAll([]);
        setTotal(0);
      }
    } catch {
      setError("加载资源失败");
      setAll([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => all.filter((r) => matchesFilter(r, filter)),
    [all, filter],
  );

  const confirmClear = useCallback(async () => {
    setClearing(true);
    try {
      await ensureSession();
      const res = await adminResourcesApi.clearCache();
      if (res.success) {
        await load();
      }
    } finally {
      setClearing(false);
      setClearOpen(false);
    }
  }, [ensureSession, load]);

  const columns: Column<ResourceVO>[] = useMemo(
    () => [
      {
        header: "资源",
        className: "strong mono",
        sortable: true,
        sortValue: (r) => r.name,
        cell: (r) => r.name,
      },
      { header: "类型", cell: (r) => <StatusPill tone="gray">{r.type || "—"}</StatusPill> },
      {
        header: "大小",
        className: "mono",
        sortable: true,
        sortValue: (r) => r.size,
        cell: (r) => formatFileSize(r.size),
      },
      {
        header: "引用",
        className: "mono",
        sortable: true,
        sortValue: (r) => r.refs,
        cell: (r) => r.refs.toLocaleString(),
      },
      {
        header: "更新时间",
        className: "muted",
        cell: (r) => (r.updateTime ? formatDateTime(r.updateTime) : "—"),
      },
      { header: "状态", cell: (r) => <StatusPill tone={statusTone(r.status)}>{r.status || "—"}</StatusPill> },
      {
        header: "操作",
        align: "right",
        cell: () => <RowActions actions={[{ label: "详情" }]} />,
      },
    ],
    [],
  );

  return (
    <>
      <StatCardGrid items={RESOURCE_KPIS} />

      <Panel
        title="资源管理"
        sub="存储、CDN、素材与缓存"
        tools={
          <FilterBar
            options={[...RESOURCE_FILTERS]}
            value={filter}
            onChange={(v) => setFilter(v)}
            actions={
              <button type="button" className="adm-btn ghost" onClick={() => setClearOpen(true)}>
                清理缓存
              </button>
            }
          />
        }
      >
        {loading ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            加载中…
          </div>
        ) : error ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            暂无资源
          </div>
        ) : (
          <AdminTable<ResourceVO>
            rows={rows}
            rowKey={(r) => r.id}
            columns={columns}
            pageSize={20}
            total={filter === "全部" ? total : rows.length}
          />
        )}
      </Panel>

      <AdminModal
        open={clearOpen}
        title="清理缓存"
        subtitle="清理可回收的缓存与临时文件"
        saveLabel={clearing ? "清理中…" : "确认清理"}
        footNote="清理后不可恢复，请确认"
        onClose={() => (clearing ? undefined : setClearOpen(false))}
        onSave={confirmClear}
      >
        <div className="fcard" style={{ marginTop: 0 }}>
          <div className="ct">待清理项</div>
          <div className="cfg-card" style={{ boxShadow: "none", padding: "4px 16px" }}>
            <div className="cfg-row">
              <span className="lab">缓存 / 临时资源</span>
              <span className="muted">将清理 CDN 缓存与临时上传文件</span>
            </div>
          </div>
        </div>
      </AdminModal>
    </>
  );
}
