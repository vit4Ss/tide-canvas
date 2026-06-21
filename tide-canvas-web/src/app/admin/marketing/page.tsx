"use client";

/* ============================================================================
   /admin/marketing — 营销管理.

   Faithful port of admin.js V.marketing() + mktModal(), now wired to the REAL
   backend (full CRUD):
     GET/POST/PUT/DELETE /api/admin/marketing/campaigns
     GET/POST/PUT/DELETE /api/admin/marketing/coupons

     - 4 KPI tiles (进行中活动 / 今日券核销 / 活动带来营收 / 拉新 ROI) — static.
     - 营销活动 panel: status filter chips + 新建活动, table
       (活动 / 类型 / 周期 / 参与 / 状态 / 操作[编辑·删除])
     - 优惠券 / 兑换码 panel: 发券, table
       (名称 / 类型 / 面额·力度 / 已领·已用 / 有效期 / 状态[开关] / 操作[编辑·删除])
     - 渠道投放 panel: cfg-grid (渠道 ROI h-bars / 获客成本 CAC / Push 触达) — static.
     - mktModal: 新建/编辑 活动 OR 发券 (kind toggles 类型 options + card title),
       writing real campaign/coupon DTOs and refreshing the list on save.

   Client component (modals + interactive tables + loading/empty states).
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type Column,
  type StatCardProps,
  type StatusPillProps,
} from "@/components/admin";
import { HBars } from "@/components/admin/charts";
import { FilterChips } from "@/components/admin/filter-bar";
import { adminMarketingApi } from "@/lib/admin-marketing-api";
import type {
  CampaignVO,
  CampaignDTO,
  CouponVO,
  CouponDTO,
} from "@/types/admin-marketing";
import { useAuthStore } from "@/stores/use-auth-store";
import { formatDateTime } from "@/lib/utils";

type PillTone = StatusPillProps["tone"];

/* ── static display chrome (no longer sourced from @/mock) ───────────────── */

const MARKETING_KPIS: StatCardProps[] = [
  { k: "进行中活动", v: "8", d: "+2 本周", dir: "up" },
  { k: "今日券核销", v: "4,218", d: "+9%", dir: "up" },
  { k: "活动带来营收", v: "¥86,400", d: "+14%", dir: "up" },
  { k: "拉新 ROI", v: "3.8×", d: "+0.4", dir: "up" },
];

const CHANNEL_ROI: { n: string; v: number }[] = [
  { n: "抖音", v: 4200 },
  { n: "小红书", v: 3600 },
  { n: "微信", v: 2800 },
  { n: "B 站", v: 1900 },
  { n: "SEO", v: 1500 },
];

const CHANNEL_CAC: { label: string; value: string }[] = [
  { label: "本月 CAC", value: "¥18.6" },
  { label: "目标 CAC", value: "≤ ¥22" },
  { label: "LTV / CAC", value: "4.2×" },
];

const CAMPAIGN_FILTERS = ["全部", "draft", "active", "paused", "ended"] as const;
const CAMPAIGN_FILTER_LABELS: Record<string, string> = {
  全部: "全部",
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  ended: "已结束",
};
const CAMPAIGN_TYPES = ["促销", "拉新", "裂变", "活动", "线索"];
const COUPON_TYPES = ["满减", "折扣", "兑换", "直减"];
const CAMPAIGN_STATUS_OPTIONS = ["draft", "active", "paused", "ended"];
const COUPON_STATUS_OPTIONS = ["active", "inactive"];

/** Campaign status → pill (label + tone). */
function campaignStatus(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case "active":
      return { label: "进行中", tone: "green" };
    case "paused":
      return { label: "已暂停", tone: "amber" };
    case "ended":
      return { label: "已结束", tone: "gray" };
    case "draft":
    default:
      return { label: "草稿", tone: "blue" };
  }
}

/** Render a "start ~ end" period string from RFC3339 endpoints. */
function periodLabel(startTime: string, endTime: string): string {
  const s = startTime ? formatDateTime(startTime) : "";
  const e = endTime ? formatDateTime(endTime) : "";
  if (!s && !e) return "长期";
  return `${s || "—"} ~ ${e || "长期"}`;
}

/* ── modal state ─────────────────────────────────────────────────────────── */

interface CampaignModal {
  kind: "campaign";
  row: CampaignVO | null;
}
interface CouponModal {
  kind: "coupon";
  row: CouponVO | null;
}
type ModalState = CampaignModal | CouponModal;

