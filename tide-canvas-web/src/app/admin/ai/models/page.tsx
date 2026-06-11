"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { AiProviderVO } from "@/types/admin";
import {
  Plus,
  Trash2,
  Edit,
  Save,
  Cpu,
  Search,
  Coins,
} from "lucide-react";
import { QUALITY_OPTIONS, CLARITY_OPTIONS, RATIO_OPTIONS } from "@/components/canvas/nodes/quality-ratio-picker";
import { VIDEO_RATIOS, RESOLUTIONS, DURATION_OPTIONS } from "@/components/canvas/nodes/video-param-picker";

// 视频模型可勾选的时长档位池（秒，4~15）；模型勾选后驱动画布视频节点的「视频时长」选项与计费
const DURATION_CHOICES = Array.from({ length: 12 }, (_, i) => i + 4);

interface AdminAiModelVO {
  id: number;
  name: string;
  icon?: string;
  modelId: string;
  type: string;
  providerId?: number;
  providerName?: string;
  /** 消耗积分（支持小数，结算按总价向上取整） */
  pointCost: number;
  /** 上游成本价（USD，仅管理端参考） */
  costPerCall?: number;
  config?: string;
  status: number;
  createTime?: string;
}

const MODEL_TYPES = [
  { value: "image", label: "图片生成" },
  { value: "video", label: "视频生成" },
  { value: "text", label: "文本生成" },
  { value: "audio", label: "语音合成" },
];

const TYPE_BADGE: Record<string, string> = {
  image: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  video: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  text: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  audio: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
};

interface ModelForm {
  name: string;
  icon: string;
  modelId: string;
  type: string;
  // 供应商 id 为雪花长整型、后端以字符串返回，前端全程按字符串处理，避免 Number() 精度丢失
  providerId: string;
  pointCost: number;
  // 上游成本价（USD）：Runware 等供应商响应里的 cost 可直接抄录于此，仅作毛利参考，不参与计费
  costPerCall: number;
  // 模型选择列表展示用：描述（名称下方副标题）+ 预计耗时（秒，右侧徽标）。存入 config，无需后端改动
  description: string;
  estSeconds: number;
  // 图片维度
  qualities: string[];
  clarities: string[];
  // 比例：图片/视频共用此字段，渲染时按 type 用不同选项源（RATIO_OPTIONS / VIDEO_RATIOS）
  ratios: string[];
  // 视频维度
  resolutions: string[];
  durations: number[];
  audio: boolean;
  // Runware 视频参数结构：v2(Seedance 2.0 等) 需把 frameImages/referenceImages 嵌进 inputs 对象
  videoInputs: boolean;
  // 语音模型音色列表（每个供应商每个模型各不相同）：id 为上游音色标识，name 为画布下拉显示名
  voices: { id: string; name: string }[];
  // 差异化定价矩阵：图片 = pricing[quality][clarity]；视频 = pricing[resolution][duration]
  pricing: Record<string, Record<string, number>>;
}

