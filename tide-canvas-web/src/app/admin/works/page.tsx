"use client";

/* ============================================================================
   /admin/works — 作品管理 (REAL data).

   Wired to the admin works API (community_post rows, shared with the public
   /explore feed). Keeps the liuguang admin markup/classes + shared components:
     - 4 KPI cards (总作品 / 已发布 / 待审核 / 精选), derived from the loaded page.
     - 作品库 panel: filter chips (全部 / 图片 / 视频 / 精选 / 已下架) + the works
       table (作品 / 作者 / 模型 / 点赞 / 类型 / 状态 / 操作).
     - 作品详情 modal (查看): cover + meta, with a 精选/取消精选 toggle action.

   CRUD against the real endpoints, refreshing the list after each change:
     - 精选 → PUT /works/:id/status {status, featured} (toggles the curation flag)
     - 上架/下架 → PUT /works/:id/status {status}
     - 删除 → DELETE /works/:id
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  FilterChips,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  type Column,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminWorksApi } from "@/lib/admin-works-api";
import {
  WORK_STATUS_OFFLINE,
  WORK_STATUS_PENDING,
  WORK_STATUS_PUBLISHED,
  type AdminWorkQuery,
  type AdminWorkVO,
} from "@/types/admin-works";

const WORK_FILTERS = ["全部", "图片", "视频", "精选", "已下架"] as const;
type WorkFilter = (typeof WORK_FILTERS)[number];

/** Status int → pill tone + label. */
function statusTone(status: number): PillTone {
  if (status === WORK_STATUS_PUBLISHED) return "green";
  if (status === WORK_STATUS_PENDING) return "amber";
  return "gray"; // 已下架
}

/** Work type ("image"/"video") → localized label + tone. */
function typeLabel(type: string): { text: string; tone: PillTone } {
  return type === "video"
    ? { text: "视频", tone: "blue" }
    : { text: "图片", tone: "gray" };
}

