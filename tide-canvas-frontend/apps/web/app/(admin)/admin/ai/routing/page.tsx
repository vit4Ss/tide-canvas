"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Descriptions,
  Empty,
  Grid,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudDownloadOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { AdminPageHead } from "@/components/admin/page-head";
import { CLARITY_OPTIONS, DEFAULT_IMAGE_COUNT_OPTIONS, QUALITY_OPTIONS, RATIO_OPTIONS } from "@/components/canvas/nodes/utils/quality-ratio";
import { DURATION_OPTIONS, RESOLUTIONS, VIDEO_RATIOS } from "@/components/canvas/nodes/video-param-picker";
import { toast } from "@/components/shared/toast";
import { useHasPerm } from "@/stores/use-permission-store";
import { formatDate } from "@/lib/utils";
import type {
  AiModelRouteVO,
  AiProviderVO,
  AiRouteDecisionLogVO,
  AiUpstreamModelVO,
} from "@/types/admin";
import type { AiHandlerVO } from "@/types/ai";

type TabKey = "routes" | "upstream" | "decisions";

interface LogicalModelVO {
  id: string;
  name: string;
  modelId: string;
  type: string;
  providerId?: string;
  providerName?: string;
  config?: string;
  costPerCall?: number;
  status?: number;
}

interface UpstreamForm {
  providerId: string;
  name: string;
  modelId: string;
  type: string;
  capabilitiesText: string;
  configText: string;
  costPerCall: number;
  timeoutMs: number;
  priority: number;
  status: number;
}

interface RouteForm {
  upstreamModelId: string;
  handlerName: string;
  routeStrategy: string;
  complexityLevel: string;
  qualities: string[];
  clarities: string[];
  ratios: string[];
  batchCounts: number[];
  resolutions: string[];
  durations: number[];
  priority: number;
  weight: number;
  status: number;
}

const PAGE_SIZE = 20;
const { CheckableTag } = Tag;

const MODEL_TYPES = [
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "text", label: "文本" },
  { value: "audio", label: "音频" },
];

const TYPE_COLOR: Record<string, string> = {
  image: "purple",
  video: "blue",
  text: "gold",
  audio: "green",
};

const ROUTE_STRATEGIES = [
  { value: "priority", label: "优先级" },
  { value: "weighted", label: "权重" },
  { value: "fallback", label: "故障转移" },
  { value: "latency", label: "低延迟" },
];

const TAB_COPY: Record<TabKey, { title: string; desc: string }> = {
  routes: {
    title: "模型映射",
    desc: "给用户展示逻辑模型，再映射到真实上游模型；用户端只看到逻辑模型",
  },
  upstream: {
    title: "上游模型",
    desc: "配置真实供应商模型，可手动新增，也可以从供应商接口拉取后添加",
  },
  decisions: {
    title: "决策日志",
    desc: "查看每次生成命中的路由、候选模型和兜底情况",
  },
};

const COMPLEXITY_OPTIONS = [
  { value: "simple", label: "简单" },
  { value: "standard", label: "标准" },
  { value: "complex", label: "复杂" },
];

const STATUS_OPTIONS = [
  { value: 1, label: "启用" },
  { value: 0, label: "禁用" },
];

const emptyUpstreamForm: UpstreamForm = {
  providerId: "",
  name: "",
  modelId: "",
  type: "image",
  capabilitiesText: "",
  configText: "",
  costPerCall: 0,
  timeoutMs: 0,
  priority: 0,
  status: 1,
};

const emptyRouteForm: RouteForm = {
  upstreamModelId: "",
  handlerName: "",
  routeStrategy: "priority",
  complexityLevel: "",
  qualities: [],
  clarities: [],
  ratios: [],
  batchCounts: [],
  resolutions: [],
  durations: [],
  priority: 0,
  weight: 100,
  status: 1,
};

function prettyJson(text?: string): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function jsonOrEmptyObject(text: string, label: string): string | null {
  const raw = text.trim();
  if (!raw) return "{}";
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    toast.error(`${label} 必须是合法 JSON`);
    return null;
  }
}

function typeTag(type?: string) {
  if (!type) return <span style={{ color: "#bfbfbf" }}>-</span>;
  return <Tag color={TYPE_COLOR[type] || "default"}>{MODEL_TYPES.find((x) => x.value === type)?.label || type}</Tag>;
}

function statusTag(status: number) {
  return status === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>;
}

function strategyLabel(strategy?: string) {
  return ROUTE_STRATEGIES.find((x) => x.value === strategy)?.label || strategy || "优先级";
}

function isTabKey(value: string | null): value is TabKey {
  return value === "routes" || value === "upstream" || value === "decisions";
}

function shortJson(text?: string) {
  if (!text || text === "{}") return "-";
  const pretty = prettyJson(text);
  return pretty.length > 80 ? `${pretty.slice(0, 80)}...` : pretty;
}

function hasRouteConditions(text?: string) {
  const config = parseRouteConditions(text);
  return Boolean(
    config.qualities.length ||
    config.clarities.length ||
    config.ratios.length ||
    config.batchCounts.length ||
    config.resolutions.length ||
    config.durations.length ||
    (text && text.trim() && text.trim() !== "{}"),
  );
}

interface RouteMatchConfig {
  qualities: string[];
  clarities: string[];
  ratios: string[];
  batchCounts: number[];
  resolutions: string[];
  durations: number[];
}

const QUALITY_LABELS: Record<string, string> = {
  low: "低画质",
  standard: "标准画质",
  high: "高画质",
};

const emptyRouteMatchConfig = (): RouteMatchConfig => ({
  qualities: [],
  clarities: [],
  ratios: [],
  batchCounts: [],
  resolutions: [],
  durations: [],
});

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function numberArray(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return values
    .map((item) => Number(String(item).replace(/s$/i, "")))
    .filter((item, index, arr) => Number.isFinite(item) && item > 0 && arr.indexOf(item) === index);
}

function parseRouteConditions(text?: string): RouteMatchConfig {
  const empty = emptyRouteMatchConfig();
  if (!text || text.trim() === "{}") return empty;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    return {
      qualities: stringArray(raw.qualities ?? raw.quality),
      clarities: stringArray(raw.clarities ?? raw.clarity),
      ratios: stringArray(raw.ratios ?? raw.aspectRatios ?? raw.aspectRatio ?? raw.ratio),
      batchCounts: numberArray(raw.batchCounts ?? raw.batchCount ?? raw.counts ?? raw.n),
      resolutions: stringArray(raw.resolutions ?? raw.resolution),
      durations: numberArray(raw.durations ?? raw.duration),
    };
  } catch {
    return empty;
  }
}

