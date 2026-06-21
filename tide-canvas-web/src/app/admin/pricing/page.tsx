"use client";

/* ============================================================================
   /admin/pricing — 价格管理 (REAL data).

   Liuguang admin.js V.price() skin, now backed by the real admin API
   (src/lib/admin-pricing-api.ts → /api/admin/plans + /api/admin/packages).
   Editing plans here changes the public 定价 cards (same `plan` table).

   - 套餐管理   : GET/POST/PUT/DELETE /api/admin/plans   (会员套餐 → public pricing)
   - 积分包管理 : GET/POST/PUT/DELETE /api/admin/packages (one-off point packages)

   KEEPS the exact liuguang markup/classes + shared <Panel/AdminTable/StatusPill/
   SwitchToggle/RowActions/AdminModal/StatCardGrid> components. Mock import dropped.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
} from "@/components/admin";
import type { Kpi } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminPricingApi } from "@/lib/admin-pricing-api";
import type {
  AdminPlan,
  AdminPlanUpsertDTO,
  AdminPointPackage,
  AdminPointPackageUpsertDTO,
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
  monthly: string;
  yearly: string;
  monthlyPoints: string;
  items: string;
  status: boolean;
}
const emptyPlanForm = (): PlanForm => ({
  name: "",
  monthly: "",
  yearly: "",
  monthlyPoints: "",
  items: "",
  status: true,
});
const planToForm = (p: AdminPlan): PlanForm => ({
  name: p.name,
  monthly: String(p.monthly),
  yearly: String(p.yearly),
  monthlyPoints: String(p.monthlyPoints),
  items: (p.items ?? []).join(" · "),
  status: p.status === 1,
});

/* ── package modal form state ──────────────────────────────────────────── */
interface PackageForm {
  name: string;
  points: string;
  bonusPoints: string;
  price: string;
  status: boolean;
}
const emptyPackageForm = (): PackageForm => ({
  name: "",
  points: "",
  bonusPoints: "",
  price: "",
  status: true,
});
const packageToForm = (p: AdminPointPackage): PackageForm => ({
  name: p.name,
  points: String(p.points),
  bonusPoints: String(p.bonusPoints),
  price: String(p.price),
  status: p.status === 1,
});