export default function AdminWorksPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [works, setWorks] = useState<AdminWorkVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkFilter>(WORK_FILTERS[0]);
  const [detail, setDetail] = useState<AdminWorkVO | null>(null);

  // Map the active filter chip → the API query (status/type/featured).
  const queryForFilter = useCallback((f: WorkFilter): AdminWorkQuery => {
    const base: AdminWorkQuery = { pageNum: 1, pageSize: 50 };
    switch (f) {
      case "图片":
        return { ...base, type: "image" };
      case "视频":
        return { ...base, type: "video" };
      case "精选":
        return { ...base, featured: true };
      case "已下架":
        return { ...base, status: WORK_STATUS_OFFLINE };
      default:
        return base;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureSession(); // 登录流程暂未做:无 token 时静默登录默认账号
      const res = await adminWorksApi.list(queryForFilter(filter));
      if (res.success && res.data) {
        setWorks(res.data.records);
        setTotal(res.data.total);
      } else {
        setWorks([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [ensureSession, filter, queryForFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // KPIs derived from the loaded rows (the page is a single 50-row slice).
  const kpis: Kpi[] = useMemo(() => {
    const published = works.filter((w) => w.status === WORK_STATUS_PUBLISHED).length;
    const pending = works.filter((w) => w.status === WORK_STATUS_PENDING).length;
    const featured = works.filter((w) => w.featured).length;
    return [
      { k: "总作品", v: total.toLocaleString(), d: "community_post", dir: "up" },
      { k: "已发布", v: published.toLocaleString(), d: "本页", dir: "up" },
      { k: "待审核", v: pending.toLocaleString(), d: "本页", dir: pending ? "down" : "up" },
      { k: "精选", v: featured.toLocaleString(), d: "本页", dir: "up" },
    ];
  }, [works, total]);

  // --- CRUD actions ---

  const setStatus = useCallback(
    async (w: AdminWorkVO, status: number) => {
      setBusyId(w.id);
      try {
        const res = await adminWorksApi.setStatus(w.id, { status });
        if (res.success) await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const toggleFeatured = useCallback(
    async (w: AdminWorkVO) => {
      setBusyId(w.id);
      try {
        const res = await adminWorksApi.setStatus(w.id, {
          status: w.status,
          featured: !w.featured,
        });
        if (res.success) {
          setDetail((d) => (d && d.id === w.id ? { ...d, featured: !w.featured } : d));
          await load();
        }
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (w: AdminWorkVO) => {
      if (!window.confirm(`确认删除作品「${w.title || w.id}」？此操作会同步从 /explore 移除。`)) {
        return;
      }
      setBusyId(w.id);
      try {
        const res = await adminWorksApi.remove(w.id);
        if (res.success) await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const columns: Column<AdminWorkVO>[] = [
    {
      header: "作品",
      cell: (w) => (
        <div className="cellflex">
          <span
            className="sw"
            style={
              w.cover
                ? { background: `center / cover no-repeat url("${w.cover}")` }
                : undefined
            }
          />
          <span className="strong">{w.title || w.id}</span>
        </div>
      ),
    },
    { header: "作者", cell: (w) => w.author?.name || "用户" },
    { header: "模型", className: "muted", cell: (w) => w.model || "—" },
    {
      header: "点赞",
      align: "right",
      className: "mono",
      sortable: true,
      sortValue: (w) => w.likes,
      cell: (w) => w.likes.toLocaleString(),
    },
    {
      header: "类型",
      cell: (w) => {
        const t = typeLabel(w.type);
        return <StatusPill tone={t.tone}>{t.text}</StatusPill>;
      },
    },
    {
      header: "状态",
      cell: (w) => (
        <StatusPill tone={statusTone(w.status)}>
          {w.featured ? `${w.statusText} · 精选` : w.statusText}
        </StatusPill>
      ),
    },
    {
      header: "操作",
      align: "right",
      cell: (w) => {
        const offline = w.status === WORK_STATUS_OFFLINE;
        return (
          <RowActions
            actions={[
              { label: "查看", onClick: () => setDetail(w) },
              {
                label: w.featured ? "取消精选" : "精选",
                onClick: () => toggleFeatured(w),
              },
              offline
                ? { label: "上架", onClick: () => setStatus(w, WORK_STATUS_PUBLISHED) }
                : { label: "下架", onClick: () => setStatus(w, WORK_STATUS_OFFLINE) },
              { label: "删除", onClick: () => remove(w) },
            ]}
          />
        );
      },
    },
  ];

  return (
    <>
      <StatCardGrid items={kpis} />

      <Panel
        title="作品库"
        sub="审核、下架与精选推荐 · 与 /explore 同源"
        tools={
          <FilterChips
            options={[...WORK_FILTERS]}
            value={filter}
            onChange={(v) => setFilter(v as WorkFilter)}
          />
        }
      >
        {loading ? (
          <div style={{ padding: 28, color: "var(--muted, #94a3b8)" }}>加载中…</div>
        ) : works.length === 0 ? (
          <div style={{ padding: 28, color: "var(--muted, #94a3b8)" }}>
            暂无作品。
          </div>
        ) : (
          <div style={busyId ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
            <AdminTable<AdminWorkVO>
              rows={works}
              rowKey={(w) => w.id}
              total={total}
              columns={columns}
            />
          </div>
        )}
      </Panel>

      {/* 作品详情 */}
      <AdminModal
        open={detail != null}
        title={detail ? detail.title || detail.id : "作品详情"}
        subtitle={detail ? `${detail.author?.name || "用户"} · ${detail.model || "—"}` : ""}
        onClose={() => setDetail(null)}
        onSave={detail ? () => toggleFeatured(detail) : undefined}
        saveLabel={detail?.featured ? "取消精选" : "设为精选"}
      >
        {detail ? (
          <div style={{ display: "flex", gap: 18 }}>
            <span
              className="sw"
              style={{
                background: detail.cover
                  ? `center / cover no-repeat url("${detail.cover}")`
                  : undefined,
                width: 160,
                height: 160,
                borderRadius: 12,
                flex: "none",
              }}
            />
            <div className="cfg-card" style={{ flex: 1, margin: 0 }}>
              <h3>作品信息</h3>
              <div className="cfg-row">
                <span className="lab">作者</span>
                <span className="strong">{detail.author?.name || "用户"}</span>
              </div>
              <div className="cfg-row">
                <span className="lab">模型</span>
                <span className="muted">{detail.model || "—"}</span>
              </div>
              <div className="cfg-row">
                <span className="lab">类型</span>
                <StatusPill tone={typeLabel(detail.type).tone}>
                  {typeLabel(detail.type).text}
                </StatusPill>
              </div>
              <div className="cfg-row">
                <span className="lab">点赞</span>
                <span className="mono">{detail.likes.toLocaleString()}</span>
              </div>
              <div className="cfg-row">
                <span className="lab">评论</span>
                <span className="mono">{detail.comments.toLocaleString()}</span>
              </div>
              <div className="cfg-row">
                <span className="lab">浏览</span>
                <span className="mono">{detail.views.toLocaleString()}</span>
              </div>
              <div className="cfg-row">
                <span className="lab">状态</span>
                <StatusPill tone={statusTone(detail.status)}>
                  {detail.statusText}
                </StatusPill>
              </div>
              <div className="cfg-row">
                <span className="lab">精选</span>
                <StatusPill tone={detail.featured ? "green" : "gray"}>
                  {detail.featured ? "已精选" : "未精选"}
                </StatusPill>
              </div>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </>
  );
}