function buildRouteConditions(form: RouteForm): string {
  const conditions: Record<string, unknown> = {};
  if (form.qualities.length) conditions.qualities = form.qualities;
  if (form.clarities.length) conditions.clarities = form.clarities;
  if (form.ratios.length) conditions.ratios = form.ratios;
  if (form.batchCounts.length) conditions.batchCounts = form.batchCounts;
  if (form.resolutions.length) conditions.resolutions = form.resolutions;
  if (form.durations.length) conditions.durations = form.durations;
  return JSON.stringify(conditions);
}

function toggleValue<T extends string | number>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function conditionTags(text?: string) {
  const config = parseRouteConditions(text);
  const tags: React.ReactNode[] = [];
  const add = (key: string, label: string, values: Array<string | number>) => {
    if (!values.length) return;
    tags.push(<Tag key={key} color="blue">{label}: {values.join(" / ")}</Tag>);
  };
  add("qualities", "画质", config.qualities.map((value) => QUALITY_LABELS[value] ?? value));
  add("clarities", "清晰度", config.clarities);
  add("ratios", "比例", config.ratios.map((value) => (value === "auto" ? "自动" : value)));
  add("batchCounts", "张数", config.batchCounts.map((value) => `${value}张`));
  add("resolutions", "视频分辨率", config.resolutions);
  add("durations", "时长", config.durations.map((value) => `${value}s`));
  if (tags.length > 0) return <Space size={[0, 4]} wrap>{tags}</Space>;
  if (text && text.trim() && text.trim() !== "{}") return <Tag color="purple">自定义条件</Tag>;
  return <Tag>默认兜底</Tag>;
}

