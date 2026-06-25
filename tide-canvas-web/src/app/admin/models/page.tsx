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
  FormSection,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { adminSwatch } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { adminModelsApi } from "@/lib/admin-models-api";
import {
  MODEL_STATUS_LABEL,
  MODEL_TYPE_LABEL,
  MODEL_TYPE_FORM_LABEL,
  type AdminModelVO,
  type ModelConfig,
} from "@/types/admin-models";

/* ── option catalogs for the model config form ─────────────────────────────── */

const MODE_OPTIONS: Record<string, { v: string; l: string }[]> = {
  image: [
    { v: "t2i", l: "文生图" },
    { v: "i2i", l: "图生图" },
  ],
  video: [
    { v: "t2v", l: "文生视频" },
    { v: "i2v", l: "图生视频" },
    { v: "keyframe", l: "首尾帧" },
    { v: "omni_ref", l: "全能参考" },
  ],
  text: [],
  audio: [],
};
const QUALITY_OPTIONS = [
  { v: "low", l: "低画质" },
  { v: "medium", l: "标准画质" },
  { v: "high", l: "高画质" },
];
const RESOLUTION_OPTIONS: Record<string, string[]> = {
  image: ["1k", "2k", "4k"],
  video: ["480p", "720p", "1080p", "4k"],
};
const DURATION_OPTIONS = Array.from({ length: 15 }, (_, i) => `${i + 1}s`);
const RATIO_OPTIONS = ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9"];
const RATIO_LABEL: Record<string, string> = {};

