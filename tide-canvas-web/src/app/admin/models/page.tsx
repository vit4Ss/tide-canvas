"use client";

/* ============================================================================
   /admin/models — 模型管理 (模型市场).

   Wired to the REAL admin API (/api/admin/models → market_model). These rows
   ARE the public 模型市场, so edits here change the public /models page.

   Keeps the liuguang admin markup/classes + the shared components
   (StatCardGrid / Panel / FilterBar / AdminTable / StatusPill / SwitchToggle /
   RowActions / AdminModal / FormCard / FormGrid / Field). The rich design-mock
   pricing-matrix form is replaced by the fields the market_model table actually
   exposes (名称 / 描述 / 封面 / 标签 / 单次积分 / 关联生成模型 / 状态), since the
   backend has no per-quality pricing matrix.

   Client component (filter state, switches, modal, CRUD).
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  Field,
  FilterBar,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { adminSwatch } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminModelsApi } from "@/lib/admin-models-api";
import {
  MODEL_STATUS_LABEL,
  type AdminAiModelVO,
  type AdminModelVO,
} from "@/types/admin-models";

/** Filter chips → backend status filter (undefined = 全部). */
const FILTERS: { label: string; status?: number }[] = [
  { label: "全部" },
  { label: "已上架", status: 1 },
  { label: "已下架", status: 2 },
  { label: "待审核", status: 0 },
];

function statusTone(status: number): PillTone {
  if (status === 1) return "green";
  if (status === 2) return "gray";
  return "amber";
}

function statusLabel(status: number): string {
  return MODEL_STATUS_LABEL[status] ?? "未知";
}

