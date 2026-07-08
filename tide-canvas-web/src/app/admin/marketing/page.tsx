"use client";

/* ============================================================================
   /admin/marketing — 营销管理.

   Wired to the REAL backend (full CRUD):
     GET/POST/PUT/DELETE /api/admin/marketing/campaigns

     - KPI tiles（活动总数 / 进行中活动）— 由真实列表派生。
     - 营销活动 panel: status filter chips + 新建活动, table
       (活动 / 类型 / 周期 / 参与 / 状态 / 操作[编辑·删除])
     - mktModal: 新建/编辑 活动，writing real campaign DTOs and refreshing.

   优惠券 / 兑换码 面板已下线（2026-07-09 用户拍板：产品没有优惠券体系，
   后端 coupon 接口/模型/种子一并移除）。
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
  type Column,
  type StatCardProps,
  type StatusPillProps,
} from "@/components/admin";
import { FilterChips } from "@/components/admin/filter-bar";
import { adminMarketingApi } from "@/lib/admin-marketing-api";
import type { CampaignVO, CampaignDTO } from "@/types/admin-marketing";
import { useAuthStore } from "@/stores/use-auth-store";
import { formatDateTime } from "@/lib/utils";

type PillTone = StatusPillProps["tone"];

const CAMPAIGN_FILTERS = ["全部", "draft", "active", "paused", "ended"] as const;
const CAMPAIGN_FILTER_LABELS: Record<string, string> = {
  全部: "全部",
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  ended: "已结束",
};
const CAMPAIGN_TYPES = ["促销", "拉新", "裂变", "活动", "线索"];
const CAMPAIGN_STATUS_OPTIONS = ["draft", "active", "paused", "ended"];
/** 状态下拉的中文展示文案（value 仍是后端枚举） */
const STATUS_OPTION_LABELS: Record<string, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  ended: "已结束",
};

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
  const [campaignTotal, setCampaignTotal] = useState(0);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  // modal: null = closed; {row:null} = 新建; {row} = 编辑
  const [modal, setModal] = useState<{ row: CampaignVO | null } | null>(null);
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

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const openCampaign = (row: CampaignVO | null) => setModal({ row });
  const close = () => {
    if (!saving) setModal(null);
  };

  const handleSave = useCallback(async () => {
    if (!modal) return;
    setSaving(true);
    try {
      await ensureSession();
      const limitVal = limitRef.current?.value;
      const limitNum = limitVal ? Number(limitVal) : undefined;
      const dto: CampaignDTO = {
        name: nameRef.current?.value.trim() ?? "",
        type: typeRef.current?.value ?? CAMPAIGN_TYPES[0],
        strength: strengthRef.current?.value ?? "",
        startTime: startRef.current?.value || undefined,
        endTime: endRef.current?.value || undefined,
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
    } finally {
      setSaving(false);
    }
  }, [modal, ensureSession, loadCampaigns]);

  const deleteCampaign = useCallback(
    async (row: CampaignVO) => {
      await ensureSession();
      const res = await adminMarketingApi.deleteCampaign(row.id);
      if (res.success) await loadCampaigns();
    },
    [ensureSession, loadCampaigns],
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

  const editing = modal?.row ?? null;
  const modalTitle = editing ? `编辑 · ${editing.name}` : "新建活动";

  // KPI 全部由真实列表派生
  const kpis: StatCardProps[] = [
    { k: "活动总数", v: String(campaignTotal), dir: "up" },
    { k: "进行中活动", v: String(campaigns.filter((c) => c.status === "active").length), dir: "up" },
  ];

  return (
    <>
      <StatCardGrid items={kpis} />

      {/* 营销活动 */}
      <Panel
        title="营销活动"
        sub="运营活动与投放"
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

      {/* 「优惠券/兑换码」面板已下线（产品无优惠券体系）；
          「渠道投放」（ROI/CAC/Push）早前已移除（编造数据） */}

      {/* mktModal — 新建/编辑 活动 */}
      <AdminModal
        open={modal != null}
        title={modalTitle}
        subtitle={editing ? "编辑营销活动" : "新建一个营销活动"}
        saveLabel={saving ? "保存中…" : "保存"}
        onClose={close}
        onSave={handleSave}
      >
        <FormCard title="活动信息">
          <FormGrid>
            <Field label="名称" required span={2}>
              <input ref={nameRef} placeholder="如：限时年付 -42%" defaultValue={editing?.name ?? ""} />
            </Field>
            <Field label="类型" span={2}>
              <select ref={typeRef} defaultValue={editing?.type || CAMPAIGN_TYPES[0]}>
                {CAMPAIGN_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="力度 / 面额">
              <input ref={strengthRef} placeholder="如：-42%" defaultValue={editing?.strength ?? ""} />
            </Field>
            <Field label="限量">
              <input
                ref={limitRef}
                type="number"
                placeholder="不限"
                defaultValue={editing ? String(editing.limit ?? "") : ""}
              />
            </Field>
            <Field label="开始时间" span={2}>
              <input ref={startRef} type="datetime-local" defaultValue={toLocalInput(editing?.startTime ?? "")} />
            </Field>
            <Field label="结束时间" span={2}>
              <input ref={endRef} type="datetime-local" defaultValue={toLocalInput(editing?.endTime ?? "")} />
            </Field>
            <Field label="状态" span={2}>
              <select ref={statusRef} defaultValue={editing?.status || CAMPAIGN_STATUS_OPTIONS[0]}>
                {CAMPAIGN_STATUS_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {STATUS_OPTION_LABELS[o] ?? o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="适用人群" span={2}>
              <input ref={audienceRef} placeholder="如：全部 / 新用户" defaultValue={editing?.audience ?? ""} />
            </Field>
            <Field label="投放渠道" span={4}>
              <input ref={channelsRef} placeholder="如：站内,抖音,微信" defaultValue={editing?.channels ?? ""} />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}
