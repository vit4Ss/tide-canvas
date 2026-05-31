"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { AiProviderVO } from "@/types/admin";
import { Plus, Trash2, Edit, Save, Zap, Globe } from "lucide-react";

const PROVIDER_TYPES = [
  { value: "openai", label: "OpenAI" },
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
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const res = await adminApi.ai.providers.list();
      if (res.success) setProviders(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProviders(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.baseUrl) return;
    setSaving(true);
    try {
      if (editingId) {
        const res = await adminApi.ai.providers.update(editingId, {
          name: form.name, providerType: form.providerType, apiKey: form.apiKey || undefined,
          baseUrl: form.baseUrl, priority: form.priority, rateLimit: form.rateLimit,
        });
        if (res.success) { setEditingId(null); setForm(emptyForm); loadProviders(); }
      } else {
        if (!form.apiKey) return;
        const res = await adminApi.ai.providers.create({
          name: form.name, providerType: form.providerType, apiKey: form.apiKey,
          baseUrl: form.baseUrl, priority: form.priority, rateLimit: form.rateLimit,
        });
        if (res.success) { setShowForm(false); setForm(emptyForm); loadProviders(); }
      }
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除供应商「${name}」？`)) return;
    await adminApi.ai.providers.delete(id);
    loadProviders();
  };

  const handleToggleStatus = async (p: AiProviderVO) => {
    await adminApi.ai.providers.update(p.id, { status: p.status === 1 ? 0 : 1 });
    loadProviders();
  };

  const startEdit = (p: AiProviderVO) => {
    setEditingId(p.id);
    setShowForm(false);
    setForm({ name: p.name, providerType: p.providerType, apiKey: "", baseUrl: p.baseUrl, priority: p.priority, rateLimit: p.rateLimit });
  };

  const isFormOpen = showForm || editingId !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI 供应商管理</h2>
          <p className="mt-1 text-sm text-neutral-500">管理 AI 服务供应商、API Key 和调用限制</p>
        </div>
        {!isFormOpen && (
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900">
            <Plus className="h-4 w-4" /> 新增供应商
          </button>
        )}
      </div>

      {isFormOpen && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 className="font-semibold">{editingId ? "编辑供应商" : "新增供应商"}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">名称 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：OpenAI 主账号"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900" />
            </div>
            <div>
              <label className="block text-sm font-medium">类型</label>
              <select value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.target.value })}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                {PROVIDER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">
                API Key *{editingId && <span className="font-normal text-neutral-400">（留空则不修改）</span>}
              </label>
              <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} type="password"
                placeholder="sk-..."
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900" />
            </div>
            <div>
              <label className="block text-sm font-medium">Base URL *</label>
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.openai.com"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900" />
            </div>
            <div>
              <label className="block text-sm font-medium">优先级</label>
              <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              <p className="mt-1 text-xs text-neutral-400">数字越小优先级越高</p>
            </div>
            <div>
              <label className="block text-sm font-medium">速率限制（次/分钟）</label>
              <input type="number" value={form.rateLimit} onChange={(e) => setForm({ ...form, rateLimit: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900">
              <Save className="h-4 w-4" /> {saving ? "保存中..." : "保存"}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
              className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : providers.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700">
          <div className="text-center">
            <Globe className="mx-auto h-10 w-10 text-neutral-300" />
            <p className="mt-3 text-neutral-400">暂无供应商</p>
            <p className="text-sm text-neutral-400">点击上方按钮添加第一个 AI 供应商</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div key={p.id} className="rounded-xl border border-neutral-200 bg-white p-5 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-700">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${p.status === 1 ? "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400" : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"}`}>
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{p.name}</h3>
                      <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                        {PROVIDER_TYPES.find((t) => t.value === p.providerType)?.label || p.providerType}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 1 ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"}`}>
                        {p.status === 1 ? "启用" : "禁用"}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-sm text-neutral-500">{p.baseUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleToggleStatus(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${p.status === 1 ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" : "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"}`}>
                    {p.status === 1 ? "禁用" : "启用"}
                  </button>
                  <button onClick={() => startEdit(p)} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                    <Edit className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(p.id, p.name)} className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex gap-6 border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800">
                <span>优先级: <strong className="text-neutral-700 dark:text-neutral-300">{p.priority}</strong></span>
                <span>速率限制: <strong className="text-neutral-700 dark:text-neutral-300">{p.rateLimit} 次/分</strong></span>
                <span>创建时间: {p.createTime ? new Date(p.createTime).toLocaleDateString("zh-CN") : "-"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
