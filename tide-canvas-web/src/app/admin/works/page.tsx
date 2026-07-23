"use client";

/* ============================================================================
   /admin/works — 作品管理 (REAL data).

   Wired to the admin works API (community_post rows, shared with the public
   /explore feed). Keeps the liuguang admin markup/classes + shared components:
     - 作品库 panel: filter chips (全部 / 图片 / 视频 / 精选 / 已下架) + the works
       table (作品 / 作者 / 模型 / 类型 / 状态 / 操作)。点赞/评论/浏览等社交
       计数已移除（2026-07-09 用户拍板：产品没有这些）；原 4 KPI 卡已撤，
       本页待审数并入 Panel 副标题。
     - 作品详情 modal (查看): cover + meta, with a 精选/取消精选 toggle action.

   CRUD against the real endpoints, refreshing the list after each change:
     - 精选 → PUT /works/:id/status {status, featured} (toggles the curation flag)
     - 上架/下架 → PUT /works/:id/status {status}
     - 删除 → DELETE /works/:id
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  FilterChips,
  Panel,
  RowActions,
  StatusPill,
  type Column,
  TableSkeleton,
} from "@/components/admin";
import type { PillTone } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminWorksApi } from "@/lib/admin-works-api";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";
import {
  WORK_STATUS_OFFLINE,
  WORK_STATUS_PENDING,
  WORK_STATUS_PUBLISHED,
  type AdminWorkQuery,
  type AdminWorkVO,
} from "@/types/admin-works";

const WORK_FILTERS = ["全部", "图片", "视频", "音频", "精选", "已下架"] as const;
type WorkFilter = (typeof WORK_FILTERS)[number];

const PAGE_SIZE = 20;

/** Status int → pill tone + label. */
function statusTone(status: number): PillTone {
  if (status === WORK_STATUS_PUBLISHED) return "green";
  if (status === WORK_STATUS_PENDING) return "amber";
  return "gray"; // 已下架
}

/** Work type ("image"/"video"/"audio") → localized label + tone. */
function typeLabel(type: string): { text: string; tone: PillTone } {
  if (type === "video") return { text: "视频", tone: "blue" };
  if (type === "audio") return { text: "音频", tone: "amber" };
  return { text: "图片", tone: "gray" };
}