/** Category chips → backend media-type filter (undefined = 全部). */
const TYPE_FILTERS: { label: string; type?: string }[] = [
  { label: "全部" },
  { label: "文本模型", type: "text" },
  { label: "图片模型", type: "image" },
  { label: "视频模型", type: "video" },
  { label: "音频模型", type: "audio" },
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
  const [typeIdx, setTypeIdx] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminModelVO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const type = TYPE_FILTERS[typeIdx]?.type;
      const res = await adminModelsApi.list({ pageNum: 1, pageSize: 100, type });
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
  }, [ensureSession, typeIdx]);

  useEffect(() => {
    load();
  }, [load]);

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

  // 刷新：pull the latest catalog from the upstream relay and upsert it into the
  // list (add new / update existing), then reload.
  const syncModels = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await ensureSession();
      const res = await adminModelsApi.sync();
      if (res.success && res.data) {
        const { created, updated, total } = res.data;
        toast.success(`已同步 ${total} 个模型 · 新增 ${created}，更新 ${updated}`);
        await load();
      } else {
        toast.error(res.message || "刷新失败");
      }
    } catch {
      toast.error("刷新失败，请稍后重试");
    } finally {
      setSyncing(false);
    }
  };

  // the model currently flagged as the AI-optimization primary (if any in view).
  const aiPrimary = useMemo(() => {
    const r = rows.find((m) => m.config?.aiOptimizePrimary);
    return r ? { id: r.id, name: r.name } : null;
  }, [rows]);

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
            options={TYPE_FILTERS.map((f) => f.label)}
            value={TYPE_FILTERS[typeIdx].label}
            onChange={(_, i) => setTypeIdx(i)}
            actions={
              <button
                type="button"
                className="adm-btn"
                onClick={syncModels}
                disabled={syncing}
              >
                {syncing ? "刷新中…" : "↻ 刷新"}
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
                header: "类型",
                className: "muted",
                sortable: true,
                sortValue: (m) => m.type,
                cell: (m) => MODEL_TYPE_LABEL[m.type] || "—",
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
        aiPrimary={aiPrimary}
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
   Chips — labeled multi/single select chip group (value ≠ label), styled with
   the liuguang `.mchips`/`.mchip` classes. Controlled.
   ──────────────────────────────────────────────────────────────────────── */

function Chips<T extends string | number>({
  options,
  value,
  onChange,
  single,
}: {
  options: { v: T; l: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  single?: boolean;
}) {
  const toggle = (v: T) => {
    if (single) {
      onChange([v]);
      return;
    }
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <div className="mchips">
      {options.map((o) => (
        <span
          key={String(o.v)}
          className={`mchip${value.includes(o.v) ? " on" : ""}`}
          onClick={() => toggle(o.v)}
        >
          {o.l}
        </span>
      ))}
    </div>
  );
}

/** RefPair — a 数量 + 单个大小（MB）input pair bound to two refLimits keys (0 = 不限制). */
function RefPair({
  label,
  countKey,
  sizeKey,
  get,
  set,
}: {
  label: string;
  countKey: string;
  sizeKey: string;
  get: (k: string) => number;
  set: (k: string, v: number) => void;
}) {
  return (
    <FormGrid>
      <Field label={`${label}数量`} span={2} hint="0 = 不限制">
        <input
          inputMode="numeric"
          value={String(get(countKey))}
          onChange={(e) => set(countKey, Number(e.target.value) || 0)}
          placeholder="0"
        />
      </Field>
      <Field label={`${label}单个大小（MB）`} span={2} hint="0 = 不限制">
        <input
          inputMode="decimal"
          value={String(get(sizeKey))}
          onChange={(e) => set(sizeKey, Number(e.target.value) || 0)}
          placeholder="0"
        />
      </Field>
    </FormGrid>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ModelModal — 配置/新增模型. A full GUI form (no raw JSON): base fields map to
   market_model columns; the generation settings (modes / batch / qualities /
   resolutions / ratios / price matrix …) are edited via chips + a matrix and
   persisted as the model's `config` object. The relay 刷新 pre-fills these.
   ──────────────────────────────────────────────────────────────────────── */

function ModelModal({
  open,
  model,
  aiPrimary,
  onClose,
  onSaved,
}: {
  open: boolean;
  model: AdminModelVO | null;
  aiPrimary: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c0: ModelConfig = model?.config ?? {};

  const [name, setName] = useState(model?.name ?? "");
  const [modelKey, setModelKey] = useState(model?.modelKey ?? "");
  const [type, setType] = useState(model?.type || "image");
  const [description, setDescription] = useState(model?.description ?? "");
  const [pointCost, setPointCost] = useState(model?.pointCost ?? "0");
  const [status, setStatus] = useState<number>(model?.status ?? 1);

  const [cfg, setCfg] = useState<ModelConfig>({
    provider: c0.provider ?? "",
    icon: c0.icon ?? "",
    costUsd: c0.costUsd ?? "",
    estSeconds: c0.estSeconds ?? 0,
    defaultPrompt: c0.defaultPrompt ?? "",
    ideas: c0.ideas ?? [],
    maxRefImages: c0.maxRefImages ?? 0,
    maxRefImageSizeMB: c0.maxRefImageSizeMB ?? 0,
    webSearch: c0.webSearch ?? false,
    fileUpload: c0.fileUpload ?? false,
    maxFileSizeMB: c0.maxFileSizeMB ?? 0,
    aiOptimizePrimary: c0.aiOptimizePrimary ?? false,
    refLimits: c0.refLimits ?? {},
    modes: c0.modes ?? [],
    ratios: c0.ratios ?? [],
    resolutions: c0.resolutions ?? [],
    qualities: c0.qualities ?? [],
    durations: c0.durations ?? [],
    batchOptions: c0.batchOptions ?? [],
    gridOutput: c0.gridOutput ?? false,
    priceMatrix: c0.priceMatrix ?? {},
  });
  const setC = (patch: Partial<ModelConfig>) => setCfg((p) => ({ ...p, ...patch }));

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isImage = type === "image";
  const isVideo = type === "video";
  const isText = type === "text";
  const showGen = isImage || isVideo;

  // price-matrix rows: image → qualities, video → durations; cols → resolutions.
  const matrixRows = isVideo
    ? (cfg.durations ?? []).map((d) => ({ key: d, label: d }))
    : (cfg.qualities ?? []).map((q) => ({
        key: q,
        label: QUALITY_OPTIONS.find((o) => o.v === q)?.l ?? q,
      }));
  const matrixCols = cfg.resolutions ?? [];

  const setCell = (row: string, col: string, val: string) =>
    setCfg((p) => {
      const pm: Record<string, Record<string, string>> = { ...(p.priceMatrix ?? {}) };
      pm[row] = { ...(pm[row] ?? {}), [col]: val };
      return { ...p, priceMatrix: pm };
    });

  // 视频参考素材限制 (flat refLimits map)
  const refGet = (k: string) => cfg.refLimits?.[k] ?? 0;
  const setRef = (k: string, v: number) =>
    setCfg((p) => ({ ...p, refLimits: { ...(p.refLimits ?? {}), [k]: v } }));

  // 灵感提示词 list editor
  const addIdea = () => setCfg((p) => ({ ...p, ideas: [...(p.ideas ?? []), ""] }));
  const setIdea = (i: number, val: string) =>
    setCfg((p) => {
      const arr = [...(p.ideas ?? [])];
      arr[i] = val;
      return { ...p, ideas: arr };
    });
  const removeIdea = (i: number) =>
    setCfg((p) => ({ ...p, ideas: (p.ideas ?? []).filter((_, j) => j !== i) }));

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
        modelKey: modelKey.trim(),
        type,
        description: description.trim(),
        pointCost: pointCost.trim() || "0",
        status,
        config: cfg,
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

  const modeOptions = MODE_OPTIONS[type] ?? [];

  return (
    <AdminModal
      open={open}
      title={model ? `配置模型 · ${model.name}` : "新增模型"}
      subtitle="基础信息 · 生成能力 · 积分定价（每个模型独立配置，同步至模型市场与创作台）"
      saveLabel={saving ? "保存中…" : "保存"}
      footNote={err ?? "变更将在保存后同步到模型市场与创作台"}
      onClose={onClose}
      onSave={save}
    >
      <FormCard title="基础信息">
        <FormGrid>
          <Field label="名称" required>
            <input placeholder="如：GPT Image 2" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="模型ID" required hint="上游模型标识（如 gpt-image-2）">
            <input placeholder="如：gpt-image-2" value={modelKey} onChange={(e) => setModelKey(e.target.value)} />
          </Field>
          <Field label="类型">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {["image", "video", "text", "audio"].map((t) => (
                <option key={t} value={t}>
                  {MODEL_TYPE_FORM_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="消耗积分" hint="支持小数；运行所需积分">
            <input value={pointCost} onChange={(e) => setPointCost(e.target.value)} placeholder="0.0" inputMode="decimal" />
          </Field>
          <Field label="成本价（USD）" hint="上游单次成本，仅后台参考，不对用户暴露">
            <input value={cfg.costUsd ?? ""} onChange={(e) => setC({ costUsd: e.target.value })} placeholder="0.0000" inputMode="decimal" />
          </Field>
          <Field label="图标" hint="emoji 或图片 URL">
            <input value={cfg.icon ?? ""} onChange={(e) => setC({ icon: e.target.value })} placeholder="emoji 或图片 URL" />
          </Field>
          <Field label="描述" hint="模型选择列表名称下的副标题（选填）">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="如：动漫高审美模型" />
          </Field>
          <Field label="预计耗时（秒）" hint="模型选择列表右侧耗时徽标（0=不显示）">
            <input
              value={String(cfg.estSeconds ?? 0)}
              onChange={(e) => setC({ estSeconds: Number(e.target.value) || 0 })}
              inputMode="numeric"
            />
          </Field>
        </FormGrid>
      </FormCard>

      {showGen && (
        <FormCard title="生成能力">
          <FormSection label="支持的生成方式" hint="不勾选 = 不限制（创作台显示全部模式）">
            <Chips
              options={modeOptions}
              value={cfg.modes ?? []}
              onChange={(next) => setC({ modes: next })}
            />
          </FormSection>

          {(cfg.modes ?? []).includes("i2i") && (
            <FormSection label="图生图参数">
              <FormGrid>
                <Field label="最大参考图数量" span={2} hint="图生图最多可上传的参考图张数">
                  <input
                    inputMode="numeric"
                    value={String(cfg.maxRefImages ?? 0)}
                    onChange={(e) => setC({ maxRefImages: Number(e.target.value) || 0 })}
                    placeholder="如：4"
                  />
                </Field>
                <Field label="单张参考图大小（MB）" span={2} hint="每张参考图的大小上限">
                  <input
                    inputMode="decimal"
                    value={String(cfg.maxRefImageSizeMB ?? 0)}
                    onChange={(e) => setC({ maxRefImageSizeMB: Number(e.target.value) || 0 })}
                    placeholder="如：10"
                  />
                </Field>
              </FormGrid>
            </FormSection>
          )}

          {isVideo && (cfg.modes ?? []).includes("i2v") && (
            <FormSection label="图生视频 · 参考图" hint="不设置则不限制">
              <RefPair label="参考图" countKey="i2v.imageCount" sizeKey="i2v.imageSizeMB" get={refGet} set={setRef} />
            </FormSection>
          )}

          {isVideo && (cfg.modes ?? []).includes("keyframe") && (
            <FormSection label="首尾帧 · 参考图" hint="不设置则不限制">
              <RefPair label="参考图" countKey="keyframe.imageCount" sizeKey="keyframe.imageSizeMB" get={refGet} set={setRef} />
            </FormSection>
          )}

          {isVideo && (cfg.modes ?? []).includes("omni_ref") && (
            <FormSection label="全能参考 · 素材限制" hint="图片 / 视频 / 音频各自限制，不设置则不限制">
              <RefPair label="参考图片" countKey="omniRef.imageCount" sizeKey="omniRef.imageSizeMB" get={refGet} set={setRef} />
              <RefPair label="参考视频" countKey="omniRef.videoCount" sizeKey="omniRef.videoSizeMB" get={refGet} set={setRef} />
              <RefPair label="参考音频" countKey="omniRef.audioCount" sizeKey="omniRef.audioSizeMB" get={refGet} set={setRef} />
            </FormSection>
          )}

          {isImage && (
            <FormSection label="支持画质">
              <Chips
                options={QUALITY_OPTIONS}
                value={cfg.qualities ?? []}
                onChange={(next) => setC({ qualities: next })}
              />
            </FormSection>
          )}

          {isVideo && (
            <FormSection label="支持时长">
              <Chips
                options={DURATION_OPTIONS.map((d) => ({ v: d, l: d }))}
                value={cfg.durations ?? []}
                onChange={(next) => setC({ durations: next })}
              />
            </FormSection>
          )}

          <FormSection label="支持清晰度">
            <Chips
              options={(RESOLUTION_OPTIONS[type] ?? []).map((r) => ({ v: r, l: r.toUpperCase() }))}
              value={cfg.resolutions ?? []}
              onChange={(next) => setC({ resolutions: next })}
            />
          </FormSection>

          <FormSection label="支持比例">
            <Chips
              options={RATIO_OPTIONS.map((r) => ({ v: r, l: RATIO_LABEL[r] ?? r }))}
              value={cfg.ratios ?? []}
              onChange={(next) => setC({ ratios: next })}
            />
          </FormSection>

          <FormSection label="生成数量" hint="创作台单次可生成的最大数量（1～4），默认 1">
            <Chips
              single
              options={[
                { v: "1", l: "1" },
                { v: "2", l: "2" },
                { v: "3", l: "3" },
                { v: "4", l: "4" },
              ]}
              value={[String(Math.max(1, ...(cfg.batchOptions?.length ? cfg.batchOptions : [1])))]}
              onChange={(next) => {
                const mx = Math.min(4, Math.max(1, parseInt(next[0] || "1", 10) || 1));
                setC({ batchOptions: Array.from({ length: mx }, (_, i) => i + 1) });
              }}
            />
          </FormSection>
        </FormCard>
      )}

      {showGen && (
        <FormCard title="提示词配置">
          <FormSection label="默认提示词" hint="创作台提示词框的默认内容；留空则用通用占位文案">
            <div className="fld">
              <textarea
                rows={3}
                value={cfg.defaultPrompt ?? ""}
                onChange={(e) => setC({ defaultPrompt: e.target.value })}
                placeholder="如：赛博朋克城市夜景，霓虹倒影，电影感，8K 超写实"
              />
            </div>
          </FormSection>

          <FormSection label="灵感提示词" hint="创作台「灵感提示词 · 点击填入」展示的列表；每行一条，留空则不显示该区">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(cfg.ideas ?? []).map((idea, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="fld" style={{ flex: 1 }}>
                    <input
                      value={idea}
                      onChange={(e) => setIdea(i, e.target.value)}
                      placeholder={`灵感提示词 ${i + 1}`}
                    />
                  </div>
                  <button type="button" className="adm-btn ghost" onClick={() => removeIdea(i)}>
                    删除
                  </button>
                </div>
              ))}
              <div>
                <button type="button" className="adm-btn ghost" onClick={addIdea}>
                  ＋ 添加灵感词
                </button>
              </div>
            </div>
          </FormSection>
        </FormCard>
      )}

      {showGen && (
        <FormCard title={isVideo ? "积分定价（时长 × 清晰度）" : "积分定价（画质 × 清晰度）"}>
          {matrixRows.length === 0 || matrixCols.length === 0 ? (
            <div className="fsec">
              <div className="hint">
                请先在上方选择{isVideo ? "时长" : "画质"}与清晰度，再设置分档积分。
              </div>
            </div>
          ) : (
            <div className="fsec">
              <div className="fmatrix">
                <table>
                  <thead>
                    <tr>
                      <th>{isVideo ? "时长 ＼ 清晰度" : "画质 ＼ 清晰度"}</th>
                      {matrixCols.map((col) => (
                        <th key={col}>{col.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        {matrixCols.map((col) => (
                          <td key={col}>
                            <input
                              placeholder="—"
                              inputMode="decimal"
                              value={cfg.priceMatrix?.[row.key]?.[col] ?? ""}
                              onChange={(e) => setCell(row.key, col, e.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="hint">不同档位可设不同积分；留空或 0 的格回退到上方「消耗积分」。</div>
            </div>
          )}
        </FormCard>
      )}

      {isText && (
        <FormCard title="文本能力">
          <FormSection
            label="AI 优化主模型"
            hint="全局唯一；创作台「AI 优化」按钮会调用设为主模型的文本模型"
          >
            <Chips
              single
              options={[
                { v: "yes", l: "设为主模型" },
                { v: "no", l: "否" },
              ]}
              value={[cfg.aiOptimizePrimary ? "yes" : "no"]}
              onChange={(next) => {
                const on = next[0] === "yes";
                if (on && aiPrimary && aiPrimary.id !== model?.id) {
                  toast.info(`已有 AI 优化主模型「${aiPrimary.name}」，请先解除后再选择`);
                  return;
                }
                setC({ aiOptimizePrimary: on });
              }}
            />
          </FormSection>

          <FormSection label="是否支持联网">
            <Chips
              single
              options={[
                { v: "yes", l: "支持" },
                { v: "no", l: "不支持" },
              ]}
              value={[cfg.webSearch ? "yes" : "no"]}
              onChange={(next) => setC({ webSearch: next[0] === "yes" })}
            />
          </FormSection>

          <FormSection label="是否支持文件上传">
            <Chips
              single
              options={[
                { v: "yes", l: "支持" },
                { v: "no", l: "不支持" },
              ]}
              value={[cfg.fileUpload ? "yes" : "no"]}
              onChange={(next) => setC({ fileUpload: next[0] === "yes" })}
            />
          </FormSection>

          {cfg.fileUpload && (
            <FormSection label="支持的文件大小（MB）" hint="单个上传文件的大小上限">
              <div className="fld" style={{ maxWidth: 220 }}>
                <input
                  inputMode="decimal"
                  value={String(cfg.maxFileSizeMB ?? 0)}
                  onChange={(e) => setC({ maxFileSizeMB: Number(e.target.value) || 0 })}
                  placeholder="如：20"
                />
              </div>
            </FormSection>
          )}
        </FormCard>
      )}

      <FormCard title="状态">
        <FormGrid>
          <Field label="上下架状态" span={2}>
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
