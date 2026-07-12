"use client";

/* ============================================================================
   /admin/pricing — 价格管理 (REAL data).

   Liuguang admin.js V.price() skin, now backed by the real admin API
   (src/lib/admin-pricing-api.ts → /api/admin/plans).
   Editing plans here changes the public 定价 cards (same `plan` table).

   - 套餐管理 : GET/POST/PUT/DELETE /api/admin/plans (会员套餐 → public pricing)

   积分包管理已下线（2026-07-08 用户拍板：积分只随套餐发放，用户端购买通道
   与后台管理一并移除；point_package 表保留仅供遗留订单结算/展示）。

   KEEPS the exact liuguang markup/classes + shared <Panel/AdminTable/StatusPill/
   SwitchToggle/RowActions/AdminModal/StatCardGrid> components. Mock import dropped.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, Save, Star } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatusPill,
  SwitchToggle,
  TableSkeleton,
} from "@/components/admin";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminPricingApi } from "@/lib/admin-pricing-api";
import type {
  AdminCompareRow,
  AdminFaqItem,
  AdminPlan,
  AdminPlanUpsertDTO,
} from "@/types/admin-pricing";

const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;
const num = (n: number) => n.toLocaleString("zh-CN");
const toNum = (s: string) => {
  const v = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(v) ? v : 0;
};

/* ── plan modal form state ─────────────────────────────────────────────── */
interface PlanForm {
  name: string;
  desc: string;
  cta: string;
  monthly: string;
  yearly: string;
  monthlyPoints: string;
  items: string;
  featured: boolean;
  sortOrder: string;
  status: boolean;
}
const emptyPlanForm = (): PlanForm => ({
  name: "",
  desc: "",
  cta: "",
  monthly: "",
  yearly: "",
  monthlyPoints: "",
  items: "",
  featured: false,
  sortOrder: "0",
  status: true,
});
const planToForm = (p: AdminPlan): PlanForm => ({
  name: p.name,
  desc: p.desc,
  cta: p.cta,
  monthly: String(p.monthly),
  yearly: String(p.yearly),
  monthlyPoints: String(p.monthlyPoints),
  items: (p.items ?? []).join(" · "),
  featured: p.featured,
  sortOrder: String(p.sortOrder),
  status: p.status === 1,
});