export default function AdminPricingPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [packages, setPackages] = useState<AdminPointPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // plan modal
  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminPlan | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlanForm());

  // package modal
  const [pkgOpen, setPkgOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<AdminPointPackage | null>(null);
  const [pkgForm, setPkgForm] = useState<PackageForm>(emptyPackageForm());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const [planRes, pkgRes] = await Promise.all([
        adminPricingApi.listPlans(),
        adminPricingApi.listPackages(),
      ]);
      if (planRes.success && planRes.data) setPlans(planRes.data);
      if (pkgRes.success && pkgRes.data) setPackages(pkgRes.data);
      if (!planRes.success) setError(planRes.message || "加载套餐失败");
      else if (!pkgRes.success) setError(pkgRes.message || "加载积分包失败");
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    load();
  }, [load]);

  /* ── KPIs derived from real data ─────────────────────────────────────── */
  const kpis: Kpi[] = useMemo(() => {
    const onSale = plans.filter((p) => p.status === 1).length;
    const paid = plans.filter((p) => p.monthly > 0);
    const avgMonthly = paid.length
      ? Math.round(paid.reduce((s, p) => s + p.monthly, 0) / paid.length)
      : 0;
    return [
      { k: "在售套餐", v: String(onSale), dir: "up" },
      { k: "套餐总数", v: String(plans.length), dir: "up" },
      { k: "积分包", v: String(packages.length), dir: "up" },
      { k: "套餐均价", v: yuan(avgMonthly), dir: "up" },
    ];
  }, [plans, packages]);

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
    const dto: AdminPlanUpsertDTO = {
      name: planForm.name.trim(),
      monthly: toNum(planForm.monthly),
      yearly: toNum(planForm.yearly),
      monthlyPoints: toNum(planForm.monthlyPoints),
      items: planForm.items
        .split(/[·\n,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      status: planForm.status ? 1 : 0,
    };
    if (!dto.name) return;
    const res = editingPlan
      ? await adminPricingApi.updatePlan(editingPlan.id, dto)
      : await adminPricingApi.createPlan(dto);
    if (res.success) {
      setPlanOpen(false);
      load();
    } else {
      setError(res.message || "保存套餐失败");
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
    const res = await adminPricingApi.updatePlan(p.id, dto);
    if (res.success) load();
    else setError(res.message || "更新状态失败");
  };
  const deletePlan = async (p: AdminPlan) => {
    const res = await adminPricingApi.deletePlan(p.id);
    if (res.success) load();
    else setError(res.message || "删除套餐失败");
  };

  /* ── package actions ─────────────────────────────────────────────────── */
  const openCreatePkg = () => {
    setEditingPkg(null);
    setPkgForm(emptyPackageForm());
    setPkgOpen(true);
  };
  const openEditPkg = (p: AdminPointPackage) => {
    setEditingPkg(p);
    setPkgForm(packageToForm(p));
    setPkgOpen(true);
  };
  const savePkg = async () => {
    const dto: AdminPointPackageUpsertDTO = {
      name: pkgForm.name.trim(),
      points: toNum(pkgForm.points),
      bonusPoints: toNum(pkgForm.bonusPoints),
      price: toNum(pkgForm.price),
      status: pkgForm.status ? 1 : 0,
    };
    if (!dto.name) return;
    const res = editingPkg
      ? await adminPricingApi.updatePackage(editingPkg.id, dto)
      : await adminPricingApi.createPackage(dto);
    if (res.success) {
      setPkgOpen(false);
      load();
    } else {
      setError(res.message || "保存积分包失败");
    }
  };
  const togglePkg = async (p: AdminPointPackage, next: boolean) => {
    const dto: AdminPointPackageUpsertDTO = {
      name: p.name,
      points: p.points,
      bonusPoints: p.bonusPoints,
      price: p.price,
      sortOrder: p.sortOrder,
      status: next ? 1 : 0,
    };
    const res = await adminPricingApi.updatePackage(p.id, dto);
    if (res.success) load();
    else setError(res.message || "更新状态失败");
  };
  const deletePkg = async (p: AdminPointPackage) => {
    const res = await adminPricingApi.deletePackage(p.id);
    if (res.success) load();
    else setError(res.message || "删除积分包失败");
  };

  return (
    <>
      <StatCardGrid items={kpis} />

      {error ? (
        <div className="adm-panel" style={{ padding: 16 }}>
          <span className="tag2 red">
            <i className="dot" />
            {error}
          </span>
        </div>
      ) : null}

      {/* 套餐管理 */}
      <Panel
        title="套餐管理"
        sub="会员套餐定价与权益 · 与公开定价同源"
        tools={
          <button type="button" className="adm-btn" onClick={openCreatePlan}>
            + 新增套餐
          </button>
        }
      >
        {loading ? (
          <div style={{ padding: 18 }} className="muted">
            加载中…
          </div>
        ) : plans.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无套餐，点击「新增套餐」创建第一个会员套餐。
          </div>
        ) : (
          <AdminTable<AdminPlan>
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
              { header: "年价", className: "mono", cell: (r) => yuan(r.yearly) },
              { header: "每月积分", className: "mono", cell: (r) => num(r.monthlyPoints) },
              {
                header: "权益",
                className: "muted",
                cell: (r) => (r.items ?? []).join(" · ") || "—",
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
                cell: (r) => (
                  <RowActions
                    actions={[
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

      {/* 积分包管理 */}
      <Panel
        title="积分包管理"
        sub="一次性积分充值包"
        tools={
          <button type="button" className="adm-btn ghost" onClick={openCreatePkg}>
            + 新增积分包
          </button>
        }
      >
        {loading ? (
          <div style={{ padding: 18 }} className="muted">
            加载中…
          </div>
        ) : packages.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无积分包，点击「新增积分包」创建。
          </div>
        ) : (
          <AdminTable<AdminPointPackage>
            rows={packages}
            rowKey={(r) => r.id}
            columns={[
              { header: "积分包", className: "strong", cell: (r) => r.name },
              { header: "积分", className: "mono", cell: (r) => num(r.points) },
              { header: "赠送", className: "mono", cell: (r) => `+${num(r.bonusPoints)}` },
              { header: "价格", className: "mono", cell: (r) => yuan(r.price) },
              {
                header: "状态",
                cell: (r) => (
                  <SwitchToggle
                    checked={r.status === 1}
                    onChange={(next) => togglePkg(r, next)}
                    aria-label={`${r.name} 上架`}
                  />
                ),
              },
              {
                header: "操作",
                align: "right",
                cell: (r) => (
                  <RowActions
                    actions={[
                      { label: "编辑", onClick: () => openEditPkg(r) },
                      { label: "删除", onClick: () => deletePkg(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* 新增 / 编辑套餐 modal */}
      <AdminModal
        open={planOpen}
        title={editingPlan ? "编辑套餐" : "新增套餐"}
        subtitle="配置会员套餐的定价、积分与权益（保存后同步公开定价）"
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
            <Field label="每月积分" span={2}>
              <input
                type="number"
                placeholder="如：3000"
                value={planForm.monthlyPoints}
                onChange={(e) => setPlanForm((f) => ({ ...f, monthlyPoints: e.target.value }))}
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
            <Field label="年价 (¥)" required span={2}>
              <input
                type="number"
                placeholder="如：468"
                value={planForm.yearly}
                onChange={(e) => setPlanForm((f) => ({ ...f, yearly: e.target.value }))}
              />
            </Field>
            <Field label="权益说明" span={4} hint="用 · 或换行分隔多条权益">
              <input
                placeholder="如：全模型 · 高清 · 商用授权"
                value={planForm.items}
                onChange={(e) => setPlanForm((f) => ({ ...f, items: e.target.value }))}
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

      {/* 新增 / 编辑积分包 modal */}
      <AdminModal
        open={pkgOpen}
        title={editingPkg ? "编辑积分包" : "新增积分包"}
        subtitle="配置一次性积分充值包"
        onClose={() => setPkgOpen(false)}
        onSave={savePkg}
      >
        <FormCard title="积分包信息">
          <FormGrid>
            <Field label="名称" required span={2}>
              <input
                placeholder="如：积分 3000"
                value={pkgForm.name}
                onChange={(e) => setPkgForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="价格 (¥)" required span={2}>
              <input
                type="number"
                placeholder="如：39"
                value={pkgForm.price}
                onChange={(e) => setPkgForm((f) => ({ ...f, price: e.target.value }))}
              />
            </Field>
            <Field label="积分" required span={2}>
              <input
                type="number"
                placeholder="如：3000"
                value={pkgForm.points}
                onChange={(e) => setPkgForm((f) => ({ ...f, points: e.target.value }))}
              />
            </Field>
            <Field label="赠送积分" span={2}>
              <input
                type="number"
                placeholder="如：300"
                value={pkgForm.bonusPoints}
                onChange={(e) => setPkgForm((f) => ({ ...f, bonusPoints: e.target.value }))}
              />
            </Field>
            <Field label="状态" span={4} hint="关闭后该积分包下架">
              <SwitchToggle
                checked={pkgForm.status}
                onChange={(next) => setPkgForm((f) => ({ ...f, status: next }))}
                aria-label="积分包状态"
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}
