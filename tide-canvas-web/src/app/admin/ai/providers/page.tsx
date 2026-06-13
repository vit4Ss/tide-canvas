"use client";

import { useEffect, useState } from "react";
import { Table, Button, Modal, Input, InputNumber, Select, Tag, Space, Alert, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import type { AiProviderVO } from "@/types/admin";

const PROVIDER_TYPES = [
  { value: "openai", label: "OpenAI" },
  { value: "runware", label: "Runware" },
  { value: "gemini", label: "Google Gemini" },
  { value: "doubao", label: "字节豆包" },
  { value: "qwen", label: "阿里通义" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "minimax", label: "MiniMax" },
  { value: "custom", label: "自定义" },
];

interface ProviderForm {
  name: string;
  providerType: string;
  apiKey: string;
  baseUrl: string;
  priority: number;
  rateLimit: number;
}

const emptyForm: ProviderForm = { name: "", providerType: "openai", apiKey: "", baseUrl: "", priority: 0, rateLimit: 60 };

export default function AdminAiProvidersPage() {
  const [providers, setProviders] = useState<AiProviderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadProviders = async () => {
    try {
      const res = await adminApi.ai.providers.list();
      if (res.success) setProviders(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProviders(); }, []);

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setError(""); setFormOpen(true); };
  const openEdit = (p: AiProviderVO) => {
    setEditingId(p.id);
    setForm({ name: p.name, providerType: p.providerType, apiKey: "", baseUrl: p.baseUrl, priority: p.priority, rateLimit: p.rateLimit });
    setError("");
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.baseUrl) { setError("请填写名称和 Base URL"); return; }
    if (!editingId && !form.apiKey) { setError("新增供应商需填写 API Key"); return; }
    setSaving(true);
    setError("");
    try {
      const res = editingId
        ? await adminApi.ai.providers.update(editingId, { name: form.name, providerType: form.providerType, apiKey: form.apiKey || undefined, baseUrl: form.baseUrl, priority: form.priority, rateLimit: form.rateLimit })
        : await adminApi.ai.providers.create({ name: form.name, providerType: form.providerType, apiKey: form.apiKey, baseUrl: form.baseUrl, priority: form.priority, rateLimit: form.rateLimit });
      if (res.success) { toast.success("已保存"); setFormOpen(false); setForm(emptyForm); setEditingId(null); loadProviders(); }
      else setError(res.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => { await adminApi.ai.providers.delete(id); loadProviders(); };
  const handleToggle = async (p: AiProviderVO) => { await adminApi.ai.providers.update(p.id, { status: p.status === 1 ? 0 : 1 }); loadProviders(); };

  const columns: ColumnsType<AiProviderVO> = [
    { title: "名称", dataIndex: "name", key: "name", render: (v) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: "类型", dataIndex: "providerType", key: "providerType", render: (t: string) => <Tag>{PROVIDER_TYPES.find((x) => x.value === t)?.label || t}</Tag> },
    { title: "Base URL", dataIndex: "baseUrl", key: "baseUrl", responsive: ["md"], ellipsis: true, render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{v}</span> },
    { title: "优先级", dataIndex: "priority", key: "priority", width: 80 },
    { title: "速率", dataIndex: "rateLimit", key: "rateLimit", responsive: ["lg"], render: (v) => `${v} 次/分` },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => s === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag> },
    {
      title: "操作", key: "action", render: (_, p) => (
        <Space size={0}>
          <Button type="text" size="small" onClick={() => handleToggle(p)} style={{ color: p.status === 1 ? "#ef4444" : "#16a34a" }}>{p.status === 1 ? "禁用" : "启用"}</Button>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(p)}>编辑</Button>
          <Popconfirm title={`删除供应商「${p.name}」？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(p.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="AI 供应商管理" desc="管理 AI 服务供应商、API Key 和调用限制" extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增供应商</Button>} />

      <Table<AiProviderVO>
        rowKey="id"
        columns={columns}
        dataSource={providers}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无供应商，点击右上角添加" }}
        pagination={false}
      />

      <Modal title={editingId ? "编辑供应商" : "新增供应商"} open={formOpen} onCancel={() => setFormOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={560}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          {error && <Alert type="error" message={error} showIcon />}
          <Space size="middle" style={{ width: "100%" }} styles={{ item: { flex: 1 } }}>
            <div style={{ flex: 1 }}><div style={{ marginBottom: 6 }}>名称 *</div><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：OpenAI 主账号" /></div>
            <div style={{ flex: 1 }}><div style={{ marginBottom: 6 }}>类型</div><Select style={{ width: "100%" }} value={form.providerType} onChange={(v) => setForm({ ...form, providerType: v })} options={PROVIDER_TYPES} /></div>
          </Space>
          <div><div style={{ marginBottom: 6 }}>API Key {editingId ? <span style={{ color: "#bfbfbf" }}>（留空则不修改）</span> : "*"}</div><Input.Password value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." /></div>
          <div><div style={{ marginBottom: 6 }}>Base URL *</div><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com" /></div>
          <Space size="large">
            <div><div style={{ marginBottom: 6 }}>优先级（越小越优先）</div><InputNumber value={form.priority} onChange={(v) => setForm({ ...form, priority: v ?? 0 })} /></div>
            <div><div style={{ marginBottom: 6 }}>速率限制（次/分钟）</div><InputNumber min={0} value={form.rateLimit} onChange={(v) => setForm({ ...form, rateLimit: v ?? 0 })} /></div>
          </Space>
        </div>
      </Modal>
    </div>
  );
}