export default function AdminModelsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [rows, setRows] = useState<AdminModelVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterIdx, setFilterIdx] = useState(0);
  const [aiModels, setAiModels] = useState<AdminAiModelVO[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminModelVO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const status = FILTERS[filterIdx]?.status;
      const res = await adminModelsApi.list({ pageNum: 1, pageSize: 100, status });
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession, filterIdx]);

  useEffect(() => {
    load();
  }, [load]);

  // ai-model registry (for the 关联生成模型 select); loaded once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureSession();
      const res = await adminModelsApi.listAiModels();
      if (!cancelled && res.success && res.data) setAiModels(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSession]);

  const kpis: Kpi[] = useMemo(() => {
    const live = rows.filter((m) => m.status === 1).length;
    const off = rows.filter((m) => m.status === 2).length;
    const pending = rows.filter((m) => m.status === 0).length;
    return [
      { k: "模型总数", v: String(total), d: "", dir: "up" },
      { k: "已上架", v: String(live), d: "", dir: "up" },
      { k: "已下架", v: String(off), d: "", dir: "up" },
      { k: "待审核", v: String(pending), d: "", dir: pending > 0 ? "down" : "up" },
    ];
  }, [rows, total]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (m: AdminModelVO) => {
    setEditing(m);
    setModalOpen(true);
  };

  const toggleStatus = async (m: AdminModelVO, next: boolean) => {
    const res = await adminModelsApi.setStatus(m.id, { enabled: next });
    if (res.success) load();
    else load(); // revert from server truth on failure
  };

  const removeModel = async (m: AdminModelVO) => {
    if (typeof window !== "undefined" && !window.confirm(`确定删除模型「${m.name}」？此操作会同步从模型市场移除。`)) {
      return;
    }
    const res = await adminModelsApi.remove(m.id);
    if (res.success) load();
    else setError(res.message || "删除失败");
  };

  return (
    <>
      <StatCardGrid items={kpis} />

      <Panel
        title="模型管理"
        sub="接入、定价与上下架（即模型市场）"
        tools={
          <FilterBar
            options={FILTERS.map((f) => f.label)}
            value={FILTERS[filterIdx].label}
            onChange={(_, i) => setFilterIdx(i)}
            actions={
              <button type="button" className="adm-btn" onClick={openCreate}>
                + 接入模型
              </button>
            }
          />
        }
      >
        {loading ? (
          <div className="muted" style={{ padding: "40px 18px", textAlign: "center" }}>
            加载中…
          </div>
        ) : error ? (
          <div className="muted" style={{ padding: "40px 18px", textAlign: "center" }}>
            {error}
            <div style={{ marginTop: 12 }}>
              <button type="button" className="adm-btn ghost" onClick={load}>
                重试
              </button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="muted" style={{ padding: "40px 18px", textAlign: "center" }}>
            暂无模型，点击「接入模型」新增。
          </div>
        ) : (
          <AdminTable<AdminModelVO>
            rows={rows}
            rowKey={(m) => m.id}
            columns={[
              {
                header: "模型",
                sortable: true,
                sortValue: (m) => m.name,
                cell: (m) => (
                  <div className="cellflex">
                    <span className="sw" style={{ background: adminSwatch(m.name) }} />
                    <span className="strong">{m.name}</span>
                  </div>
                ),
              },
              {
                header: "作者",
                className: "muted",
                sortable: true,
                sortValue: (m) => m.authorName,
                cell: (m) => m.authorName || "—",
              },
              {
                header: "标签",
                className: "muted",
                cell: (m) => m.tags || "—",
              },
              {
                header: "单次积分",
                className: "mono",
                sortable: true,
                sortValue: (m) => parseFloat(m.pointCost) || 0,
                cell: (m) => m.pointCost,
              },
              {
                header: "调用量",
                className: "mono",
                sortable: true,
                sortValue: (m) => m.useCount,
                cell: (m) => m.useCount.toLocaleString(),
              },
              {
                header: "状态",
                cell: (m) => (
                  <div className="cellflex" style={{ gap: 8 }}>
                    <SwitchToggle
                      checked={m.enabled}
                      onChange={(next) => toggleStatus(m, next)}
                      aria-label={`${m.name} 上下架`}
                    />
                    <StatusPill tone={statusTone(m.status)}>{statusLabel(m.status)}</StatusPill>
                  </div>
                ),
              },
              {
                header: "操作",
                align: "right",
                cell: (m) => (
                  <RowActions
                    actions={[
                      { label: "配置", onClick: () => openEdit(m) },
                      { label: "删除", onClick: () => removeModel(m) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      <ModelModal
        key={editing?.id ?? "new"}
        open={modalOpen}
        model={editing}
        aiModels={aiModels}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ModelModal — 配置/新增模型. Bound to the real market_model columns. Keeps the
   liuguang FormCard/FormGrid/Field markup; submits via the admin models API.
   ──────────────────────────────────────────────────────────────────────── */

function ModelModal({
  open,
  model,
  aiModels,
  onClose,
  onSaved,
}: {
  open: boolean;
  model: AdminModelVO | null;
  aiModels: AdminAiModelVO[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(model?.name ?? "");
  const [description, setDescription] = useState(model?.description ?? "");
  const [coverUrl, setCoverUrl] = useState(model?.coverUrl ?? "");
  const [tags, setTags] = useState(model?.tags ?? "");
  const [pointCost, setPointCost] = useState(model?.pointCost ?? "0");
  const [aiModelId, setAiModelId] = useState(model?.aiModelId ?? "");
  const [status, setStatus] = useState<number>(model?.status ?? 1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setErr("请填写模型名称");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        coverUrl: coverUrl.trim(),
        tags: tags.trim(),
        pointCost: pointCost.trim() || "0",
        aiModelId: aiModelId || undefined,
        status,
      };
      const res = model
        ? await adminModelsApi.update(model.id, payload)
        : await adminModelsApi.create(payload);
      if (res.success) onSaved();
      else setErr(res.message || "保存失败");
    } catch {
      setErr("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal
      open={open}
      title={model ? `配置模型 · ${model.name}` : "新增模型"}
      subtitle="配置模型的基础信息、定价与上下架（同步至模型市场）"
      saveLabel={saving ? "保存中…" : "保存"}
      footNote={err ?? "变更将在保存后同步到模型市场"}
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="基础信息">
        <FormGrid>
          <Field label="名称" required>
            <input
              placeholder="如：DALL·E 3"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="标签" hint="逗号分隔，如：动漫,高审美">
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="如：动漫,人像" />
          </Field>
          <Field label="封面 URL" span={2}>
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
          <Field label="描述" span={2} hint="模型市场卡片副标题">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="如：动漫高审美模型"
              rows={3}
            />
          </Field>
        </FormGrid>
      </FormCard>

      <FormCard title="计费与关联">
        <FormGrid>
          <Field label="单次积分" hint="支持小数；运行/获取所需积分">
            <input
              value={pointCost}
              onChange={(e) => setPointCost(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
            />
          </Field>
          <Field label="关联生成模型" hint="底层 ai_model（选填）">
            <select value={aiModelId} onChange={(e) => setAiModelId(e.target.value)}>
              <option value="">不关联</option>
              {aiModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="状态" span={2}>
            <select value={status} onChange={(e) => setStatus(Number(e.target.value))}>
              <option value={1}>已上架</option>
              <option value={2}>已下架</option>
              <option value={0}>待审核</option>
            </select>
          </Field>
        </FormGrid>
      </FormCard>
    </AdminModal>
  );
}
