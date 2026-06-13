"use client";

import { useCallback, useEffect, useState } from "react";
import { Table, Modal, Input, InputNumber, Select, Button, Tag, Space, AutoComplete, Alert, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import type { AiProviderVO } from "@/types/admin";
import { QUALITY_OPTIONS, CLARITY_OPTIONS, RATIO_OPTIONS } from "@/components/canvas/nodes/quality-ratio-picker";
import { VIDEO_RATIOS, RESOLUTIONS, DURATION_OPTIONS } from "@/components/canvas/nodes/video-param-picker";

const { CheckableTag } = Tag;
const DURATION_CHOICES = Array.from({ length: 12 }, (_, i) => i + 4);

const HANDLER_CHOICES: Record<string, { value: string; label: string }[]> = {
  video: [
    { value: "text_to_video", label: "文生视频" },
    { value: "image_to_video", label: "图生视频" },
    { value: "start_end_to_video", label: "首尾帧" },
    { value: "reference_to_video", label: "全能参考/图片参考" },
  ],
  image: [
    { value: "text_to_image", label: "文生图" },
    { value: "image_to_image", label: "图生图" },
  ],
};

interface AdminAiModelVO {
  id: number;
  name: string;
  icon?: string;
  modelId: string;
  type: string;
  providerId?: number;
  providerName?: string;
  pointCost: number;
  costPerCall?: number;
  config?: string;
  supportedHandlers?: string[] | null;
  status: number;
  createTime?: string;
}

const MODEL_TYPES = [
  { value: "image", label: "图片生成" },
  { value: "video", label: "视频生成" },
  { value: "text", label: "文本生成" },
  { value: "audio", label: "语音合成" },
];
const TYPE_COLOR: Record<string, string> = { image: "purple", video: "blue", text: "gold", audio: "green" };

interface ModelForm {
  name: string; icon: string; modelId: string; type: string; providerId: string;
  pointCost: number; costPerCall: number; description: string; estSeconds: number;
  qualities: string[]; clarities: string[]; batchSizes: number[]; gridOutput: boolean;
  ratios: string[]; resolutions: string[]; durations: number[]; audio: boolean;
  videoInputs: boolean; supportedHandlers: string[];
  voices: { id: string; name: string }[];
  pricing: Record<string, Record<string, number>>;
}

const emptyForm: ModelForm = {
  name: "", icon: "", modelId: "", type: "image", providerId: "", pointCost: 0, costPerCall: 0,
  description: "", estSeconds: 0,
  qualities: QUALITY_OPTIONS.map((q) => q.value), clarities: [...CLARITY_OPTIONS], batchSizes: [1, 2, 4], gridOutput: false,
  ratios: RATIO_OPTIONS.map((r) => r.value), resolutions: [...RESOLUTIONS], durations: [...DURATION_OPTIONS],
  audio: true, videoInputs: false, supportedHandlers: [], voices: [], pricing: {},
};

/** 多选标签组（画质/清晰度/比例/生成方式/张数/时长 等） */
function TagGroup({ label, hint, options, selected, onToggle }: {
  label: string; hint?: string; options: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div style={{ fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <Space wrap size={[6, 6]}>
        {options.map((o) => (
          <CheckableTag key={o.value} checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}>
            {o.label}
          </CheckableTag>
        ))}
      </Space>
      {hint && <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** 差异化定价矩阵（行维度 × 列维度） */
function PricingMatrix({ corner, rows, cols, pricing, onSet }: {
  corner: string; rows: { key: string; label: string }[]; cols: { key: string; label: string }[];
  pricing: Record<string, Record<string, number>>; onSet: (row: string, col: string, val: number | null) => void;
}) {
  return (
    <div>
      <div style={{ fontWeight: 500 }}>积分定价（{corner.replace("＼", " × ")}）</div>
      <div style={{ fontSize: 12, color: "#bfbfbf", margin: "2px 0 8px" }}>不同档位可设不同积分；留空或 0 的格回退到上方「消耗积分」。</div>
      {rows.length === 0 || cols.length === 0 ? (
        <div style={{ fontSize: 12, color: "#bfbfbf" }}>请先选择上方的两个维度</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, display: "inline-block" }}>
          <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--ant-color-fill-quaternary, #fafafa)" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", color: "#bfbfbf", fontWeight: 500 }}>{corner}</th>
                {cols.map((c) => <th key={c.key} style={{ padding: "8px 12px", textAlign: "center", fontWeight: 500 }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderTop: "1px solid var(--ant-color-border-secondary, #f0f0f0)" }}>
                  <td style={{ padding: "6px 12px", fontWeight: 500, whiteSpace: "nowrap" }}>{r.label}</td>
                  {cols.map((c) => (
                    <td key={c.key} style={{ padding: 6 }}>
                      <InputNumber size="small" min={0} step={0.1} controls={false} style={{ width: 64 }} placeholder="—"
                        value={pricing[r.key]?.[c.key] ?? null} onChange={(v) => onSet(r.key, c.key, v)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminAiModelsPage() {
  const [models, setModels] = useState<AdminAiModelVO[]>([]);
  const [providers, setProviders] = useState<AiProviderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState("");
  const [remoteSearch, setRemoteSearch] = useState("");

  const loadModels = useCallback(async () => {
    try {
      const res = await adminApi.ai.models.list();
      if (res.success) setModels(res.data as unknown as AdminAiModelVO[]);
    } finally {
      setLoading(false);
    }
  }, []);
  const loadProviders = useCallback(async () => {
    try { const res = await adminApi.ai.providers.list(); if (res.success) setProviders(res.data); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadModels(); void loadProviders(); }, [loadModels, loadProviders]);

  const buildConfig = (): string => {
    const pricing = Object.keys(form.pricing).length ? { pricing: form.pricing } : {};
    const meta = { ...(form.description.trim() ? { description: form.description.trim() } : {}), ...(form.estSeconds > 0 ? { estSeconds: form.estSeconds } : {}) };
    if (form.type === "image") return JSON.stringify({ qualities: form.qualities, clarities: form.clarities, ratios: form.ratios, batchSizes: form.batchSizes, ...(form.gridOutput ? { gridOutput: true } : {}), ...pricing, ...meta });
    if (form.type === "video") return JSON.stringify({ resolutions: form.resolutions, ratios: form.ratios, durations: form.durations, audio: form.audio, ...(form.videoInputs ? { videoInputs: true } : {}), ...pricing, ...meta });
    if (form.type === "audio") return JSON.stringify({ voices: form.voices.filter((v) => v.id.trim()).map((v) => ({ id: v.id.trim(), name: v.name.trim() || v.id.trim() })), ...meta });
    return JSON.stringify({ ...meta });
  };

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setRemoteModels([]); setFetchModelsError(""); setFormOpen(true); };

  const startEdit = (model: AdminAiModelVO) => {
    let cfg: Record<string, unknown> = {};
    if (model.config) { try { cfg = JSON.parse(model.config); } catch { cfg = {}; } }
    const c = cfg as { qualities?: string[]; clarities?: string[]; ratios?: string[]; batchSizes?: number[]; gridOutput?: boolean; resolutions?: string[]; durations?: number[]; audio?: boolean; videoInputs?: boolean; voices?: { id: string; name: string }[]; pricing?: Record<string, Record<string, number>>; description?: string; estSeconds?: number };
    setEditingId(model.id);
    setForm({
      name: model.name, icon: model.icon ?? "", modelId: model.modelId, type: model.type,
      providerId: model.providerId == null ? "" : String(model.providerId),
      pointCost: model.pointCost ?? 0, costPerCall: model.costPerCall ?? 0,
      description: c.description ?? "", estSeconds: c.estSeconds ?? 0,
      qualities: c.qualities ?? QUALITY_OPTIONS.map((q) => q.value), clarities: c.clarities ?? [...CLARITY_OPTIONS],
      batchSizes: c.batchSizes ?? [1, 2, 4], gridOutput: c.gridOutput ?? false,
      ratios: c.ratios ?? (model.type === "video" ? VIDEO_RATIOS.map((r) => r.value) : RATIO_OPTIONS.map((r) => r.value)),
      resolutions: c.resolutions ?? [...RESOLUTIONS], durations: c.durations ?? [...DURATION_OPTIONS],
      audio: c.audio ?? true, videoInputs: c.videoInputs ?? false,
      supportedHandlers: model.supportedHandlers ?? [], voices: c.voices ?? [], pricing: c.pricing ?? {},
    });
    setRemoteModels([]); setFetchModelsError(""); setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.modelId) { toast.error("请填写名称和模型ID"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name, icon: form.icon, modelId: form.modelId, type: form.type,
        pointCost: form.pointCost, costPerCall: form.costPerCall, config: buildConfig(),
        supportedHandlers: form.supportedHandlers, ...(form.providerId !== "" ? { providerId: form.providerId } : {}),
      };
      const res = editingId ? await adminApi.ai.models.update(editingId, payload) : await adminApi.ai.models.create(payload);
      if (res.success) { toast.success("已保存"); setFormOpen(false); setEditingId(null); setForm(emptyForm); loadModels(); }
      else toast.error(res.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleFetchRemoteModels = async () => {
    if (!form.providerId) return;
    const isRunware = providers.find((p) => String(p.id) === form.providerId)?.providerType === "runware";
    if (isRunware && !remoteSearch.trim()) { setFetchModelsError("Runware 需要输入搜索关键词再拉取，如 flux / kling / seedream"); return; }
    setFetchingModels(true); setFetchModelsError("");
    try {
      const res = await adminApi.ai.providers.remoteModels(form.providerId, remoteSearch.trim() || undefined);
      if (res.success) { setRemoteModels(res.data ?? []); if (!res.data || res.data.length === 0) setFetchModelsError("该供应商未返回模型"); }
      else { setRemoteModels([]); setFetchModelsError(res.message || "拉取失败"); }
    } catch {
      setRemoteModels([]); setFetchModelsError("拉取失败");
    } finally {
      setFetchingModels(false);
    }
  };

  const handleDelete = async (id: number) => { const res = await adminApi.ai.models.delete(id); if (res.success) loadModels(); };
  const handleToggleStatus = async (m: AdminAiModelVO) => { await adminApi.ai.models.update(m.id, { status: m.status === 1 ? 0 : 1 }); loadModels(); };

  const toggleArr = (field: "qualities" | "clarities" | "ratios" | "resolutions" | "supportedHandlers", val: string) =>
    setForm((prev) => { const arr = prev[field]; return { ...prev, [field]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] }; });
  const toggleDuration = (d: number) => setForm((prev) => ({ ...prev, durations: prev.durations.includes(d) ? prev.durations.filter((x) => x !== d) : [...prev.durations, d].sort((a, b) => a - b) }));
  const toggleBatchSize = (n: number) => setForm((prev) => ({ ...prev, batchSizes: prev.batchSizes.includes(n) ? prev.batchSizes.filter((x) => x !== n) : [...prev.batchSizes, n].sort((a, b) => a - b) }));
  const handleTypeChange = (type: string) => setForm((prev) => ({ ...prev, type, ratios: type === "video" ? VIDEO_RATIOS.map((r) => r.value) : RATIO_OPTIONS.map((r) => r.value), pricing: {} }));
  const setPricing = (row: string, col: string, val: number | null) => setForm((prev) => {
    const pricing = { ...prev.pricing }; const r = { ...(pricing[row] ?? {}) };
    if (val == null || !Number.isFinite(val) || val <= 0) delete r[col]; else r[col] = val;
    if (Object.keys(r).length === 0) delete pricing[row]; else pricing[row] = r;
    return { ...prev, pricing };
  });

  const filteredModels = searchKeyword
    ? models.filter((m) => m.name.toLowerCase().includes(searchKeyword.toLowerCase()) || m.modelId.toLowerCase().includes(searchKeyword.toLowerCase()))
    : models;

  const isRunwareProvider = providers.find((p) => String(p.id) === form.providerId)?.providerType === "runware";

  const columns: ColumnsType<AdminAiModelVO> = [
    { title: "名称", dataIndex: "name", key: "name", render: (v, m) => <Space>{m.icon && /^https?:/.test(m.icon) ? null : m.icon ? <span>{m.icon}</span> : null}<span style={{ fontWeight: 500 }}>{v}</span></Space> },
    { title: "模型ID", dataIndex: "modelId", key: "modelId", responsive: ["md"], render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{v}</span> },
    { title: "类型", dataIndex: "type", key: "type", render: (t: string) => <Tag color={TYPE_COLOR[t] || "default"}>{MODEL_TYPES.find((x) => x.value === t)?.label || t}</Tag> },
    { title: "供应商", dataIndex: "providerName", key: "providerName", responsive: ["lg"], render: (v) => v || "-" },
    { title: "消耗积分", dataIndex: "pointCost", key: "pointCost", render: (v) => <span style={{ color: "#d97706", fontWeight: 500 }}>{v}</span> },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => s === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag> },
    {
      title: "操作", key: "action", render: (_, m) => (
        <Space size={0}>
          <Button type="text" size="small" onClick={() => handleToggleStatus(m)} style={{ color: m.status === 1 ? "#ef4444" : "#16a34a" }}>{m.status === 1 ? "禁用" : "启用"}</Button>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => startEdit(m)}>编辑</Button>
          <Popconfirm title={`删除模型「${m.name}」？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(m.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="模型管理" desc={`共 ${models.length} 个模型`} extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增模型</Button>} />

      <Input.Search placeholder="搜索模型名称、模型ID..." allowClear style={{ maxWidth: 360 }} value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} />

      <Table<AdminAiModelVO>
        rowKey="id" columns={columns} dataSource={filteredModels} loading={loading}
        scroll={{ x: "max-content" }} locale={{ emptyText: "暂无模型数据，点击右上角添加" }}
        pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title={editingId ? "编辑模型" : "新增模型"} open={formOpen} onCancel={() => setFormOpen(false)}
        onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={760}
        styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
          {/* 基础字段 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="名称 *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：DALL-E 3" /></Field>
            <Field label="模型ID *">
              <AutoComplete style={{ width: "100%" }} value={form.modelId} onChange={(v) => setForm({ ...form, modelId: v })}
                options={remoteModels.map((m) => ({ value: m }))} placeholder="如：dall-e-3" filterOption={(i, o) => (o?.value ?? "").toLowerCase().includes(i.toLowerCase())} />
            </Field>
            <Field label="类型"><Select style={{ width: "100%" }} value={form.type} onChange={handleTypeChange} options={MODEL_TYPES} /></Field>
            <Field label="供应商">
              <Select style={{ width: "100%" }} value={form.providerId || undefined} onChange={(v) => setForm({ ...form, providerId: v ?? "" })} placeholder="请选择供应商" allowClear
                options={providers.map((p) => ({ value: String(p.id), label: p.name }))} />
            </Field>
            <Field label="消耗积分" hint="支持小数；按「单价×张数×团队系数」总价向上取整"><InputNumber style={{ width: "100%" }} min={0} step={0.1} value={form.pointCost} onChange={(v) => setForm({ ...form, pointCost: v ?? 0 })} /></Field>
            <Field label="成本价（USD）" hint="上游单次成本，仅后台参考毛利，不计费、不对用户暴露"><InputNumber style={{ width: "100%" }} min={0} step={0.0001} value={form.costPerCall} onChange={(v) => setForm({ ...form, costPerCall: v ?? 0 })} /></Field>
            <Field label="图标" hint="显示在「Lib Image」模型选择处"><Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="emoji 或图片 URL" /></Field>
            <Field label="描述" hint="模型选择列表名称下的副标题（选填）"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="如：动漫高审美模型" /></Field>
            <Field label="预计耗时（秒）" hint="模型选择列表右侧耗时徽标（0=不显示）"><InputNumber style={{ width: "100%" }} min={0} value={form.estSeconds} onChange={(v) => setForm({ ...form, estSeconds: v ?? 0 })} /></Field>
          </div>

          {/* 从供应商拉取模型 */}
          {form.providerId && (
            <Space wrap>
              {isRunwareProvider && <Input size="small" style={{ width: 160 }} value={remoteSearch} onChange={(e) => setRemoteSearch(e.target.value)} placeholder="搜索关键词，如 flux" />}
              <Button size="small" loading={fetchingModels} onClick={handleFetchRemoteModels}>从该供应商拉取模型</Button>
              {fetchModelsError && <span style={{ fontSize: 12, color: "#ef4444" }}>{fetchModelsError}</span>}
              {remoteModels.length > 0 && <span style={{ fontSize: 12, color: "#16a34a" }}>已拉取 {remoteModels.length} 个，可在「模型ID」中选择</span>}
            </Space>
          )}

          {/* 按类型的维度配置 */}
          {form.type !== "text" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: "1px solid var(--ant-color-border-secondary, #f0f0f0)", paddingTop: 16 }}>
              {form.type === "image" && (
                <>
                  <TagGroup label="支持的生成方式" hint="不勾选 = 不限制（画布显示全部模式）" options={HANDLER_CHOICES.image} selected={form.supportedHandlers} onToggle={(v) => toggleArr("supportedHandlers", v)} />
                  <TagGroup label="出图张数档位" hint="Midjourney 等固定 4 张只勾「4张」，不勾用默认(1/2/4)" options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}张` }))} selected={form.batchSizes.map(String)} onToggle={(v) => toggleBatchSize(Number(v))} />
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: 8 }}>上游四宫格输出</div>
                    <Space>
                      <CheckableTag checked={form.gridOutput} onChange={() => setForm({ ...form, gridOutput: true })} style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}>是（单张 2×2 合图）</CheckableTag>
                      <CheckableTag checked={!form.gridOutput} onChange={() => setForm({ ...form, gridOutput: false })} style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}>否（独立多张）</CheckableTag>
                    </Space>
                    <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 4 }}>Midjourney 原生输出为一张 2×2 合图时选「是」，生成后自动切成 4 张组图</div>
                  </div>
                  <TagGroup label="支持画质" options={QUALITY_OPTIONS.map((q) => ({ value: q.value, label: q.label }))} selected={form.qualities} onToggle={(v) => toggleArr("qualities", v)} />
                  <TagGroup label="支持清晰度" options={CLARITY_OPTIONS.map((c) => ({ value: c, label: c }))} selected={form.clarities} onToggle={(v) => toggleArr("clarities", v)} />
                  <TagGroup label="支持比例" options={RATIO_OPTIONS.map((r) => ({ value: r.value, label: r.label }))} selected={form.ratios} onToggle={(v) => toggleArr("ratios", v)} />
                  <PricingMatrix corner="画质＼清晰度" rows={form.qualities.map((q) => ({ key: q, label: QUALITY_OPTIONS.find((o) => o.value === q)?.label ?? q }))} cols={form.clarities.map((c) => ({ key: c, label: c }))} pricing={form.pricing} onSet={setPricing} />
                </>
              )}
              {form.type === "video" && (
                <>
                  <TagGroup label="支持的生成方式" hint="不勾选 = 不限制；勾选后画布视频节点只显示所选模式 Tab" options={HANDLER_CHOICES.video} selected={form.supportedHandlers} onToggle={(v) => toggleArr("supportedHandlers", v)} />
                  <TagGroup label="支持清晰度" options={RESOLUTIONS.map((r) => ({ value: r, label: r }))} selected={form.resolutions} onToggle={(v) => toggleArr("resolutions", v)} />
                  <TagGroup label="支持比例" options={VIDEO_RATIOS.map((r) => ({ value: r.value, label: r.label }))} selected={form.ratios} onToggle={(v) => toggleArr("ratios", v)} />
                  <TagGroup label="支持时长（秒）" options={DURATION_CHOICES.map((d) => ({ value: String(d), label: `${d}s` }))} selected={form.durations.map(String)} onToggle={(v) => toggleDuration(Number(v))} />
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: 8 }}>生成音频</div>
                    <Space>
                      <CheckableTag checked={form.audio} onChange={() => setForm({ ...form, audio: true })} style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}>支持</CheckableTag>
                      <CheckableTag checked={!form.audio} onChange={() => setForm({ ...form, audio: false })} style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}>不支持</CheckableTag>
                    </Space>
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: 8 }}>Runware 参数结构</div>
                    <Space>
                      <CheckableTag checked={form.videoInputs} onChange={() => setForm({ ...form, videoInputs: true })} style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}>v2（inputs 嵌套）</CheckableTag>
                      <CheckableTag checked={!form.videoInputs} onChange={() => setForm({ ...form, videoInputs: false })} style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}>旧版（顶层平铺）</CheckableTag>
                    </Space>
                    <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 4 }}>Runware 新版视频模型（Seedance 2.0 等）须选 v2；非 Runware 或旧版保持「顶层平铺」</div>
                  </div>
                  <PricingMatrix corner="清晰度＼时长" rows={form.resolutions.map((r) => ({ key: r, label: r }))} cols={[...form.durations].sort((a, b) => a - b).map((d) => ({ key: String(d), label: `${d}s` }))} pricing={form.pricing} onSet={setPricing} />
                </>
              )}
              {form.type === "audio" && (
                <div>
                  <div style={{ fontWeight: 500 }}>音色列表</div>
                  <div style={{ fontSize: 12, color: "#bfbfbf", margin: "2px 0 8px" }}>音色ID 来自供应商文档；显示名是画布音频节点下拉里的名字</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {form.voices.map((v, i) => (
                      <Space key={i}>
                        <Input style={{ width: 220, fontFamily: "monospace", fontSize: 12 }} placeholder="音色ID（上游标识）" value={v.id} onChange={(e) => setForm((p) => ({ ...p, voices: p.voices.map((x, j) => j === i ? { ...x, id: e.target.value } : x) }))} />
                        <Input style={{ width: 180 }} placeholder="显示名（如：少女音色）" value={v.name} onChange={(e) => setForm((p) => ({ ...p, voices: p.voices.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} />
                        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setForm((p) => ({ ...p, voices: p.voices.filter((_, j) => j !== i) }))} />
                      </Space>
                    ))}
                  </div>
                  <Button size="small" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => setForm((p) => ({ ...p, voices: [...p.voices, { id: "", name: "" }] }))}>添加音色</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#bfbfbf", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