function RouteConditionGroup({ label, options, selected, onToggle }: {
  label: string;
  options: { value: string | number; label: string }[];
  selected: Array<string | number>;
  onToggle: (value: string | number) => void;
}) {
  return (
    <div>
      <div style={{ marginBottom: 6, color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>{label}</div>
      <Space wrap size={[6, 6]}>
        {options.map((option) => (
          <CheckableTag
            key={String(option.value)}
            checked={selected.includes(option.value)}
            onChange={() => onToggle(option.value)}
            style={{ border: "1px solid #d9d9d9", padding: "2px 10px" }}
          >
            {option.label}
          </CheckableTag>
        ))}
      </Space>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6, color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>{label}</div>
      {children}
    </div>
  );
}

function MetricItem({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <div style={{ minWidth: 118, padding: "10px 12px", border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, background: "#fafafa" }}>
      <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {hint && <div style={{ marginTop: 2, color: "var(--ant-color-text-tertiary, #bfbfbf)", fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

export function AdminAiRoutingPageView({ defaultTab = "routes" }: { defaultTab?: TabKey }) {
  const router = useRouter();
  const can = useHasPerm();
  const screens = Grid.useBreakpoint();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return defaultTab;
    const tab = new URLSearchParams(window.location.search).get("tab");
    return isTabKey(tab) ? tab : defaultTab;
  });

  const [providers, setProviders] = useState<AiProviderVO[]>([]);
  const [logicalModels, setLogicalModels] = useState<LogicalModelVO[]>([]);
  const [upstreamModels, setUpstreamModels] = useState<AiUpstreamModelVO[]>([]);
  const [handlers, setHandlers] = useState<AiHandlerVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelKeyword, setModelKeyword] = useState("");
  const [requestedModelId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("modelId") ?? "";
  });

  const [referenceLoading, setReferenceLoading] = useState(true);
  const [upstreamLoading, setUpstreamLoading] = useState(true);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState(false);

  const [routes, setRoutes] = useState<AiModelRouteVO[]>([]);
  const [decisions, setDecisions] = useState<AiRouteDecisionLogVO[]>([]);
  const [decisionTotal, setDecisionTotal] = useState(0);
  const [decisionPage, setDecisionPage] = useState(1);
  const [decisionDetail, setDecisionDetail] = useState<AiRouteDecisionLogVO | null>(null);

  const [upstreamOpen, setUpstreamOpen] = useState(false);
  const [editingUpstreamId, setEditingUpstreamId] = useState<string | null>(null);
  const [upstreamForm, setUpstreamForm] = useState<UpstreamForm>({ ...emptyUpstreamForm });
  const [upstreamSaving, setUpstreamSaving] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteProviderId, setRemoteProviderId] = useState("");
  const [remoteKeyword, setRemoteKeyword] = useState("");
  const [remoteType, setRemoteType] = useState("image");
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteImportingId, setRemoteImportingId] = useState("");
  const [logicalImporting, setLogicalImporting] = useState(false);

  const [routeOpen, setRouteOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [routeForm, setRouteForm] = useState<RouteForm>({ ...emptyRouteForm });
  const [routeSaving, setRouteSaving] = useState(false);


  const selectedLogicalModel = useMemo(
    () => logicalModels.find((m) => m.id === selectedModelId),
    [logicalModels, selectedModelId],
  );

  const filteredLogicalModels = useMemo(() => {
    const keyword = modelKeyword.trim().toLowerCase();
    if (!keyword) return logicalModels;
    return logicalModels.filter((model) =>
      [model.name, model.modelId, model.providerName, model.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [logicalModels, modelKeyword]);

  const enabledRoutes = useMemo(() => routes.filter((route) => route.status === 1).length, [routes]);
  const defaultRouteCount = useMemo(() => routes.filter((route) => !hasRouteConditions(route.conditions)).length, [routes]);
  const enabledUpstreamCount = useMemo(() => upstreamModels.filter((model) => model.status === 1).length, [upstreamModels]);
  const existingUpstreamKeys = useMemo(
    () => new Set(upstreamModels.map((model) => `${model.providerId}:${model.modelId}`)),
    [upstreamModels],
  );
  const logicalImportCandidates = useMemo(
    () => logicalModels.filter((model) => model.providerId && model.modelId && !existingUpstreamKeys.has(`${model.providerId}:${model.modelId}`)),
    [existingUpstreamKeys, logicalModels],
  );
  const remoteModelRows = useMemo(() => remoteModels.map((modelId) => ({ modelId })), [remoteModels]);
  const routeGridColumns = screens.lg ? "minmax(280px, 340px) minmax(0, 1fr)" : "1fr";
  const conditionGridColumns = screens.md ? "repeat(3, minmax(0, 1fr))" : "1fr";
  const pageCopy = TAB_COPY[activeTab];
  const surfaceStyle = {
    border: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
    borderRadius: 8,
    background: "#fff",
  };

  const handlerOptions = useMemo(() => {
    const base = handlers.map((h) => ({
      value: h.handlerName,
      label: h.displayName ? `${h.displayName} (${h.handlerName})` : h.handlerName,
    }));
    if (routeForm.handlerName && !base.some((h) => h.value === routeForm.handlerName)) {
      return [{ value: routeForm.handlerName, label: routeForm.handlerName }, ...base];
    }
    return base;
  }, [handlers, routeForm.handlerName]);

  const loadReferenceData = useCallback(async () => {
    setReferenceLoading(true);
    try {
      const [providerRes, modelRes, handlerRes] = await Promise.all([
        adminApi.ai.providers.list(),
        adminApi.ai.models.list(),
        adminApi.ai.handlers.list(),
      ]);
      if (providerRes.success) setProviders(providerRes.data);
      const nextModels = modelRes.success ? (modelRes.data as unknown as LogicalModelVO[]) : [];
      setLogicalModels(nextModels);
      setSelectedModelId((current) => {
        if (requestedModelId && nextModels.some((m) => m.id === requestedModelId)) return requestedModelId;
        if (current && nextModels.some((m) => m.id === current)) return current;
        return nextModels[0]?.id ?? "";
      });
      if (handlerRes.success) setHandlers(handlerRes.data);
    } finally {
      setReferenceLoading(false);
    }
  }, [requestedModelId]);

  const loadUpstreamModels = useCallback(async () => {
    setUpstreamLoading(true);
    try {
      const res = await adminApi.ai.upstreamModels.list();
      if (res.success) setUpstreamModels(res.data);
    } finally {
      setUpstreamLoading(false);
    }
  }, []);

  const loadRoutes = useCallback(async () => {
    if (!selectedModelId) {
      setRoutes([]);
      return;
    }
    setRoutesLoading(true);
    try {
      const res = await adminApi.ai.modelRoutes.list(selectedModelId);
      if (res.success) setRoutes(res.data);
    } finally {
      setRoutesLoading(false);
    }
  }, [selectedModelId]);

  const loadDecisionLogs = useCallback(async () => {
    setDecisionLoading(true);
    try {
      const res = await adminApi.ai.routeDecisions.list({ pageNum: decisionPage, pageSize: PAGE_SIZE });
      if (res.success) {
        setDecisions(res.data.records);
        setDecisionTotal(res.data.total);
      }
    } finally {
      setDecisionLoading(false);
    }
  }, [decisionPage]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadReferenceData();
      void loadUpstreamModels();
    });
  }, [loadReferenceData, loadUpstreamModels]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadRoutes();
    });
  }, [loadRoutes]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadDecisionLogs();
    });
  }, [loadDecisionLogs]);

  const refreshCurrent = () => {
    if (activeTab === "upstream") void loadUpstreamModels();
    if (activeTab === "routes") void loadRoutes();
    if (activeTab === "decisions") void loadDecisionLogs();
  };

  const switchTab = (value: string | number) => {
    const nextTab = value as TabKey;
    if (nextTab === "upstream" && defaultTab !== "upstream") {
      router.push("/admin/ai/upstream");
      return;
    }
    if (nextTab === "routes" && defaultTab === "upstream") {
      router.push(selectedModelId ? `/admin/ai/routing?modelId=${selectedModelId}` : "/admin/ai/routing");
      return;
    }
    setActiveTab(nextTab);
  };

  const openCreateUpstream = () => {
    setEditingUpstreamId(null);
    setUpstreamForm({ ...emptyUpstreamForm });
    setUpstreamOpen(true);
  };

  const openRemoteImport = () => {
    if (providers.length === 0) {
      toast.error("请先配置 AI 供应商");
      router.push("/admin/ai/providers");
      return;
    }
    setRemoteProviderId((current) => current || providers.find((provider) => provider.status === 1)?.id || providers[0]?.id || "");
    setRemoteKeyword("");
    setRemoteModels([]);
    setRemoteOpen(true);
  };

  const fetchRemoteModels = async () => {
    if (!remoteProviderId) {
      toast.error("请选择供应商");
      return;
    }
    setRemoteLoading(true);
    try {
      const res = await adminApi.ai.providers.remoteModels(remoteProviderId, remoteKeyword.trim() || undefined);
      if (res.success) {
        setRemoteModels(res.data);
        if (res.data.length === 0) toast.info("供应商没有返回模型");
      } else {
        toast.error(res.message || "获取上游模型失败");
      }
    } finally {
      setRemoteLoading(false);
    }
  };

  const importRemoteModel = async (modelId: string) => {
    if (!remoteProviderId) {
      toast.error("请选择供应商");
      return;
    }
    setRemoteImportingId(modelId);
    try {
      const res = await adminApi.ai.upstreamModels.create({
        providerId: remoteProviderId,
        name: modelId,
        modelId,
        type: remoteType,
        capabilities: {},
        config: {},
        costPerCall: 0,
        timeoutMs: 0,
        priority: 0,
        status: 1,
      });
      if (res.success) {
        toast.success("已添加上游模型");
        await loadUpstreamModels();
      } else {
        toast.error(res.message || "添加上游模型失败");
      }
    } finally {
      setRemoteImportingId("");
    }
  };

  const importLogicalModelsAsUpstream = async () => {
    if (logicalImportCandidates.length === 0) {
      toast.info("当前模型没有可导入的上游记录");
      return;
    }
    setLogicalImporting(true);
    let imported = 0;
    let failed = 0;
    try {
      for (const model of logicalImportCandidates) {
        const res = await adminApi.ai.upstreamModels.create({
          providerId: model.providerId,
          name: model.name || model.modelId,
          modelId: model.modelId,
          type: model.type || "image",
          capabilities: {},
          config: model.config?.trim() ? model.config : {},
          costPerCall: Number(model.costPerCall || 0),
          timeoutMs: 0,
          priority: 0,
          status: model.status ?? 1,
        });
        if (res.success) imported += 1;
        else failed += 1;
      }
      await loadUpstreamModels();
      if (imported > 0) toast.success(`已导入 ${imported} 个上游模型`);
      if (failed > 0) toast.error(`${failed} 个模型导入失败`);
    } finally {
      setLogicalImporting(false);
    }
  };

  const openCreateUpstreamFromRoute = () => {
    setRouteOpen(false);
    openCreateUpstream();
  };

  const openEditUpstream = (item: AiUpstreamModelVO) => {
    setEditingUpstreamId(item.id);
    setUpstreamForm({
      providerId: String(item.providerId || ""),
      name: item.name || "",
      modelId: item.modelId || "",
      type: item.type || "image",
      capabilitiesText: prettyJson(item.capabilities),
      configText: prettyJson(item.config),
      costPerCall: Number(item.costPerCall || 0),
      timeoutMs: item.timeoutMs || 0,
      priority: item.priority || 0,
      status: item.status ?? 1,
    });
    setUpstreamOpen(true);
  };

  const saveUpstream = async () => {
    if (!upstreamForm.providerId || !upstreamForm.modelId.trim()) {
      toast.error("请选择供应商并填写上游模型 ID");
      return;
    }
    const capabilities = jsonOrEmptyObject(upstreamForm.capabilitiesText, "能力配置");
    const config = jsonOrEmptyObject(upstreamForm.configText, "模型配置");
    if (capabilities == null || config == null) return;
    setUpstreamSaving(true);
    try {
      const payload: Record<string, unknown> = {
        providerId: upstreamForm.providerId,
        name: upstreamForm.name.trim(),
        modelId: upstreamForm.modelId.trim(),
        type: upstreamForm.type,
        capabilities,
        config,
        costPerCall: upstreamForm.costPerCall,
        timeoutMs: upstreamForm.timeoutMs,
        priority: upstreamForm.priority,
        status: upstreamForm.status,
      };
      const res = editingUpstreamId
        ? await adminApi.ai.upstreamModels.update(editingUpstreamId, payload)
        : await adminApi.ai.upstreamModels.create(payload);
      if (res.success) {
        toast.success("上游模型已保存");
        setUpstreamOpen(false);
        await loadUpstreamModels();
      } else {
        toast.error(res.message || "保存失败");
      }
    } finally {
      setUpstreamSaving(false);
    }
  };

  const deleteUpstream = async (id: string) => {
    const res = await adminApi.ai.upstreamModels.delete(id);
    if (res.success) {
      toast.success("上游模型已删除");
      await loadUpstreamModels();
      await loadRoutes();
    } else {
      toast.error(res.message || "删除失败");
    }
  };

  const openCreateRoute = () => {
    if (!selectedModelId) {
      toast.error("请先选择逻辑模型");
      return;
    }
    setEditingRouteId(null);
    setRouteForm({ ...emptyRouteForm });
    setRouteOpen(true);
  };

  const openEditRoute = (item: AiModelRouteVO) => {
    const conditions = parseRouteConditions(item.conditions);
    setEditingRouteId(item.id);
    setRouteForm({
      upstreamModelId: String(item.upstreamModelId || ""),
      handlerName: item.handlerName || "",
      routeStrategy: item.routeStrategy || "priority",
      complexityLevel: item.complexityLevel || "",
      qualities: conditions.qualities,
      clarities: conditions.clarities,
      ratios: conditions.ratios,
      batchCounts: conditions.batchCounts,
      resolutions: conditions.resolutions,
      durations: conditions.durations,
      priority: item.priority || 0,
      weight: item.weight || 100,
      status: item.status ?? 1,
    });
    setRouteOpen(true);
  };

  const saveRoute = async () => {
    if (!selectedModelId || !routeForm.upstreamModelId || !routeForm.handlerName.trim()) {
      toast.error("请选择逻辑模型、上游模型和 Handler");
      return;
    }
    const conditions = buildRouteConditions(routeForm);
    setRouteSaving(true);
    try {
      const payload: Record<string, unknown> = {
        upstreamModelId: routeForm.upstreamModelId,
        handlerName: routeForm.handlerName.trim(),
        routeStrategy: routeForm.routeStrategy,
        complexityLevel: routeForm.complexityLevel,
        conditions,
        priority: routeForm.priority,
        weight: routeForm.weight,
        status: routeForm.status,
      };
      const res = editingRouteId
        ? await adminApi.ai.modelRoutes.update(editingRouteId, payload)
        : await adminApi.ai.modelRoutes.create(selectedModelId, payload);
      if (res.success) {
        toast.success("模型映射已保存");
        setRouteOpen(false);
        await loadRoutes();
      } else {
        toast.error(res.message || "保存失败");
      }
    } finally {
      setRouteSaving(false);
    }
  };

  const deleteRoute = async (id: string) => {
    const res = await adminApi.ai.modelRoutes.delete(id);
    if (res.success) {
      toast.success("模型映射已删除");
      await loadRoutes();
    } else {
      toast.error(res.message || "删除失败");
    }
  };

  const upstreamColumns: ColumnsType<AiUpstreamModelVO> = [
    {
      title: "上游模型",
      key: "model",
      render: (_, item) => (
        <div>
          <div style={{ fontWeight: 500 }}>{item.name || item.modelId}</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{item.modelId}</div>
        </div>
      ),
    },
    { title: "供应商", dataIndex: "providerName", key: "providerName", render: (v) => v || "-" },
    { title: "类型", dataIndex: "type", key: "type", render: typeTag },
    { title: "成本", dataIndex: "costPerCall", key: "costPerCall", responsive: ["md"], render: (v) => `$${Number(v || 0).toFixed(4)}` },
    { title: "超时", dataIndex: "timeoutMs", key: "timeoutMs", responsive: ["lg"], render: (v) => (v ? `${v} ms` : "-") },
    { title: "优先级", dataIndex: "priority", key: "priority", width: 90 },
    { title: "状态", dataIndex: "status", key: "status", render: statusTag },
    {
      title: "添加时间",
      dataIndex: "createTime",
      key: "createTime",
      width: 180,
      responsive: ["md"],
      render: (value) => <span style={{ whiteSpace: "nowrap", fontSize: 12, color: "#8c8c8c" }}>{value ? formatDate(value) : "-"}</span>,
    },
    {
      title: "添加人",
      dataIndex: "creatorName",
      key: "creatorName",
      width: 140,
      render: (value, item) => value || (item.createdBy && item.createdBy !== "0" ? item.createdBy : "系统/历史数据"),
    },
    {
      title: "操作",
      key: "action",
      align: "right",
      render: (_, item) => (
        <Space size={0}>
          {can("model:manage") && <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditUpstream(item)}>编辑</Button>}
          {can("model:manage") && (
            <Popconfirm title={`删除上游模型「${item.name || item.modelId}」？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteUpstream(item.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const remoteColumns: ColumnsType<{ modelId: string }> = [
    {
      title: "供应商模型 ID",
      dataIndex: "modelId",
      key: "modelId",
      render: (modelId) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{modelId}</span>,
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, item) => {
        const exists = existingUpstreamKeys.has(`${remoteProviderId}:${item.modelId}`);
        return exists ? <Tag color="green">已添加</Tag> : <Tag>可添加</Tag>;
      },
    },
    {
      title: "操作",
      key: "action",
      align: "right",
      width: 140,
      render: (_, item) => {
        const exists = existingUpstreamKeys.has(`${remoteProviderId}:${item.modelId}`);
        return (
          <Button
            type="link"
            size="small"
            disabled={exists || !can("model:manage")}
            loading={remoteImportingId === item.modelId}
            onClick={() => importRemoteModel(item.modelId)}
          >
            添加为上游
          </Button>
        );
      },
    },
  ];

  const routeColumns: ColumnsType<AiModelRouteVO> = [
    {
      title: "上游模型",
      key: "upstream",
      render: (_, item) => {
        const upstream = upstreamModels.find((m) => m.id === item.upstreamModelId);
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{item.upstreamModelName || upstream?.name || "-"}</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{upstream?.modelId || item.upstreamModelId}</div>
          </div>
        );
      },
    },
    { title: "Handler", dataIndex: "handlerName", key: "handlerName", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> },
    { title: "策略", dataIndex: "routeStrategy", key: "routeStrategy", render: (v) => <Tag>{strategyLabel(v)}</Tag> },
    { title: "复杂度", dataIndex: "complexityLevel", key: "complexityLevel", responsive: ["md"], render: (v) => v ? <Tag color="blue">{COMPLEXITY_OPTIONS.find((x) => x.value === v)?.label || v}</Tag> : "-" },
    { title: "优先级", dataIndex: "priority", key: "priority", width: 90 },
    { title: "权重", dataIndex: "weight", key: "weight", width: 80 },
    {
      title: "匹配条件",
      dataIndex: "conditions",
      key: "conditions",
      responsive: ["lg"],
      render: (v) => (
        <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{shortJson(v) === "-" ? "空条件会作为默认兜底映射" : prettyJson(v)}</pre>}>
          <span>{conditionTags(v)}</span>
        </Tooltip>
      ),
    },
    { title: "状态", dataIndex: "status", key: "status", render: statusTag },
    {
      title: "操作",
      key: "action",
      align: "right",
      render: (_, item) => (
        <Space size={0}>
          {can("model:manage") && <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditRoute(item)}>编辑</Button>}
          {can("model:manage") && (
            <Popconfirm title="删除这条模型映射？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteRoute(item.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const decisionColumns: ColumnsType<AiRouteDecisionLogVO> = [
    { title: "时间", dataIndex: "createTime", key: "createTime", render: (v) => <span style={{ whiteSpace: "nowrap", fontSize: 12, color: "#8c8c8c" }}>{v ? formatDate(v) : "-"}</span> },
    { title: "Handler", dataIndex: "handlerName", key: "handlerName", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v || "-"}</span> },
    { title: "逻辑模型", dataIndex: "logicalModel", key: "logicalModel", render: (v) => v || "-" },
    { title: "上游模型", dataIndex: "upstreamModel", key: "upstreamModel", render: (v) => v || "-" },
    { title: "策略", dataIndex: "routeStrategy", key: "routeStrategy", responsive: ["md"], render: (v) => <Tag>{strategyLabel(v)}</Tag> },
    { title: "复杂度", key: "complexity", responsive: ["lg"], render: (_, item) => item.complexityLevel ? `${item.complexityLevel} / ${item.complexityScore}` : "-" },
    { title: "候选", dataIndex: "candidateCount", key: "candidateCount", responsive: ["lg"] },
    { title: "兜底", dataIndex: "fallbackUsed", key: "fallbackUsed", render: (v) => v === 1 ? <Tag color="orange">是</Tag> : <Tag>否</Tag> },
    { title: "原因", dataIndex: "decisionReason", key: "decisionReason", ellipsis: true, render: (v) => v || "-" },
    { title: "操作", key: "action", align: "right", render: (_, item) => <Button type="link" size="small" onClick={() => setDecisionDetail(item)}>详情</Button> },
  ];

  const routeConditionType = selectedLogicalModel?.type || upstreamModels.find((item) => item.id === routeForm.upstreamModelId)?.type || "image";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title={pageCopy.title}
        desc={pageCopy.desc}
        extra={<Button icon={<ReloadOutlined />} onClick={refreshCurrent}>刷新</Button>}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Segmented
          value={activeTab}
          onChange={switchTab}
          options={[
            { value: "routes", label: "模型映射" },
            { value: "upstream", label: "上游模型" },
            { value: "decisions", label: "决策日志" },
          ]}
        />
        <Space wrap>
          {activeTab === "routes" && can("model:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRoute} disabled={!selectedModelId}>新增映射</Button>}
        </Space>
      </div>

      {activeTab === "routes" && (
        <div style={{ display: "grid", gridTemplateColumns: routeGridColumns, gap: 16, alignItems: "start" }}>
          <div style={{ ...surfaceStyle, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>用户可见模型</div>
                <div style={{ marginTop: 2, color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>
                  共 {logicalModels.length} 个，已筛选 {filteredLogicalModels.length} 个
                </div>
              </div>
              <Tag>{referenceLoading ? "加载中" : "模型池"}</Tag>
            </div>
            <Input.Search
              allowClear
              value={modelKeyword}
              onChange={(event) => setModelKeyword(event.target.value)}
              placeholder="搜索名称 / model_id / 类型"
              style={{ marginTop: 12 }}
            />
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, maxHeight: screens.lg ? "calc(100vh - 360px)" : 360, overflowY: "auto", paddingRight: 2 }}>
              {filteredLogicalModels.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={referenceLoading ? "模型加载中" : "没有匹配模型"} />
              ) : filteredLogicalModels.map((model) => {
                const active = model.id === selectedModelId;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModelId(model.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                      border: `1px solid ${active ? "var(--ant-color-primary, #1677ff)" : "var(--ant-color-border-secondary, #f0f0f0)"}`,
                      background: active ? "var(--ant-color-primary-bg, #e6f4ff)" : "#fff",
                      borderRadius: 8,
                      padding: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.name}</span>
                      {statusTag(model.status ?? 1)}
                    </div>
                    <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 12, color: "var(--ant-color-text-secondary, #8c8c8c)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {model.modelId}
                    </div>
                    <Space size={[4, 4]} wrap style={{ marginTop: 8 }}>
                      {typeTag(model.type)}
                      {model.providerName && <Tag>{model.providerName}</Tag>}
                    </Space>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ ...surfaceStyle, minWidth: 0 }}>
            {selectedLogicalModel ? (
              <>
                <div style={{ padding: 16, borderBottom: "1px solid var(--ant-color-border-secondary, #f0f0f0)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <Space size={8} wrap>
                        <h3 style={{ margin: 0, fontSize: 18 }}>{selectedLogicalModel.name}</h3>
                        {typeTag(selectedLogicalModel.type)}
                        {statusTag(selectedLogicalModel.status ?? 1)}
                      </Space>
                      <div style={{ marginTop: 4, fontFamily: "monospace", color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>
                        {selectedLogicalModel.modelId}
                      </div>
                    </div>
                    <Space>
                      <Button icon={<ReloadOutlined />} onClick={loadRoutes} loading={routesLoading}>刷新规则</Button>
                      {can("model:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRoute}>新增映射</Button>}
                    </Space>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                    <MetricItem label="映射规则" value={routes.length} hint="当前模型" />
                    <MetricItem label="启用规则" value={enabledRoutes} color="#16a34a" />
                    <MetricItem label="默认兜底" value={defaultRouteCount} />
                    <MetricItem label="可用上游" value={enabledUpstreamCount} hint={`共 ${upstreamModels.length} 个`} />
                  </div>
                </div>
                <Table<AiModelRouteVO>
                  rowKey="id"
                  columns={routeColumns}
                  dataSource={routes}
                  loading={routesLoading || referenceLoading}
                  pagination={false}
                  scroll={{ x: "max-content" }}
                  locale={{ emptyText: "暂无模型映射" }}
                />
              </>
            ) : (
              <div style={{ padding: 48 }}>
                <Empty description="请选择一个用户可见模型" />
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "upstream" && (
        <div style={surfaceStyle}>
          <div style={{ padding: 16, borderBottom: "1px solid var(--ant-color-border-secondary, #f0f0f0)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <MetricItem label="上游模型" value={upstreamModels.length} />
              <MetricItem label="启用模型" value={enabledUpstreamCount} color="#16a34a" />
              <MetricItem label="供应商" value={new Set(upstreamModels.map((model) => model.providerId).filter(Boolean)).size} />
            </div>
            <Space wrap>
              {can("model:manage") && (
                <Button loading={logicalImporting} disabled={logicalImportCandidates.length === 0} onClick={() => void importLogicalModelsAsUpstream()}>
                  从当前模型导入
                </Button>
              )}
              {can("model:manage") && <Button icon={<CloudDownloadOutlined />} onClick={openRemoteImport}>从供应商获取</Button>}
              {can("model:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateUpstream}>新增上游模型</Button>}
            </Space>
          </div>
          <Table<AiUpstreamModelVO>
            rowKey="id"
            columns={upstreamColumns}
            dataSource={upstreamModels}
            loading={upstreamLoading}
            pagination={{ pageSize: 15, showTotal: (total) => `共 ${total} 条` }}
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前数据库还没有上游模型">
                  <Space wrap>
                    {can("model:manage") && (
                      <Button loading={logicalImporting} disabled={logicalImportCandidates.length === 0} onClick={() => void importLogicalModelsAsUpstream()}>
                        从当前模型导入
                      </Button>
                    )}
                    {can("model:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateUpstream}>手动新增</Button>}
                    {can("model:manage") && <Button icon={<CloudDownloadOutlined />} onClick={openRemoteImport}>从供应商获取</Button>}
                    {providers.length === 0 && <Button onClick={() => router.push("/admin/ai/providers")}>配置供应商</Button>}
                  </Space>
                </Empty>
              ),
            }}
          />
        </div>
      )}

      {activeTab === "decisions" && (
        <div style={surfaceStyle}>
          <div style={{ padding: 16, borderBottom: "1px solid var(--ant-color-border-secondary, #f0f0f0)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <Space size={[8, 8]} wrap>
              <MetricItem label="日志总数" value={decisionTotal} />
              <MetricItem label="本页记录" value={decisions.length} />
            </Space>
            <Button icon={<ReloadOutlined />} onClick={loadDecisionLogs} loading={decisionLoading}>刷新日志</Button>
          </div>
          <Table<AiRouteDecisionLogVO>
            rowKey="id"
            columns={decisionColumns}
            dataSource={decisions}
            loading={decisionLoading}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "暂无路由决策日志" }}
            pagination={{
              current: decisionPage,
              pageSize: PAGE_SIZE,
              total: decisionTotal,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
              onChange: setDecisionPage,
            }}
          />
        </div>
      )}

      <Modal
        title="从供应商获取模型"
        open={remoteOpen}
        onCancel={() => setRemoteOpen(false)}
        footer={null}
        width={820}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <div style={{ border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, background: "#fafafa", padding: "10px 12px", color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 13 }}>
            这里会调用供应商的模型列表接口。拉到的只是候选模型，点击“添加为上游”后才会写入当前系统并出现在映射下拉框里。
          </div>
          <div style={{ display: "grid", gridTemplateColumns: screens.md ? "minmax(220px, 1fr) minmax(160px, 220px) minmax(220px, 1fr)" : "1fr", gap: 12 }}>
            <Field label="供应商">
              <Select
                style={{ width: "100%" }}
                value={remoteProviderId || undefined}
                onChange={(value) => {
                  setRemoteProviderId(value);
                  setRemoteModels([]);
                }}
                placeholder="请选择供应商"
                options={providers.map((provider) => ({
                  value: provider.id,
                  label: `${provider.name} (${provider.providerType})`,
                }))}
              />
            </Field>
            <Field label="添加类型">
              <Select style={{ width: "100%" }} value={remoteType} onChange={setRemoteType} options={MODEL_TYPES} />
            </Field>
            <Field label="搜索关键词">
              <Input.Search
                allowClear
                value={remoteKeyword}
                onChange={(event) => setRemoteKeyword(event.target.value)}
                onSearch={() => void fetchRemoteModels()}
                placeholder="可选，留空获取全部"
                enterButton="获取"
                loading={remoteLoading}
              />
            </Field>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Space size={[8, 8]} wrap>
              <Button type="primary" icon={<CloudDownloadOutlined />} loading={remoteLoading} onClick={() => void fetchRemoteModels()}>
                获取模型
              </Button>
              <Button onClick={() => setRemoteModels([])} disabled={remoteModels.length === 0}>清空结果</Button>
            </Space>
            <span style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>
              已获取 {remoteModels.length} 个候选
            </span>
          </div>
          <Table<{ modelId: string }>
            rowKey="modelId"
            columns={remoteColumns}
            dataSource={remoteModelRows}
            loading={remoteLoading}
            pagination={{ pageSize: 8, showTotal: (total) => `共 ${total} 个候选` }}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "请选择供应商并点击获取模型" }}
          />
        </div>
      </Modal>

      <Modal
        title={editingUpstreamId ? "编辑上游模型" : "新增上游模型"}
        open={upstreamOpen}
        onCancel={() => setUpstreamOpen(false)}
        onOk={saveUpstream}
        confirmLoading={upstreamSaving}
        okText="保存"
        cancelText="取消"
        width={820}
        styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="供应商 *">
              <Select
                style={{ width: "100%" }}
                value={upstreamForm.providerId || undefined}
                onChange={(v) => setUpstreamForm((prev) => ({ ...prev, providerId: v }))}
                placeholder="请选择供应商"
                showSearch
                optionFilterProp="label"
                options={providers.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label="名称">
              <Input value={upstreamForm.name} onChange={(e) => setUpstreamForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="例如：GPT-4o 主线路" />
            </Field>
            <Field label="上游模型 ID *">
              <Input value={upstreamForm.modelId} onChange={(e) => setUpstreamForm((prev) => ({ ...prev, modelId: e.target.value }))} placeholder="例如：gpt-4o" />
            </Field>
            <Field label="类型">
              <Select style={{ width: "100%" }} value={upstreamForm.type} onChange={(v) => setUpstreamForm((prev) => ({ ...prev, type: v }))} options={MODEL_TYPES} />
            </Field>
            <Field label="单次成本">
              <InputNumber min={0} step={0.0001} style={{ width: "100%" }} value={upstreamForm.costPerCall} onChange={(v) => setUpstreamForm((prev) => ({ ...prev, costPerCall: Number(v || 0) }))} />
            </Field>
            <Field label="超时毫秒">
              <InputNumber min={0} style={{ width: "100%" }} value={upstreamForm.timeoutMs} onChange={(v) => setUpstreamForm((prev) => ({ ...prev, timeoutMs: Number(v || 0) }))} />
            </Field>
            <Field label="优先级">
              <InputNumber style={{ width: "100%" }} value={upstreamForm.priority} onChange={(v) => setUpstreamForm((prev) => ({ ...prev, priority: Number(v || 0) }))} />
            </Field>
            <Field label="状态">
              <Select style={{ width: "100%" }} value={upstreamForm.status} onChange={(v) => setUpstreamForm((prev) => ({ ...prev, status: v }))} options={STATUS_OPTIONS} />
            </Field>
          </div>
          <Field label="能力配置 JSON">
            <Input.TextArea rows={5} value={upstreamForm.capabilitiesText} onChange={(e) => setUpstreamForm((prev) => ({ ...prev, capabilitiesText: e.target.value }))} placeholder='例如：{"maxInputImages":4,"supportsVideo":false}' />
          </Field>
          <Field label="模型配置 JSON">
            <Input.TextArea rows={5} value={upstreamForm.configText} onChange={(e) => setUpstreamForm((prev) => ({ ...prev, configText: e.target.value }))} placeholder='例如：{"temperature":0.7}' />
          </Field>
        </div>
      </Modal>

      <Modal
        title={editingRouteId ? "编辑模型映射" : "新增模型映射"}
        open={routeOpen}
        onCancel={() => setRouteOpen(false)}
        onOk={saveRoute}
        confirmLoading={routeSaving}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <div style={{ border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, background: "#fafafa", padding: "10px 12px" }}>
            <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>绑定到逻辑模型</div>
            <div style={{ marginTop: 2, fontWeight: 600 }}>
              {selectedLogicalModel ? selectedLogicalModel.name : "未选择逻辑模型"}
            </div>
            {selectedLogicalModel && (
              <div style={{ marginTop: 2, fontFamily: "monospace", fontSize: 12, color: "var(--ant-color-text-secondary, #8c8c8c)" }}>
                {selectedLogicalModel.modelId}
              </div>
            )}
          </div>
          {upstreamModels.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px dashed var(--ant-color-border, #d9d9d9)", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
              <div>
                <div style={{ fontWeight: 600 }}>还没有上游模型</div>
                <div style={{ marginTop: 2, color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>
                  先创建真实供应商模型，再把它绑定到这个逻辑模型。
                </div>
              </div>
              {can("model:manage") ? (
                <Space size={8} wrap>
                  <Button size="small" loading={logicalImporting} disabled={logicalImportCandidates.length === 0} onClick={() => void importLogicalModelsAsUpstream()}>
                    从当前模型导入
                  </Button>
                  <Button size="small" icon={<PlusOutlined />} onClick={openCreateUpstreamFromRoute}>新增上游模型</Button>
                </Space>
              ) : (
                <span style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>需要模型管理权限</span>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="上游模型 *">
              <Select
                style={{ width: "100%" }}
                value={routeForm.upstreamModelId || undefined}
                onChange={(v) => setRouteForm((prev) => ({ ...prev, upstreamModelId: v }))}
                placeholder="请选择上游模型"
                showSearch
                optionFilterProp="label"
                notFoundContent={
                  <div style={{ padding: "12px 8px", textAlign: "center" }}>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无上游模型" style={{ margin: 0 }} />
                    {can("model:manage") ? (
                      <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={openCreateUpstreamFromRoute}
                      >
                        新增上游模型
                      </Button>
                    ) : (
                      <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>请联系管理员添加</div>
                    )}
                  </div>
                }
                options={upstreamModels.map((m) => ({
                  value: m.id,
                  label: `${m.name || m.modelId} / ${m.providerName || "-"} / ${m.modelId}`,
                }))}
              />
            </Field>
            <Field label="Handler *">
              <Select
                style={{ width: "100%" }}
                value={routeForm.handlerName || undefined}
                onChange={(v) => setRouteForm((prev) => ({ ...prev, handlerName: v }))}
                placeholder="请选择 Handler"
                showSearch
                optionFilterProp="label"
                options={handlerOptions}
              />
            </Field>
            <Field label="映射策略">
              <Select style={{ width: "100%" }} value={routeForm.routeStrategy} onChange={(v) => setRouteForm((prev) => ({ ...prev, routeStrategy: v }))} options={ROUTE_STRATEGIES} />
            </Field>
            <Field label="复杂度匹配">
              <Select
                style={{ width: "100%" }}
                value={routeForm.complexityLevel || undefined}
                onChange={(v) => setRouteForm((prev) => ({ ...prev, complexityLevel: v || "" }))}
                allowClear
                placeholder="不限"
                options={COMPLEXITY_OPTIONS}
              />
            </Field>
            <Field label="优先级">
              <InputNumber style={{ width: "100%" }} value={routeForm.priority} onChange={(v) => setRouteForm((prev) => ({ ...prev, priority: Number(v || 0) }))} />
            </Field>
            <Field label="权重">
              <InputNumber min={0} style={{ width: "100%" }} value={routeForm.weight} onChange={(v) => setRouteForm((prev) => ({ ...prev, weight: Number(v || 0) }))} />
            </Field>
            <Field label="状态">
              <Select style={{ width: "100%" }} value={routeForm.status} onChange={(v) => setRouteForm((prev) => ({ ...prev, status: v }))} options={STATUS_OPTIONS} />
            </Field>
          </div>
          <div style={{ border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, padding: 14, background: "#fafafa" }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>匹配条件</div>
            <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12, marginBottom: 12 }}>
              不选择任何条件时，这条映射会作为默认兜底；选择条件后，后端会按本次生成参数优先命中更精确的映射。
            </div>
            <div style={{ display: "grid", gridTemplateColumns: conditionGridColumns, gap: "14px 16px", alignItems: "start" }}>
              {routeConditionType === "video" ? (
                <>
                  <RouteConditionGroup
                    label="视频分辨率"
                    options={RESOLUTIONS.map((value) => ({ value, label: value }))}
                    selected={routeForm.resolutions}
                    onToggle={(value) => setRouteForm((prev) => ({ ...prev, resolutions: toggleValue(prev.resolutions, String(value)) }))}
                  />
                  <RouteConditionGroup
                    label="视频比例"
                    options={VIDEO_RATIOS.map((item) => ({ value: item.value, label: item.value === "auto" ? "自动" : item.label }))}
                    selected={routeForm.ratios}
                    onToggle={(value) => setRouteForm((prev) => ({ ...prev, ratios: toggleValue(prev.ratios, String(value)) }))}
                  />
                  <RouteConditionGroup
                    label="视频时长"
                    options={DURATION_OPTIONS.map((value) => ({ value, label: `${value}s` }))}
                    selected={routeForm.durations}
                    onToggle={(value) => setRouteForm((prev) => ({ ...prev, durations: toggleValue(prev.durations, Number(value)) }))}
                  />
                </>
              ) : (
                <>
                  <RouteConditionGroup
                    label="画质"
                    options={QUALITY_OPTIONS.map((item) => ({ value: item.value, label: QUALITY_LABELS[item.value] ?? item.label }))}
                    selected={routeForm.qualities}
                    onToggle={(value) => setRouteForm((prev) => ({ ...prev, qualities: toggleValue(prev.qualities, String(value)) }))}
                  />
                  <RouteConditionGroup
                    label="清晰度"
                    options={CLARITY_OPTIONS.map((value) => ({ value, label: value }))}
                    selected={routeForm.clarities}
                    onToggle={(value) => setRouteForm((prev) => ({ ...prev, clarities: toggleValue(prev.clarities, String(value)) }))}
                  />
                  <RouteConditionGroup
                    label="出图张数"
                    options={DEFAULT_IMAGE_COUNT_OPTIONS.map((value) => ({ value, label: `${value}张` }))}
                    selected={routeForm.batchCounts}
                    onToggle={(value) => setRouteForm((prev) => ({ ...prev, batchCounts: toggleValue(prev.batchCounts, Number(value)) }))}
                  />
                  <div style={{ gridColumn: screens.md ? "1 / -1" : undefined }}>
                    <RouteConditionGroup
                      label="图片比例"
                      options={RATIO_OPTIONS.map((item) => ({ value: item.value, label: item.value === "auto" ? "自动" : item.label }))}
                      selected={routeForm.ratios}
                      onToggle={(value) => setRouteForm((prev) => ({ ...prev, ratios: toggleValue(prev.ratios, String(value)) }))}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal title="映射决策详情" open={!!decisionDetail} onCancel={() => setDecisionDetail(null)} footer={null} width={760}>
        {decisionDetail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Descriptions size="small" column={2} bordered items={[
              { key: "time", label: "时间", children: decisionDetail.createTime ? formatDate(decisionDetail.createTime) : "-" },
              { key: "task", label: "任务 ID", children: decisionDetail.taskId || "-" },
              { key: "handler", label: "Handler", children: decisionDetail.handlerName || "-" },
              { key: "strategy", label: "策略", children: strategyLabel(decisionDetail.routeStrategy) },
              { key: "logical", label: "逻辑模型", children: decisionDetail.logicalModel || "-" },
              { key: "upstream", label: "上游模型", children: decisionDetail.upstreamModel || "-" },
              { key: "complexity", label: "复杂度", children: decisionDetail.complexityLevel ? `${decisionDetail.complexityLevel} / ${decisionDetail.complexityScore}` : "-" },
              { key: "candidate", label: "候选数量", children: String(decisionDetail.candidateCount ?? "-") },
              { key: "fallback", label: "是否兜底", children: decisionDetail.fallbackUsed === 1 ? "是" : "否" },
              { key: "route", label: "路由 ID", children: decisionDetail.routeId || "-" },
            ]} />
            <Field label="决策原因">
              <Input.TextArea readOnly rows={3} value={decisionDetail.decisionReason || ""} />
            </Field>
            <Field label="决策元数据">
              <Input.TextArea readOnly rows={6} value={prettyJson(decisionDetail.decisionMetadata)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function AdminAiRoutingPage() {
  return <AdminAiRoutingPageView />;
}
