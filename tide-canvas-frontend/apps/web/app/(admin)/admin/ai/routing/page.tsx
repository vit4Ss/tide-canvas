"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
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
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { AdminPageHead } from "@/components/admin/page-head";
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
  providerName?: string;
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
  conditionsText: string;
  priority: number;
  weight: number;
  status: number;
}

const PAGE_SIZE = 20;

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
  conditionsText: "",
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

function shortJson(text?: string) {
  if (!text || text === "{}") return "-";
  const pretty = prettyJson(text);
  return pretty.length > 80 ? `${pretty.slice(0, 80)}...` : pretty;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6, color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>{label}</div>
      {children}
    </div>
  );
}

export default function AdminAiRoutingPage() {
  const can = useHasPerm();
  const [activeTab, setActiveTab] = useState<TabKey>("routes");

  const [providers, setProviders] = useState<AiProviderVO[]>([]);
  const [logicalModels, setLogicalModels] = useState<LogicalModelVO[]>([]);
  const [upstreamModels, setUpstreamModels] = useState<AiUpstreamModelVO[]>([]);
  const [handlers, setHandlers] = useState<AiHandlerVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");

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

  const [routeOpen, setRouteOpen] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [routeForm, setRouteForm] = useState<RouteForm>({ ...emptyRouteForm });
  const [routeSaving, setRouteSaving] = useState(false);

  const selectedLogicalModel = useMemo(
    () => logicalModels.find((m) => m.id === selectedModelId),
    [logicalModels, selectedModelId],
  );

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
        if (current && nextModels.some((m) => m.id === current)) return current;
        return nextModels[0]?.id ?? "";
      });
      if (handlerRes.success) setHandlers(handlerRes.data);
    } finally {
      setReferenceLoading(false);
    }
  }, []);

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

  const openCreateUpstream = () => {
    setEditingUpstreamId(null);
    setUpstreamForm({ ...emptyUpstreamForm });
    setUpstreamOpen(true);
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
    setEditingRouteId(item.id);
    setRouteForm({
      upstreamModelId: String(item.upstreamModelId || ""),
      handlerName: item.handlerName || "",
      routeStrategy: item.routeStrategy || "priority",
      complexityLevel: item.complexityLevel || "",
      conditionsText: prettyJson(item.conditions),
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
    const conditions = jsonOrEmptyObject(routeForm.conditionsText, "匹配条件");
    if (conditions == null) return;
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
        toast.success("模型路由已保存");
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
      toast.success("模型路由已删除");
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
      title: "条件",
      dataIndex: "conditions",
      key: "conditions",
      responsive: ["lg"],
      render: (v) => (
        <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(v)}</pre>}>
          <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{shortJson(v)}</span>
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
            <Popconfirm title="删除这条模型路由？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteRoute(item.id)}>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="模型路由"
        desc="维护逻辑模型到上游模型的映射、权重、优先级和运行时选择记录"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshCurrent}>刷新</Button>
            {activeTab === "upstream" && can("model:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateUpstream}>新增上游模型</Button>}
            {activeTab === "routes" && can("model:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRoute}>新增映射</Button>}
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        message="路由映射会优先于模型配置里的旧 JSON routes 生效；未匹配到表结构路由时，后端仍会回退到旧配置。"
      />

      <Segmented
        value={activeTab}
        onChange={(value) => setActiveTab(value as TabKey)}
        options={[
          { value: "routes", label: "路由映射" },
          { value: "upstream", label: "上游模型" },
          { value: "decisions", label: "决策日志" },
        ]}
      />

      {activeTab === "routes" && (
        <>
          <Space wrap>
            <Select
              style={{ minWidth: 320 }}
              placeholder="选择逻辑模型"
              value={selectedModelId || undefined}
              loading={referenceLoading}
              onChange={(v) => setSelectedModelId(v)}
              showSearch
              optionFilterProp="label"
              options={logicalModels.map((m) => ({
                value: m.id,
                label: `${m.name} (${m.modelId})`,
              }))}
            />
            {selectedLogicalModel && (
              <>
                {typeTag(selectedLogicalModel.type)}
                <span style={{ color: "var(--ant-color-text-secondary, #8c8c8c)" }}>
                  当前映射 {routes.length} 条
                </span>
              </>
            )}
          </Space>
          <Table<AiModelRouteVO>
            rowKey="id"
            columns={routeColumns}
            dataSource={routes}
            loading={routesLoading || referenceLoading}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: selectedModelId ? "暂无路由映射" : "请先选择逻辑模型" }}
          />
        </>
      )}

      {activeTab === "upstream" && (
        <Table<AiUpstreamModelVO>
          rowKey="id"
          columns={upstreamColumns}
          dataSource={upstreamModels}
          loading={upstreamLoading}
          pagination={{ pageSize: 15, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "暂无上游模型" }}
        />
      )}

      {activeTab === "decisions" && (
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
      )}

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
        title={editingRouteId ? "编辑路由映射" : "新增路由映射"}
        open={routeOpen}
        onCancel={() => setRouteOpen(false)}
        onOk={saveRoute}
        confirmLoading={routeSaving}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <Alert
            type="info"
            showIcon
            message={selectedLogicalModel ? `当前逻辑模型：${selectedLogicalModel.name} (${selectedLogicalModel.modelId})` : "请先选择逻辑模型"}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="上游模型 *">
              <Select
                style={{ width: "100%" }}
                value={routeForm.upstreamModelId || undefined}
                onChange={(v) => setRouteForm((prev) => ({ ...prev, upstreamModelId: v }))}
                placeholder="请选择上游模型"
                showSearch
                optionFilterProp="label"
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
            <Field label="路由策略">
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
          <Field label="匹配条件 JSON">
            <Input.TextArea rows={5} value={routeForm.conditionsText} onChange={(e) => setRouteForm((prev) => ({ ...prev, conditionsText: e.target.value }))} placeholder='例如：{"region":"cn","maxCost":0.02}' />
          </Field>
        </div>
      </Modal>

      <Modal title="路由决策详情" open={!!decisionDetail} onCancel={() => setDecisionDetail(null)} footer={null} width={760}>
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