const emptyForm: ModelForm = {
  name: "",
  icon: "",
  modelId: "",
  type: "image",
  providerId: "",
  pointCost: 0,
  costPerCall: 0,
  description: "",
  estSeconds: 0,
  qualities: QUALITY_OPTIONS.map((q) => q.value),
  clarities: [...CLARITY_OPTIONS],
  ratios: RATIO_OPTIONS.map((r) => r.value),
  resolutions: [...RESOLUTIONS],
  durations: [...DURATION_OPTIONS],
  audio: true,
  videoInputs: false,
  voices: [],
  pricing: {},
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
      }`}
    >
      {children}
    </button>
  );
}

/** 一组多选 Chip（支持画质 / 清晰度 / 比例 / …） */
function ChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o.value} active={selected.includes(o.value)} onClick={() => onToggle(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** 差异化定价矩阵（行维度 × 列维度）；行列 key 即下发 input 的原值，须与计费端一致 */
function PricingMatrix({
  corner,
  rows,
  cols,
  pricing,
  onSet,
}: {
  corner: string;
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  pricing: Record<string, Record<string, number>>;
  onSet: (row: string, col: string, val: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">积分定价（{corner.replace("＼", " × ")}）</label>
      <p className="mt-0.5 text-xs text-neutral-400">不同档位可设不同积分；留空或 0 的格回退到上方「消耗积分」。</p>
      {rows.length === 0 || cols.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-400">请先选择上方的两个维度</p>
      ) : (
        <div className="mt-2 inline-block overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
          <table className="text-xs">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-900">
                <th className="px-3 py-2 text-left font-medium text-neutral-400">{corner}</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-center font-medium">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium">{r.label}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="px-1.5 py-1.5">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={pricing[r.key]?.[c.key] ?? ""}
                        onChange={(e) => onSet(r.key, c.key, e.target.value)}
                        placeholder="—"
                        className="w-16 rounded-md border border-neutral-200 px-2 py-1 text-center outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                      />
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
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  // 从供应商接口拉取到的模型 ID 列表（供「模型ID」输入框自动补全）
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState("");
  // Runware 模型搜索关键词（modelSearch 协议按关键词检索 AIR 标识）
  const [remoteSearch, setRemoteSearch] = useState("");

  // setState 均在 await 之后；loading 初值即 true，不在同步路径置位
  const loadModels = useCallback(async () => {
    try {
      const res = await adminApi.ai.models.list();
      if (res.success) {
        setModels(res.data as unknown as AdminAiModelVO[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const res = await adminApi.ai.providers.list();
      if (res.success) setProviders(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadModels();
    // loadProviders 与 loadModels 同构，setState 均在 await 之后，规则对二者判定不一致，此处豁免
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProviders();
  }, [loadModels, loadProviders]);

  // 按模型类型序列化 config：图片存 qualities/clarities/ratios，视频存 resolutions/ratios/durations/audio
  const buildConfig = (): string => {
    const pricing = Object.keys(form.pricing).length ? { pricing: form.pricing } : {};
    // description / estSeconds 仅供模型选择列表展示，随 config 持久化（后端透传，不需改 schema）
    const meta = {
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.estSeconds > 0 ? { estSeconds: form.estSeconds } : {}),
    };
    if (form.type === "image") {
      return JSON.stringify({ qualities: form.qualities, clarities: form.clarities, ratios: form.ratios, ...pricing, ...meta });
    }
    if (form.type === "video") {
      return JSON.stringify({ resolutions: form.resolutions, ratios: form.ratios, durations: form.durations, audio: form.audio, ...(form.videoInputs ? { videoInputs: true } : {}), ...pricing, ...meta });
    }
    if (form.type === "audio") {
      const voices = form.voices.filter((v) => v.id.trim()).map((v) => ({ id: v.id.trim(), name: v.name.trim() || v.id.trim() }));
      return JSON.stringify({ voices, ...meta });
    }
    return JSON.stringify({ ...meta });
  };

  const handleSave = async () => {
    if (!form.name || !form.modelId) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        icon: form.icon,
        modelId: form.modelId,
        type: form.type,
        pointCost: form.pointCost,
        costPerCall: form.costPerCall,
        config: buildConfig(),
        ...(form.providerId !== "" ? { providerId: form.providerId } : {}),
      };

      if (editingId) {
        const res = await adminApi.ai.models.update(editingId, payload);
        if (res.success) {
          setEditingId(null);
          setForm(emptyForm);
          loadModels();
        }
      } else {
        const res = await adminApi.ai.models.create(payload);
        if (res.success) {
          setShowForm(false);
          setForm(emptyForm);
          loadModels();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleFetchRemoteModels = async () => {
    if (!form.providerId) return;
    // Runware 的 modelSearch 协议要求必填搜索词（按关键词检索 AIR 模型标识）
    const isRunware = providers.find((p) => String(p.id) === form.providerId)?.providerType === "runware";
    if (isRunware && !remoteSearch.trim()) {
      setFetchModelsError("Runware 需要输入搜索关键词再拉取，如 flux / kling / seedream");
      return;
    }
    setFetchingModels(true);
    setFetchModelsError("");
    try {
      const res = await adminApi.ai.providers.remoteModels(form.providerId, remoteSearch.trim() || undefined);
      if (res.success) {
        setRemoteModels(res.data ?? []);
        if (!res.data || res.data.length === 0) {
          setFetchModelsError("该供应商未返回模型");
        }
      } else {
        setRemoteModels([]);
        setFetchModelsError(res.message || "拉取失败");
      }
    } catch {
      setRemoteModels([]);
      setFetchModelsError("拉取失败");
    } finally {
      setFetchingModels(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除模型「${name}」？此操作不可撤销。`)) return;
    const res = await adminApi.ai.models.delete(id);
    if (res.success) loadModels();
  };

  const handleToggleStatus = async (model: AdminAiModelVO) => {
    await adminApi.ai.models.update(model.id, { status: model.status === 1 ? 0 : 1 });
    loadModels();
  };

  const toggleArr = (field: "qualities" | "clarities" | "ratios" | "resolutions", val: string) => {
    setForm((prev) => {
      const arr = prev[field];
      return { ...prev, [field]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });
  };

  const toggleDuration = (d: number) => {
    setForm((prev) => ({
      ...prev,
      durations: prev.durations.includes(d) ? prev.durations.filter((x) => x !== d) : [...prev.durations, d].sort((a, b) => a - b),
    }));
  };

  // 切换类型：比例字段重置为该类型默认选项，并清空定价矩阵（维度变了，旧 key 不再匹配）
  const handleTypeChange = (type: string) => {
    setForm((prev) => ({
      ...prev,
      type,
      ratios: type === "video" ? VIDEO_RATIOS.map((r) => r.value) : RATIO_OPTIONS.map((r) => r.value),
      pricing: {},
    }));
  };

  // 设置某「行×列」格的积分；空或 ≤0 则删除该格（回退到固定 pointCost）
  const setPricing = (row: string, col: string, val: string) => {
    setForm((prev) => {
      const n = Number(val);
      const pricing = { ...prev.pricing };
      const r = { ...(pricing[row] ?? {}) };
      if (val === "" || !Number.isFinite(n) || n <= 0) {
        delete r[col];
      } else {
        r[col] = n;
      }
      if (Object.keys(r).length === 0) {
        delete pricing[row];
      } else {
        pricing[row] = r;
      }
      return { ...prev, pricing };
    });
  };

  const startEdit = (model: AdminAiModelVO) => {
    setEditingId(model.id);
    setShowForm(false);
    let cfg: {
      qualities?: string[];
      clarities?: string[];
      ratios?: string[];
      resolutions?: string[];
      durations?: number[];
      audio?: boolean;
      videoInputs?: boolean;
      voices?: { id: string; name: string }[];
      pricing?: Record<string, Record<string, number>>;
      description?: string;
      estSeconds?: number;
    } = {};
    if (model.config) {
      try {
        cfg = JSON.parse(model.config);
      } catch {
        cfg = {};
      }
    }
    setForm({
      name: model.name,
      icon: model.icon ?? "",
      modelId: model.modelId,
      type: model.type,
      providerId: model.providerId == null ? "" : String(model.providerId),
      pointCost: model.pointCost ?? 0,
      costPerCall: model.costPerCall ?? 0,
      description: cfg.description ?? "",
      estSeconds: cfg.estSeconds ?? 0,
      qualities: cfg.qualities ?? QUALITY_OPTIONS.map((q) => q.value),
      clarities: cfg.clarities ?? [...CLARITY_OPTIONS],
      ratios: cfg.ratios ?? (model.type === "video" ? VIDEO_RATIOS.map((r) => r.value) : RATIO_OPTIONS.map((r) => r.value)),
      resolutions: cfg.resolutions ?? [...RESOLUTIONS],
      durations: cfg.durations ?? [...DURATION_OPTIONS],
      audio: cfg.audio ?? true,
      videoInputs: cfg.videoInputs ?? false,
      voices: cfg.voices ?? [],
      pricing: cfg.pricing ?? {},
    });
  };

  const isFormOpen = showForm || editingId !== null;

  const filteredModels = searchKeyword
    ? models.filter(
        (m) =>
          m.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
          m.modelId.toLowerCase().includes(searchKeyword.toLowerCase())
      )
    : models;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">模型管理</h2>
          <p className="mt-1 text-sm text-neutral-500">
            共 {models.length} 个模型
          </p>
        </div>
        {!isFormOpen && (
          <button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setForm(emptyForm);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" /> 新增模型
          </button>
        )}
      </div>

      {/* 搜索栏 */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索模型名称、模型ID..."
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      </div>

      {/* 新增/编辑表单 */}
      {isFormOpen && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 className="font-semibold">{editingId ? "编辑模型" : "新增模型"}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-sm font-medium">名称 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：DALL-E 3"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">模型ID *</label>
              <input
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                placeholder="如：dall-e-3"
                list="remote-model-ids"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              />
              {remoteModels.length > 0 && (
                <datalist id="remote-model-ids">
                  {remoteModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium">类型</label>
              <select
                value={form.type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {MODEL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">供应商</label>
              <select
                value={form.providerId}
                onChange={(e) => setForm({ ...form, providerId: e.target.value })}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="">请选择供应商</option>
                {providers.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 flex items-center gap-1.5">
                {providers.find((p) => String(p.id) === form.providerId)?.providerType === "runware" && (
                  <input
                    value={remoteSearch}
                    onChange={(e) => setRemoteSearch(e.target.value)}
                    placeholder="搜索关键词，如 flux"
                    className="w-32 rounded-lg border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                )}
                <button
                  type="button"
                  onClick={handleFetchRemoteModels}
                  disabled={!form.providerId || fetchingModels}
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  {fetchingModels ? "拉取中..." : "从该供应商拉取模型"}
                </button>
              </div>
              {fetchModelsError && <p className="mt-1 text-xs text-red-500">{fetchModelsError}</p>}
              {remoteModels.length > 0 && (
                <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                  已拉取 {remoteModels.length} 个模型，可在「模型ID」输入框中选择
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium">消耗积分</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={form.pointCost}
                onChange={(e) => setForm({ ...form, pointCost: Number(e.target.value) })}
                placeholder="每次调用消耗积分数（支持小数）"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <p className="mt-1 text-xs text-neutral-400">支持小数；结算按「单价×张数×团队系数」总价向上取整</p>
            </div>
            <div>
              <label className="block text-sm font-medium">成本价（USD）</label>
              <input
                type="number"
                min={0}
                step={0.0001}
                value={form.costPerCall}
                onChange={(e) => setForm({ ...form, costPerCall: Number(e.target.value) })}
                placeholder="如 Runware 返回的 cost：0.0013"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <p className="mt-1 text-xs text-neutral-400">上游单次成本，仅后台参考毛利用，不参与计费、不对用户暴露</p>
            </div>
            <div>
              <label className="block text-sm font-medium">图标</label>
              <input
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="emoji 或图片 URL"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <p className="mt-1 text-xs text-neutral-400">显示在「Lib Image」模型选择处</p>
            </div>
            <div>
              <label className="block text-sm font-medium">描述</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="如：动漫高审美模型，风格多样"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <p className="mt-1 text-xs text-neutral-400">模型选择列表中名称下方的副标题（选填）</p>
            </div>
            <div>
              <label className="block text-sm font-medium">预计耗时（秒）</label>
              <input
                type="number"
                min={0}
                value={form.estSeconds}
                onChange={(e) => setForm({ ...form, estSeconds: Number(e.target.value) })}
                placeholder="如：60"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <p className="mt-1 text-xs text-neutral-400">模型选择列表右侧的耗时徽标（0 = 不显示）</p>
            </div>
          </div>

          {/* 支持的格式：按模型类型显示对应维度（文本类型无格式配置） */}
          {form.type !== "text" && (
            <div className="mt-5 space-y-4 border-t border-neutral-100 pt-5 dark:border-neutral-800">
              {form.type === "image" ? (
                <>
                  <ChipGroup
                    label="支持画质"
                    options={QUALITY_OPTIONS.map((q) => ({ value: q.value, label: q.label }))}
                    selected={form.qualities}
                    onToggle={(v) => toggleArr("qualities", v)}
                  />
                  <ChipGroup
                    label="支持清晰度"
                    options={CLARITY_OPTIONS.map((c) => ({ value: c, label: c }))}
                    selected={form.clarities}
                    onToggle={(v) => toggleArr("clarities", v)}
                  />
                  <ChipGroup
                    label="支持比例"
                    options={RATIO_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                    selected={form.ratios}
                    onToggle={(v) => toggleArr("ratios", v)}
                  />
                  <PricingMatrix
                    corner="画质＼清晰度"
                    rows={form.qualities.map((q) => ({ key: q, label: QUALITY_OPTIONS.find((o) => o.value === q)?.label ?? q }))}
                    cols={form.clarities.map((c) => ({ key: c, label: c }))}
                    pricing={form.pricing}
                    onSet={setPricing}
                  />
                </>
              ) : form.type === "audio" ? (
                <div>
                  <label className="block text-sm font-medium">音色列表</label>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    音色ID 来自该模型供应商的文档（如 MiniMax 的 Chinese (Mandarin)_Lovely_Girl）；显示名是画布音频节点下拉里看到的名字
                  </p>
                  <div className="mt-2 space-y-2">
                    {form.voices.map((v, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={v.id}
                          onChange={(e) => setForm((prev) => ({ ...prev, voices: prev.voices.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) }))}
                          placeholder="音色ID（上游标识）"
                          className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                        />
                        <input
                          value={v.name}
                          onChange={(e) => setForm((prev) => ({ ...prev, voices: prev.voices.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                          placeholder="显示名（如：少女音色）"
                          className="w-48 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                        />
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, voices: prev.voices.filter((_, j) => j !== i) }))}
                          className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, voices: [...prev.voices, { id: "", name: "" }] }))}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加音色
                  </button>
                </div>
              ) : (
                <>
                  <ChipGroup
                    label="支持清晰度"
                    options={RESOLUTIONS.map((r) => ({ value: r, label: r }))}
                    selected={form.resolutions}
                    onToggle={(v) => toggleArr("resolutions", v)}
                  />
                  <ChipGroup
                    label="支持比例"
                    options={VIDEO_RATIOS.map((r) => ({ value: r.value, label: r.label }))}
                    selected={form.ratios}
                    onToggle={(v) => toggleArr("ratios", v)}
                  />
                  <div>
                    <label className="block text-sm font-medium">支持时长（秒）</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {DURATION_CHOICES.map((d) => (
                        <Chip key={d} active={form.durations.includes(d)} onClick={() => toggleDuration(d)}>
                          {d}s
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium">生成音频</label>
                    <div className="mt-2 flex gap-2">
                      <Chip active={form.audio} onClick={() => setForm({ ...form, audio: true })}>支持</Chip>
                      <Chip active={!form.audio} onClick={() => setForm({ ...form, audio: false })}>不支持</Chip>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Runware 参数结构</label>
                    <div className="mt-2 flex gap-2">
                      <Chip active={form.videoInputs} onClick={() => setForm({ ...form, videoInputs: true })}>v2（inputs 嵌套）</Chip>
                      <Chip active={!form.videoInputs} onClick={() => setForm({ ...form, videoInputs: false })}>旧版（顶层平铺）</Chip>
                    </div>
                    <p className="mt-1 text-xs text-neutral-400">
                      Runware 新版视频模型（Seedance 2.0 等，支持全能参考/首尾帧）须选 v2，参数会嵌入 inputs 对象；
                      非 Runware 或旧版模型保持「顶层平铺」
                    </p>
                  </div>
                  <PricingMatrix
                    corner="清晰度＼时长"
                    rows={form.resolutions.map((r) => ({ key: r, label: r }))}
                    cols={[...form.durations].sort((a, b) => a - b).map((d) => ({ key: String(d), label: `${d}s` }))}
                    pricing={form.pricing}
                    onSet={setPricing}
                  />
                </>
              )}
            </div>
          )}
          <div className="mt-5 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              <Save className="h-4 w-4" /> {saving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(emptyForm);
              }}
              className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 模型表格 */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">模型ID</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">供应商</th>
                <th className="px-4 py-3 font-medium">消耗积分</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-neutral-50 dark:border-neutral-900">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-20 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Cpu className="mx-auto h-10 w-10 text-neutral-300" />
                    <p className="mt-3 text-neutral-400">暂无模型数据</p>
                    <p className="text-sm text-neutral-400">点击上方按钮添加第一个 AI 模型</p>
                  </td>
                </tr>
              ) : (
                filteredModels.map((model) => {
                  const typeBadge = TYPE_BADGE[model.type] ?? TYPE_BADGE["text"];
                  const typeLabel = MODEL_TYPES.find((t) => t.value === model.type)?.label ?? model.type;
                  return (
                    <tr
                      key={model.id}
                      className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50 dark:border-neutral-900 dark:hover:bg-neutral-900/30"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                              model.status === 1
                                ? "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400"
                                : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                            }`}
                          >
                            <Cpu className="h-4 w-4" />
                          </div>
                          <span className="font-medium">{model.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">{model.modelId}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadge}`}>
                          {typeLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{model.providerName ?? "-"}</td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Coins className="h-3.5 w-3.5" />
                          <span className="font-medium">{model.pointCost ?? 0}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            model.status === 1
                              ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {model.status === 1 ? "启用" : "禁用"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleStatus(model)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                              model.status === 1
                                ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                : "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                            }`}
                          >
                            {model.status === 1 ? "禁用" : "启用"}
                          </button>
                          <button
                            onClick={() => startEdit(model)}
                            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(model.id, model.name)}
                            className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