export default function AdminWorksPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [works, setWorks] = useState<AdminWorkVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkFilter>(WORK_FILTERS[0]);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminWorkVO | null>(null);
  // 关键词搜索（标题/内容/标签，后端 LIKE）：query = 输入框实时值，keyword = 已提交检索词
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");

  // Map the active filter chip → the API query (status/type/featured).
  const queryForFilter = useCallback((f: WorkFilter, pageNum: number): AdminWorkQuery => {
    const base: AdminWorkQuery = { pageNum, pageSize: PAGE_SIZE };
    switch (f) {
      case "图片":
        return { ...base, type: "image" };
      case "视频":
        return { ...base, type: "video" };
      case "音频":
        return { ...base, type: "audio" };
      case "精选":
        return { ...base, featured: true };
      case "已下架":
        return { ...base, status: WORK_STATUS_OFFLINE };
      default:
        return base;
    }
  }, []);

  // reqId 守卫:快速切筛选时,较慢的旧响应后到不应覆盖新筛选结果。
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await ensureSession(); // 登录流程暂未做:无 token 时静默登录默认账号
      const res = await adminWorksApi.list({
        ...queryForFilter(filter, page),
        keyword: keyword || undefined,
      });
      if (id !== reqIdRef.current) return; // 过期响应丢弃
      if (res.success && res.data) {
        setWorks(res.data.records);
        setTotal(res.data.total);
      } else {
        setWorks([]);
        setTotal(0);
        setError(res.message || "加载作品失败");
      }
    } catch {
      if (id !== reqIdRef.current) return;
      setWorks([]);
      setTotal(0);
      setError("加载作品失败，请稍后重试");
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, [ensureSession, filter, page, keyword, queryForFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pendingCount = useMemo(
    () => works.filter((w) => w.status === WORK_STATUS_PENDING).length,
    [works],
  );

  // --- CRUD actions ---

  const setStatus = useCallback(
    async (w: AdminWorkVO, status: number) => {
      setBusyId(w.id);
      try {
        const res = await adminWorksApi.setStatus(w.id, { status });
        if (res.success) await load();
        else toast.error(res.message || "更新作品状态失败");
      } catch {
        toast.error("更新作品状态失败");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  // 返回 boolean：详情弹窗把它当 AdminModal onSave 用，失败返回 false
  // 让弹窗保持打开（列表行内调用忽略返回值，行为不变）。
  const toggleFeatured = useCallback(
    async (w: AdminWorkVO): Promise<boolean> => {
      setBusyId(w.id);
      try {
        const res = await adminWorksApi.setStatus(w.id, {
          status: w.status,
          featured: !w.featured,
        });
        if (!res.success) {
          toast.error(res.message || "更新精选状态失败");
          return false;
        }
        setDetail((d) => (d && d.id === w.id ? { ...d, featured: !w.featured } : d));
        await load();
        return true;
      } catch {
        toast.error("更新精选状态失败");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (w: AdminWorkVO) => {
      if (
        !(await confirmDialog({
          title: "删除作品",
          message: `确认删除作品「${w.title || w.id}」？此操作会同步从作品广场移除。`,
          confirmText: "删除",
        }))
      ) {
        return;
      }
      setBusyId(w.id);
      try {
        const res = await adminWorksApi.remove(w.id);
        if (res.success) await load();
        else toast.error(res.message || "删除作品失败");
      } catch {
        toast.error("删除作品失败");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  // 列宽用百分比均摊整行，避免「作品」一列吃掉全部剩余宽、其它列被挤到最右
  const columns: Column<AdminWorkVO>[] = [
    {
      header: "作品",
      width: "28%",
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
          <span className="strong" title={w.title || w.id}>
            {w.title || w.id}
          </span>
        </div>
      ),
    },
    {
      header: "作者",
      width: "12%",
      cell: (w) => (
        <span className="truncate" title={w.author?.name || "用户"}>
          {w.author?.name || "用户"}
        </span>
      ),
    },
    {
      header: "模型",
      width: "18%",
      className: "muted",
      cell: (w) => (
        <span className="truncate" title={w.model || "—"}>
          {w.model || "—"}
        </span>
      ),
    },
    {
      header: "类型",
      width: "10%",
      cell: (w) => {
        const t = typeLabel(w.type);
        return <StatusPill tone={t.tone}>{t.text}</StatusPill>;
      },
    },
    {
      header: "状态",
      width: "12%",
      cell: (w) => (
        <StatusPill tone={statusTone(w.status)}>
          {w.featured ? `${w.statusText} · 精选` : w.statusText}
        </StatusPill>
      ),
    },
    {
      header: "操作",
      align: "right",
      width: "20%",
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
    <div className="adm-page">
      <Panel
        title="作品库"
        sub={`共 ${total.toLocaleString()} 件 · 本页未发布 ${pendingCount} 件 · 用户生成的全部作品`}
        tools={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <FilterChips
              label="作品类型与状态"
              options={[...WORK_FILTERS]}
              value={filter}
              onChange={(v) => {
                setFilter(v as WorkFilter);
                setPage(1);
              }}
            />
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setKeyword(query.trim());
                setPage(1);
              }}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div className="adm-search" style={{ margin: 0 }}>
                <Search aria-hidden size={15} />
                <input
                  placeholder="标题 / 提示词 / 标签"
                  aria-label="搜索作品标题、提示词或标签"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {/* 不随 loading 禁用：默认提交按钮被禁用时按 Enter 的隐式提交会静默失效
                  （列表加载中提交搜索无反应）；并发安全由 load 的 reqId 守卫保证 */}
              <button type="submit" className="adm-btn ghost">
                搜索
              </button>
              {keyword ? (
                <button
                  type="button"
                  className="adm-btn ghost"
                  onClick={() => {
                    setQuery("");
                    setKeyword("");
                    setPage(1);
                  }}
                >
                  <X aria-hidden size={14} />
                  清除
                </button>
              ) : null}
            </form>
          </div>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <AdminAlert
              tone="error"
              title="作品列表加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={load}>
                  <RefreshCw aria-hidden size={15} />
                  重新加载
                </button>
              }
            >
              {error}
            </AdminAlert>
          </div>
        ) : works.length === 0 ? (
          <AdminEmptyState
            title={keyword ? "未找到匹配作品" : "当前筛选下没有作品"}
            description={
              keyword
                ? `没有标题、提示词或标签匹配「${keyword}」的作品。`
                : "切换类型或状态后再查看；新作品发布后会自动出现在这里。"
            }
            action={filter !== "全部" || keyword ? (
              <button
                type="button"
                className="adm-btn ghost"
                onClick={() => {
                  setFilter("全部");
                  setQuery("");
                  setKeyword("");
                  setPage(1);
                }}
              >
                查看全部作品
              </button>
            ) : undefined}
          />
        ) : (
          <div
            aria-busy={busyId != null}
            style={busyId ? { opacity: 0.6, pointerEvents: "none" } : undefined}
          >
            <AdminTable<AdminWorkVO>
              rows={works}
              rowKey={(w) => w.id}
              columns={columns}
              label="作品列表"
              server={{ page, pageSize: PAGE_SIZE, total, onPage: setPage }}
            />
          </div>
        )}
      </Panel>

      {/* 作品详情 */}
      <AdminModal
        open={detail != null}
        size="xl"
        title={detail ? detail.title || detail.id : "作品详情"}
        subtitle={detail ? `${detail.author?.name || "用户"} · ${detail.model || "—"}` : ""}
        onClose={() => setDetail(null)}
        onSave={detail ? () => toggleFeatured(detail) : undefined}
        saveLabel={detail?.featured ? "取消精选" : "设为精选"}
        cancelLabel="关闭"
        footNote="精选状态即时生效"
      >
        {detail ? (
          <div className="cfg-grid">
            <div className="cfg-card" style={{ padding: 0, overflow: "hidden" }}>
              {detail.cover ? (
                <div
                  role="img"
                  aria-label={`${detail.title || "作品"}封面预览`}
                  style={{
                    minHeight: 320,
                    aspectRatio: "4 / 3",
                    background: `var(--surface-2) center / contain no-repeat url("${detail.cover}")`,
                  }}
                />
              ) : (
                <div style={{ minHeight: 320 }}>
                  <AdminEmptyState
                    title="暂无可用预览"
                    description="作品未提供封面地址，可通过右侧信息确认内容。"
                  />
                </div>
              )}
            </div>
            <div className="cfg-card">
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
                <span className="lab">分类</span>
                <span className="muted">{detail.cat || "未分类"}</span>
              </div>
              <div className="cfg-row">
                <span className="lab">标签</span>
                <span className="muted" title={detail.tags || undefined}>{detail.tags || "未标记"}</span>
              </div>
              <div className="cfg-row">
                <span className="lab">类型</span>
                <StatusPill tone={typeLabel(detail.type).tone}>
                  {typeLabel(detail.type).text}
                </StatusPill>
              </div>
              {/* 点赞/评论/浏览行已移除（2026-07-09 用户拍板：产品没有这些社交计数） */}
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
              <div className="cfg-row">
                <span className="lab">作品 ID</span>
                <span className="mono muted">{detail.id}</span>
              </div>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}