/** Datetime-local string from an RFC3339 value (or "" when unset). */
function toLocalInput(rfc: string): string {
  if (!rfc) return "";
  const d = new Date(rfc);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminMarketingPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [campaignFilter, setCampaignFilter] = useState<string>(CAMPAIGN_FILTERS[0]);
  const [campaigns, setCampaigns] = useState<CampaignVO[]>([]);
  const [coupons, setCoupons] = useState<CouponVO[]>([]);
  const [campaignTotal, setCampaignTotal] = useState(0);
  const [couponTotal, setCouponTotal] = useState(0);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingCoupons, setLoadingCoupons] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);

  // form refs (uncontrolled inputs read on save)
  const nameRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const strengthRef = useRef<HTMLInputElement>(null);
  const limitRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const audienceRef = useRef<HTMLInputElement>(null);
  const channelsRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);

  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    setCampaignError(null);
    try {
      await ensureSession();
      const res = await adminMarketingApi.listCampaigns({
        pageNum: 1,
        pageSize: 100,
        status: campaignFilter === "全部" ? undefined : campaignFilter,
      });
      if (res.success && res.data) {
        setCampaigns(res.data.records);
        setCampaignTotal(res.data.total);
      } else {
        setCampaignError(res.message || "加载活动失败");
        setCampaigns([]);
        setCampaignTotal(0);
      }
    } catch {
      setCampaignError("加载活动失败");
      setCampaigns([]);
      setCampaignTotal(0);
    } finally {
      setLoadingCampaigns(false);
    }
  }, [ensureSession, campaignFilter]);

  const loadCoupons = useCallback(async () => {
    setLoadingCoupons(true);
    setCouponError(null);
    try {
      await ensureSession();
      const res = await adminMarketingApi.listCoupons({ pageNum: 1, pageSize: 100 });
      if (res.success && res.data) {
        setCoupons(res.data.records);
        setCouponTotal(res.data.total);
      } else {
        setCouponError(res.message || "加载优惠券失败");
        setCoupons([]);
        setCouponTotal(0);
      }
    } catch {
      setCouponError("加载优惠券失败");
      setCoupons([]);
      setCouponTotal(0);
    } finally {
      setLoadingCoupons(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);
  useEffect(() => {
    loadCoupons();
  }, [loadCoupons]);

  const openCampaign = (row: CampaignVO | null) => setModal({ kind: "campaign", row });
  const openCoupon = (row: CouponVO | null) => setModal({ kind: "coupon", row });
  const close = () => {
    if (!saving) setModal(null);
  };

  const isCoupon = modal?.kind === "coupon";
  const typeOptions = isCoupon ? COUPON_TYPES : CAMPAIGN_TYPES;
  const statusOptions = isCoupon ? COUPON_STATUS_OPTIONS : CAMPAIGN_STATUS_OPTIONS;

  const handleSave = useCallback(async () => {
    if (!modal) return;
    setSaving(true);
    try {
      await ensureSession();
      const startVal = startRef.current?.value || undefined;
      const endVal = endRef.current?.value || undefined;
      const limitVal = limitRef.current?.value;
      const limitNum = limitVal ? Number(limitVal) : undefined;

      if (modal.kind === "campaign") {
        const dto: CampaignDTO = {
          name: nameRef.current?.value.trim() ?? "",
          type: typeRef.current?.value ?? CAMPAIGN_TYPES[0],
          strength: strengthRef.current?.value ?? "",
          startTime: startVal,
          endTime: endVal,
          limit: Number.isFinite(limitNum) ? limitNum : undefined,
          status: statusRef.current?.value ?? "draft",
          audience: audienceRef.current?.value ?? "",
          channels: channelsRef.current?.value ?? "",
        };
        const res = modal.row
          ? await adminMarketingApi.updateCampaign(modal.row.id, dto)
          : await adminMarketingApi.createCampaign(dto);
        if (res.success) {
          setModal(null);
          await loadCampaigns();
        }
      } else {
        const dto: CouponDTO = {
          code: codeRef.current?.value.trim() ?? "",
          type: typeRef.current?.value ?? COUPON_TYPES[0],
          value: valueRef.current?.value || undefined,
          startTime: startVal,
          endTime: endVal,
          limit: Number.isFinite(limitNum) ? limitNum : undefined,
          status: statusRef.current?.value ?? "active",
        };
        const res = modal.row
          ? await adminMarketingApi.updateCoupon(modal.row.id, dto)
          : await adminMarketingApi.createCoupon(dto);
        if (res.success) {
          setModal(null);
          await loadCoupons();
        }
      }
    } finally {
      setSaving(false);
    }
  }, [modal, ensureSession, loadCampaigns, loadCoupons]);

  const deleteCampaign = useCallback(
    async (row: CampaignVO) => {
      await ensureSession();
      const res = await adminMarketingApi.deleteCampaign(row.id);
      if (res.success) await loadCampaigns();
    },
    [ensureSession, loadCampaigns],
  );

  const deleteCoupon = useCallback(
    async (row: CouponVO) => {
      await ensureSession();
      const res = await adminMarketingApi.deleteCoupon(row.id);
      if (res.success) await loadCoupons();
    },
    [ensureSession, loadCoupons],
  );

  /** Toggle a coupon's enabled status (active <-> inactive) and refresh. */
  const toggleCoupon = useCallback(
    async (row: CouponVO, next: boolean) => {
      await ensureSession();
      const dto: CouponDTO = {
        code: row.code,
        type: row.type,
        value: row.value,
        startTime: row.startTime || undefined,
        endTime: row.endTime || undefined,
        limit: row.limit,
        used: row.used,
        status: next ? "active" : "inactive",
      };
      const res = await adminMarketingApi.updateCoupon(row.id, dto);
      if (res.success) await loadCoupons();
    },
    [ensureSession, loadCoupons],
  );

  const campaignColumns: Column<CampaignVO>[] = useMemo(
    () => [
      { header: "活动", className: "strong", cell: (r) => r.name, sortable: true, sortValue: (r) => r.name },
      { header: "类型", cell: (r) => <StatusPill tone="blue">{r.type}</StatusPill> },
      { header: "周期", className: "muted", cell: (r) => periodLabel(r.startTime, r.endTime) },
      {
        header: "参与",
        className: "mono",
        cell: (r) => `${r.used.toLocaleString()}${r.limit ? ` / ${r.limit.toLocaleString()}` : ""}`,
      },
      {
        header: "状态",
        cell: (r) => {
          const s = campaignStatus(r.status);
          return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
        },
      },
      {
        header: "操作",
        align: "right",
        cell: (r) => (
          <RowActions
            actions={[
              { label: "编辑", onClick: () => openCampaign(r) },
              { label: "删除", onClick: () => deleteCampaign(r), danger: true },
            ]}
          />
        ),
      },
    ],
    [deleteCampaign],
  );

  const couponColumns: Column<CouponVO>[] = useMemo(
    () => [
      { header: "名称", className: "strong", cell: (r) => r.code },
      { header: "类型", cell: (r) => r.type },
      { header: "面额 / 力度", className: "mono", cell: (r) => r.value || "—" },
      {
        header: "已领 / 已用",
        className: "mono",
        cell: (r) => `${r.limit.toLocaleString()} / ${r.used.toLocaleString()}`,
      },
      { header: "有效期", className: "muted", cell: (r) => (r.endTime ? `~ ${formatDateTime(r.endTime)}` : "长期") },
      {
        header: "状态",
        cell: (r) => (
          <SwitchToggle
            checked={r.status === "active"}
            onChange={(next) => toggleCoupon(r, next)}
            aria-label={`${r.code} 启用`}
          />
        ),
      },
      {
        header: "操作",
        align: "right",
        cell: (r) => (
          <RowActions
            actions={[
              { label: "编辑", onClick: () => openCoupon(r) },
              { label: "删除", onClick: () => deleteCoupon(r), danger: true },
            ]}
          />
        ),
      },
    ],
    [deleteCoupon, toggleCoupon],
  );

  const editingCampaign = modal?.kind === "campaign" ? modal.row : null;
  const editingCoupon = modal?.kind === "coupon" ? modal.row : null;
  const modalTitle = modal?.row
    ? isCoupon
      ? `编辑 · ${editingCoupon?.code ?? ""}`
      : `编辑 · ${editingCampaign?.name ?? ""}`
    : isCoupon
      ? "发券"
      : "新建活动";

  return (
    <>
      <StatCardGrid items={MARKETING_KPIS} />

      {/* 营销活动 */}
      <Panel
        title="营销活动"
        sub="运营活动、Banner 与投放"
        tools={
          <>
            <FilterChips
              options={CAMPAIGN_FILTERS.map((f) => CAMPAIGN_FILTER_LABELS[f] ?? f)}
              value={CAMPAIGN_FILTER_LABELS[campaignFilter] ?? campaignFilter}
              onChange={(_, i) => setCampaignFilter(CAMPAIGN_FILTERS[i])}
            />
            <button type="button" className="adm-btn" onClick={() => openCampaign(null)}>
              + 新建活动
            </button>
          </>
        }
      >
        {loadingCampaigns ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            加载中…
          </div>
        ) : campaignError ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            {campaignError}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            暂无营销活动
          </div>
        ) : (
          <AdminTable<CampaignVO>
            rows={campaigns}
            rowKey={(r) => r.id}
            columns={campaignColumns}
            pageSize={10}
            total={campaignFilter === "全部" ? campaignTotal : campaigns.length}
          />
        )}
      </Panel>

      {/* 优惠券 / 兑换码 */}
      <Panel
        title="优惠券 / 兑换码"
        tools={
          <button type="button" className="adm-btn ghost" onClick={() => openCoupon(null)}>
            + 发券
          </button>
        }
      >
        {loadingCoupons ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            加载中…
          </div>
        ) : couponError ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            {couponError}
          </div>
        ) : coupons.length === 0 ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            暂无优惠券
          </div>
        ) : (
          <AdminTable<CouponVO>
            rows={coupons}
            rowKey={(r) => r.id}
            columns={couponColumns}
            pageSize={10}
            total={couponTotal}
          />
        )}
      </Panel>

      {/* 渠道投放 — static display chrome */}
      <Panel title="渠道投放" sub="各渠道获客与成本">
        <div style={{ padding: 18 }}>
          <div className="cfg-grid">
            <div className="cfg-card">
              <h3>渠道 ROI</h3>
              <p>近 30 天各投放渠道表现。</p>
              <HBars rows={CHANNEL_ROI} color="#0a84ff" />
            </div>
            <div className="cfg-card">
              <h3>获客成本 CAC</h3>
              <p>单个付费用户平均成本。</p>
              {CHANNEL_CAC.map((r) => (
                <div className="cfg-row" key={r.label}>
                  <span className="lab">{r.label}</span>
                  <span className="mono">{r.value}</span>
                </div>
              ))}
              <div className="cfg-row">
                <span className="lab">自动竞价</span>
                <SwitchToggle defaultChecked aria-label="自动竞价" />
              </div>
            </div>
            <div className="cfg-card">
              <h3>Push / 触达</h3>
              <p>消息推送与召回策略。</p>
              <div className="cfg-row">
                <span className="lab">流失召回</span>
                <SwitchToggle defaultChecked aria-label="流失召回" />
              </div>
              <div className="cfg-row">
                <span className="lab">每日 Push 上限</span>
                <input type="number" defaultValue={2} />
                <span className="unit">条</span>
              </div>
              <div className="cfg-row">
                <span className="lab">免打扰时段</span>
                <span className="muted">23:00–8:00</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* mktModal — 新建/编辑 活动 / 发券 */}
      <AdminModal
        open={modal != null}
        title={modalTitle}
        subtitle={
          modal?.row
            ? isCoupon
              ? "编辑优惠券 / 兑换码"
              : "编辑营销活动"
            : isCoupon
              ? "发放一张优惠券 / 兑换码"
              : "新建一个营销活动"
        }
        saveLabel={saving ? "保存中…" : "保存"}
        onClose={close}
        onSave={handleSave}
      >
        <FormCard title={isCoupon ? "优惠券信息" : "活动信息"}>
          <FormGrid>
            {isCoupon ? (
              <Field label="兑换码 / 名称" required span={2}>
                <input ref={codeRef} placeholder="如：NEWYEAR20" defaultValue={editingCoupon?.code ?? ""} />
              </Field>
            ) : (
              <Field label="名称" required span={2}>
                <input ref={nameRef} placeholder="如：限时年付 -42%" defaultValue={editingCampaign?.name ?? ""} />
              </Field>
            )}
            <Field label="类型" span={2}>
              <select ref={typeRef} defaultValue={(modal?.row && (isCoupon ? editingCoupon?.type : editingCampaign?.type)) || typeOptions[0]}>
                {typeOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            {isCoupon ? (
              <Field label="面额 / 力度">
                <input ref={valueRef} placeholder="如：20" defaultValue={editingCoupon?.value ?? ""} />
              </Field>
            ) : (
              <Field label="力度 / 面额">
                <input ref={strengthRef} placeholder="如：-42%" defaultValue={editingCampaign?.strength ?? ""} />
              </Field>
            )}
            <Field label="限量">
              <input
                ref={limitRef}
                type="number"
                placeholder="不限"
                defaultValue={
                  modal?.row ? String((isCoupon ? editingCoupon?.limit : editingCampaign?.limit) ?? "") : ""
                }
              />
            </Field>
            <Field label="开始时间" span={2}>
              <input
                ref={startRef}
                type="datetime-local"
                defaultValue={toLocalInput((isCoupon ? editingCoupon?.startTime : editingCampaign?.startTime) ?? "")}
              />
            </Field>
            <Field label="结束时间" span={2}>
              <input
                ref={endRef}
                type="datetime-local"
                defaultValue={toLocalInput((isCoupon ? editingCoupon?.endTime : editingCampaign?.endTime) ?? "")}
              />
            </Field>
            <Field label="状态" span={2}>
              <select ref={statusRef} defaultValue={(modal?.row && (isCoupon ? editingCoupon?.status : editingCampaign?.status)) || statusOptions[0]}>
                {statusOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            {!isCoupon && (
              <>
                <Field label="适用人群" span={2}>
                  <input ref={audienceRef} placeholder="如：全部 / 新用户" defaultValue={editingCampaign?.audience ?? ""} />
                </Field>
                <Field label="投放渠道" span={4}>
                  <input ref={channelsRef} placeholder="如：站内,抖音,微信" defaultValue={editingCampaign?.channels ?? ""} />
                </Field>
              </>
            )}
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}