export default function AdminPricingPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // plan modal
  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminPlan | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlanForm());

  // 方案对比表（行可编辑；列=真实套餐）。dirty 后显示保存提示；
  // ref 镜像给 load() 用，避免静默刷新覆盖未保存的编辑。
  const [cmpRows, setCmpRows] = useState<AdminCompareRow[]>([]);
  const [cmpDirty, setCmpDirty] = useState(false);
  const [cmpSaving, setCmpSaving] = useState(false);
  const cmpDirtyRef = useRef(false);
  const markCmpDirty = () => {
    setCmpDirty(true);
    cmpDirtyRef.current = true;
  };

  // 常见问题 FAQ（与对比表同一套编辑/保存模式）。
  const [faqItems, setFaqItems] = useState<AdminFaqItem[]>([]);
  const [faqDirty, setFaqDirty] = useState(false);
  const [faqSaving, setFaqSaving] = useState(false);
  const faqDirtyRef = useRef(false);
  const markFaqDirty = () => {
    setFaqDirty(true);
    faqDirtyRef.current = true;
  };

  // silent：跳过 loading 占位，静默换数据。排序等就地操作用它刷新，
  // 否则表格被「加载中…」卸载重建，行移动的过渡动画会被打断。
  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        await ensureSession();
        const planRes = await adminPricingApi.listPlans();
        if (planRes.success && planRes.data) setPlans(planRes.data);
        if (!planRes.success) setError(planRes.message || "加载套餐失败");
        // 对比表 / FAQ 跟随加载（编辑中不覆盖本地未保存的改动）
        const cmpRes = await adminPricingApi.getCompare();
        if (cmpRes.success && cmpRes.data?.rows) {
          setCmpRows((prev) => (prev.length && cmpDirtyRef.current ? prev : cmpRes.data!.rows));
        }
        const faqRes = await adminPricingApi.getFaq();
        if (faqRes.success && faqRes.data?.items) {
          setFaqItems((prev) => (prev.length && faqDirtyRef.current ? prev : faqRes.data!.items));
        }
      } catch {
        setError("加载失败，请稍后重试");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [ensureSession],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  /* ── KPIs derived from real data ─────────────────────────────────────── */
  // 原 KPI 四卡（在售/总数重复、均价无运营动作）已撤，计数并入面板副标题
  const planSummary = useMemo(() => {
    const onSale = plans.filter((p) => p.status === 1).length;
    const paid = plans.filter((p) => p.monthly > 0).length;
    return `${plans.length} 个套餐 · ${onSale} 在售 / ${paid} 付费`;
  }, [plans]);

  /* ── plan actions ────────────────────────────────────────────────────── */
  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanForm(emptyPlanForm());
    setPlanOpen(true);
  };
  const openEditPlan = (p: AdminPlan) => {
    setEditingPlan(p);
    setPlanForm(planToForm(p));
    setPlanOpen(true);
  };
  const savePlan = async () => {
    // 月价/年价 UI 标了 required：空串/非法/负数直接拦下（0 合法 = 免费档），
    // 否则 toNum 会把空值静默变 0 提交。校验失败返回 false 让弹窗保持打开。
    const name = planForm.name.trim();
    if (!name) {
      toast.error("请填写套餐名称");
      return false;
    }
    const monthly = Number(planForm.monthly.trim());
    if (planForm.monthly.trim() === "" || !Number.isFinite(monthly) || monthly < 0) {
      toast.error("请填写有效的月价");
      return false;
    }
    const yearly = Number(planForm.yearly.trim());
    if (planForm.yearly.trim() === "" || !Number.isFinite(yearly) || yearly < 0) {
      toast.error("请填写有效的年付月价（折后每月单价，非一年总价）");
      return false;
    }
    const dto: AdminPlanUpsertDTO = {
      name,
      desc: planForm.desc.trim(),
      cta: planForm.cta.trim(),
      monthly,
      yearly,
      monthlyPoints: toNum(planForm.monthlyPoints),
      // 只按 · 和换行分割：权益文案里合法出现逗号（如「每月 3,000 积分」），
      // 逗号分割会把它拆碎并写坏库里的 items。
      items: planForm.items
        .split(/[·\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      featured: planForm.featured,
      sortOrder: toNum(planForm.sortOrder),
      status: planForm.status ? 1 : 0,
      // The backend upsert is a FULL overwrite; the form doesn't expose code,
      // so carry the existing value through on edit.
      ...(editingPlan ? { code: editingPlan.code } : {}),
    };
    try {
      const res = editingPlan
        ? await adminPricingApi.updatePlan(editingPlan.id, dto)
        : await adminPricingApi.createPlan(dto);
      if (res.success) {
        setPlanOpen(false);
        load();
        toast.success(editingPlan ? "套餐已更新" : "套餐已创建");
        return true;
      }
      toast.error(res.message || "保存套餐失败");
      return false;
    } catch {
      toast.error("保存套餐失败，请稍后重试");
      return false;
    }
  };
  const togglePlan = async (p: AdminPlan, next: boolean) => {
    const dto: AdminPlanUpsertDTO = {
      name: p.name,
      code: p.code,
      desc: p.desc,
      monthly: p.monthly,
      yearly: p.yearly,
      monthlyPoints: p.monthlyPoints,
      featured: p.featured,
      cta: p.cta,
      items: p.items,
      sortOrder: p.sortOrder,
      status: next ? 1 : 0,
    };
    try {
      const res = await adminPricingApi.updatePlan(p.id, dto);
      if (res.success) load({ silent: true });
      else toast.error(res.message || "套餐状态更新失败");
    } catch {
      toast.error("套餐状态更新失败，请稍后重试");
    }
  };
  const deletePlan = async (p: AdminPlan) => {
    if (
      !(await confirmDialog({
        title: "删除会员套餐",
        message: `确认永久删除套餐「${p.name}」？该套餐会立即从公开定价页移除，已有订单记录不会被删除。`,
        confirmText: "确认删除",
      }))
    )
      return;
    try {
      const res = await adminPricingApi.deletePlan(p.id);
      if (res.success) {
        toast.success(`已删除套餐「${p.name}」`);
        load();
      } else toast.error(res.message || "删除套餐失败");
    } catch {
      toast.error("删除套餐失败，请稍后重试");
    }
  };

  /* ── compare-table actions ───────────────────────────────────────────── */
  const updateCmpLabel = (i: number, v: string) => {
    setCmpRows((rows) => rows.map((r, ri) => (ri === i ? { ...r, label: v } : r)));
    markCmpDirty();
  };
  const updateCmpCell = (i: number, planId: string, v: string) => {
    setCmpRows((rows) =>
      rows.map((r, ri) => (ri === i ? { ...r, values: { ...r.values, [planId]: v } } : r)),
    );
    markCmpDirty();
  };
  const addCmpRow = () => {
    setCmpRows((rows) => [...rows, { label: "", values: {} }]);
    markCmpDirty();
  };
  const removeCmpRow = (i: number) => {
    setCmpRows((rows) => rows.filter((_, ri) => ri !== i));
    markCmpDirty();
  };
  const moveCmpRow = (i: number, dir: -1 | 1) => {
    setCmpRows((rows) => {
      const to = i + dir;
      if (to < 0 || to >= rows.length) return rows;
      const next = [...rows];
      const [moved] = next.splice(i, 1);
      next.splice(to, 0, moved);
      return next;
    });
    markCmpDirty();
  };
  const saveCompare = async () => {
    if (cmpSaving) return;
    setCmpSaving(true);
    const rows = cmpRows
      .map((r) => ({ ...r, label: r.label.trim() }))
      .filter((r) => r.label);
    try {
      const res = await adminPricingApi.saveCompare({ rows });
      if (res.success && res.data?.rows) {
        setCmpRows(res.data.rows);
        setCmpDirty(false);
        cmpDirtyRef.current = false;
        toast.success("方案对比表已保存");
      } else toast.error(res.message || "保存对比表失败");
    } catch {
      toast.error("保存对比表失败，请稍后重试");
    } finally {
      setCmpSaving(false);
    }
  };

  /* ── FAQ actions ─────────────────────────────────────────────────────── */
  const updateFaq = (i: number, patch: Partial<AdminFaqItem>) => {
    setFaqItems((items) => items.map((it, ii) => (ii === i ? { ...it, ...patch } : it)));
    markFaqDirty();
  };
  const addFaq = () => {
    setFaqItems((items) => [...items, { q: "", a: "" }]);
    markFaqDirty();
  };
  const removeFaq = (i: number) => {
    setFaqItems((items) => items.filter((_, ii) => ii !== i));
    markFaqDirty();
  };
  const moveFaq = (i: number, dir: -1 | 1) => {
    setFaqItems((items) => {
      const to = i + dir;
      if (to < 0 || to >= items.length) return items;
      const next = [...items];
      const [moved] = next.splice(i, 1);
      next.splice(to, 0, moved);
      return next;
    });
    markFaqDirty();
  };
  const saveFaq = async () => {
    if (faqSaving) return;
    setFaqSaving(true);
    const items = faqItems
      .map((it) => ({ q: it.q.trim(), a: it.a.trim() }))
      .filter((it) => it.q);
    try {
      const res = await adminPricingApi.saveFaq({ items });
      if (res.success && res.data?.items) {
        setFaqItems(res.data.items);
        setFaqDirty(false);
        faqDirtyRef.current = false;
        toast.success("常见问题已保存");
      } else toast.error(res.message || "保存常见问题失败");
    } catch {
      toast.error("保存常见问题失败，请稍后重试");
    } finally {
      setFaqSaving(false);
    }
  };

  // 上移/下移：按新顺序给全表重编号 sortOrder（0..n-1），只回写有变化的行。
  // 全量重编号顺带修平历史上重复/跳号的 sortOrder，避免相邻交换在重号时失效。
  const movePlan = async (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= plans.length) return;
    const next = [...plans];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPlans(next.map((p, i) => ({ ...p, sortOrder: i }))); // optimistic
    try {
      const results = await Promise.all(
        next.map((p, i) =>
          p.sortOrder === i
            ? Promise.resolve(null)
            : adminPricingApi.updatePlan(p.id, {
                name: p.name,
                code: p.code,
                desc: p.desc,
                monthly: p.monthly,
                yearly: p.yearly,
                monthlyPoints: p.monthlyPoints,
                featured: p.featured,
                cta: p.cta,
                items: p.items,
                sortOrder: i,
                status: p.status,
              }),
        ),
      );
      if (results.some((r) => r && !r.success)) toast.error("套餐排序保存失败");
    } catch {
      toast.error("套餐排序保存失败，请稍后重试");
    } finally {
      load({ silent: true }); // server truth（静默，别打断行移动动画）
    }
  };

  return (
    <div className="adm-page">
      {error ? (
        <AdminAlert
          tone="error"
          title="定价数据加载失败"
          action={
            <button type="button" className="adm-btn ghost" onClick={() => load()}>
              <RefreshCw aria-hidden size={14} />
              重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      {/* 套餐管理 */}
      <Panel
        title="套餐管理"
        sub={`会员套餐定价与权益 · ${planSummary} · 与公开定价同源`}
        tools={
          <button type="button" className="adm-btn" onClick={openCreatePlan}>
            <Plus aria-hidden size={15} />
            新增套餐
          </button>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : plans.length === 0 ? (
          <AdminEmptyState
            title="还没有会员套餐"
            description="创建第一个套餐后，它会同步显示在公开定价页。"
            action={
              <button type="button" className="adm-btn" onClick={openCreatePlan}>
                <Plus aria-hidden size={15} />
                新增套餐
              </button>
            }
          />
        ) : (
          <AdminTable<AdminPlan>
            label="会员套餐列表"
            rows={plans}
            rowKey={(r) => r.id}
            columns={[
              {
                header: "套餐",
                className: "strong",
                cell: (r) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {r.name}
                    {r.featured ? <StatusPill tone="amber">热门</StatusPill> : null}
                  </span>
                ),
              },
              { header: "月价", className: "mono", cell: (r) => yuan(r.monthly) },
              { header: "年付月价", className: "mono", cell: (r) => yuan(r.yearly) },
              { header: "每月积分", className: "mono", cell: (r) => num(r.monthlyPoints) },
              {
                header: "权益",
                className: "muted",
                cell: (r) => {
                  const items = (r.items ?? []).join(" · ");
                  return items ? (
                    <span className="clamp2" title={items}>
                      {items}
                    </span>
                  ) : (
                    "—"
                  );
                },
              },
              {
                header: "状态",
                cell: (r) => (
                  <SwitchToggle
                    checked={r.status === 1}
                    onChange={(next) => togglePlan(r, next)}
                    aria-label={`${r.name} 上架`}
                  />
                ),
              },
              {
                header: "操作",
                align: "right",
                cell: (r, i) => (
                  <RowActions
                    actions={[
                      ...(i > 0 ? [{ label: "上移", onClick: () => movePlan(i, -1) }] : []),
                      ...(i < plans.length - 1
                        ? [{ label: "下移", onClick: () => movePlan(i, 1) }]
                        : []),
                      { label: "编辑", onClick: () => openEditPlan(r) },
                      { label: "删除", onClick: () => deletePlan(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* 方案对比表：行内容可编辑；列 = 上方套餐（名称/顺序/推荐自动跟随） */}
      <Panel
        title="方案对比表"
        sub="公开定价页「方案对比」的行内容 · 列自动对应上方套餐 · 值填 ✓ 表示支持、— 表示不支持，或直接填文字"
        tools={
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {cmpDirty && (
              <span className="muted" style={{ fontSize: 12 }} role="status" aria-live="polite">
                有未保存的修改
              </span>
            )}
            <button type="button" className="adm-btn ghost" onClick={addCmpRow}>
              <Plus aria-hidden size={14} />
              添加能力
            </button>
            <button
              type="button"
              className="adm-btn"
              onClick={saveCompare}
              disabled={cmpSaving || !cmpDirty}
              aria-busy={cmpSaving}
            >
              {!cmpSaving ? <Save aria-hidden size={14} /> : null}
              {cmpSaving ? "保存中…" : "保存对比表"}
            </button>
          </span>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : (
          <div className="adm-table-wrap" role="region" aria-label="方案对比表编辑器" tabIndex={0}>
          <table className="adm-table cmp-edit" aria-label="方案对比表编辑器">
            <thead>
              <tr>
                <th style={{ width: 180 }}>能力</th>
                {plans.map((p) => (
                  <th key={p.id}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {p.name}
                      {p.featured ? <Star aria-label="热门套餐" size={12} fill="currentColor" /> : null}
                    </span>
                  </th>
                ))}
                <th style={{ width: 200, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {cmpRows.length === 0 && (
                <tr>
                  <td colSpan={plans.length + 2}>
                    <AdminEmptyState
                      title="暂无对比项"
                      description="添加公开定价页需要展示的能力或权益。"
                      action={
                        <button type="button" className="adm-btn ghost" onClick={addCmpRow}>
                          <Plus aria-hidden size={14} />
                          添加能力
                        </button>
                      }
                    />
                  </td>
                </tr>
              )}
              {cmpRows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={r.label}
                      placeholder="如：每月积分"
                      onChange={(e) => updateCmpLabel(i, e.target.value)}
                      aria-label={`第 ${i + 1} 行能力名称`}
                    />
                  </td>
                  {plans.map((p) => (
                    <td key={p.id}>
                      <input
                        value={r.values?.[p.id] ?? ""}
                        placeholder="—"
                        onChange={(e) => updateCmpCell(i, p.id, e.target.value)}
                        aria-label={`${r.label || `第 ${i + 1} 行`} · ${p.name}`}
                      />
                    </td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    <RowActions
                      actions={[
                        ...(i > 0 ? [{ label: "上移", onClick: () => moveCmpRow(i, -1) }] : []),
                        ...(i < cmpRows.length - 1
                          ? [{ label: "下移", onClick: () => moveCmpRow(i, 1) }]
                          : []),
                        { label: "移除", onClick: () => removeCmpRow(i) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Panel>

      {/* 常见问题 FAQ：公开定价页「关于付费，你可能想问」的问答内容 */}
      <Panel
        title="常见问题 FAQ"
        sub="公开定价页 FAQ 的问答内容 · 展示顺序即列表顺序"
        tools={
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {faqDirty && (
              <span className="muted" style={{ fontSize: 12 }} role="status" aria-live="polite">
                有未保存的修改
              </span>
            )}
            <button type="button" className="adm-btn ghost" onClick={addFaq}>
              <Plus aria-hidden size={14} />
              添加问题
            </button>
            <button
              type="button"
              className="adm-btn"
              onClick={saveFaq}
              disabled={faqSaving || !faqDirty}
              aria-busy={faqSaving}
            >
              {!faqSaving ? <Save aria-hidden size={14} /> : null}
              {faqSaving ? "保存中…" : "保存常见问题"}
            </button>
          </span>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : (
          <div className="adm-table-wrap" role="region" aria-label="常见问题编辑器" tabIndex={0}>
          <table className="adm-table cmp-edit" aria-label="常见问题编辑器">
            <thead>
              <tr>
                <th style={{ width: 64 }}>序号</th>
                <th style={{ width: 280 }}>问题</th>
                <th>回答</th>
                <th style={{ width: 200, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {faqItems.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <AdminEmptyState
                      title="暂无常见问题"
                      description="添加用户在购买前最需要了解的信息。"
                      action={
                        <button type="button" className="adm-btn ghost" onClick={addFaq}>
                          <Plus aria-hidden size={14} />
                          添加问题
                        </button>
                      }
                    />
                  </td>
                </tr>
              )}
              {faqItems.map((f, i) => (
                <tr key={i}>
                  <td className="muted mono">{String(i + 1).padStart(2, "0")}</td>
                  <td>
                    <input
                      value={f.q}
                      placeholder="如：积分是怎么计算的？"
                      onChange={(e) => updateFaq(i, { q: e.target.value })}
                      aria-label={`第 ${i + 1} 个问题`}
                    />
                  </td>
                  <td>
                    {/* 回答通常是长文本，单行输入框读不全也改不动 */}
                    <textarea
                      value={f.a}
                      placeholder="回答内容"
                      rows={2}
                      onChange={(e) => updateFaq(i, { a: e.target.value })}
                      aria-label={`第 ${i + 1} 个问题的回答`}
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <RowActions
                      actions={[
                        ...(i > 0 ? [{ label: "上移", onClick: () => moveFaq(i, -1) }] : []),
                        ...(i < faqItems.length - 1
                          ? [{ label: "下移", onClick: () => moveFaq(i, 1) }]
                          : []),
                        { label: "移除", onClick: () => removeFaq(i) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Panel>

      {/* 新增 / 编辑套餐 modal */}
      <AdminModal
        open={planOpen}
        size="lg"
        title={editingPlan ? "编辑套餐" : "新增套餐"}
        subtitle="配置会员套餐的定价、积分与权益（保存后同步公开定价）"
        footNote="保存后立即同步公开定价页；已产生的订单金额不会重算"
        saveLabel="保存套餐"
        onClose={() => setPlanOpen(false)}
        onSave={savePlan}
      >
        <FormCard title="基础信息">
          <FormGrid>
            <Field label="套餐名称" required span={2}>
              <input
                placeholder="如：创作者 Pro"
                value={planForm.name}
                onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="副标题" span={2} hint="卡片名称下方的一句话，如：高频创作者的首选">
              <input
                placeholder="如：高频创作者的首选"
                value={planForm.desc}
                onChange={(e) => setPlanForm((f) => ({ ...f, desc: e.target.value }))}
              />
            </Field>
            <Field label="每月积分" span={2}>
              <input
                type="number"
                placeholder="如：3000"
                value={planForm.monthlyPoints}
                onChange={(e) => setPlanForm((f) => ({ ...f, monthlyPoints: e.target.value }))}
              />
            </Field>
            <Field label="按钮文案" span={2} hint="卡片 CTA 按钮文字，留空按钮无文字">
              <input
                placeholder="如：升级 Pro / 免费开始 / 联系我们"
                value={planForm.cta}
                onChange={(e) => setPlanForm((f) => ({ ...f, cta: e.target.value }))}
              />
            </Field>
            <Field label="月价 (¥)" required span={2}>
              <input
                type="number"
                placeholder="如：39"
                value={planForm.monthly}
                onChange={(e) => setPlanForm((f) => ({ ...f, monthly: e.target.value }))}
              />
            </Field>
            <Field
              label="年付月价 (¥/月)"
              required
              span={2}
              hint="年付档的折后每月单价，不是一年总价；年付下单收款 = 此价 × 12"
            >
              <input
                type="number"
                placeholder="如：39"
                value={planForm.yearly}
                onChange={(e) => setPlanForm((f) => ({ ...f, yearly: e.target.value }))}
              />
            </Field>
            <Field label="权益说明" span={4} hint="用 · 分隔多条权益（条目内可以使用逗号）">
              <input
                placeholder="如：每月 3,000 积分 · 全部图片 + 视频模型 · 商用授权"
                value={planForm.items}
                onChange={(e) => setPlanForm((f) => ({ ...f, items: e.target.value }))}
              />
            </Field>
            <Field label="排序" span={2} hint="数字越小越靠前（公开定价卡片顺序）">
              <input
                type="number"
                value={planForm.sortOrder}
                onChange={(e) => setPlanForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </Field>
            <Field label="最受欢迎徽章" span={2} hint="开启后卡片高亮并显示「最受欢迎」标签（建议只开一个）">
              <SwitchToggle
                checked={planForm.featured}
                onChange={(next) => setPlanForm((f) => ({ ...f, featured: next }))}
                aria-label="最受欢迎徽章"
              />
            </Field>
            <Field label="状态" span={4} hint="关闭后套餐将下架（公开定价同步隐藏）">
              <SwitchToggle
                checked={planForm.status}
                onChange={(next) => setPlanForm((f) => ({ ...f, status: next }))}
                aria-label="套餐状态"
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </div>
  );
}
