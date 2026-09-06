"use client";

/* ============================================================================
   /admin/chat-providers — AI 聊天的供应商、接入地址与模型。

   主站在这里持有第三方 OpenAI 兼容服务的地址与密钥，直连它们，并按用户实际
   Token 用量从主站积分扣费。和「模型管理 / 创作台」完全分开：这里的任何配置
   都不会影响生成。

   一个供应商可配多组地址，调用时按顺序尝试，前一组连不上就换下一组。
   拉取到的模型默认未开放，填好每百万 Token 单价后才能开放给用户。
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  Field,
  FormGrid,
  Panel,
  SwitchToggle,
  TableSkeleton,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { adminChatProvidersApi } from "@/lib/admin-chat-providers-api";
import type {
  ChatEndpointVO,
  ChatModelVO,
  ChatProviderVO,
  ChatTokenPricing,
} from "@/types/admin-chat-providers";
import "./chat-providers.css";

const MASK = "••••••••";

const emptyPricing = (): ChatTokenPricing => ({
  enabled: true,
  inputPointsPerMillion: "",
  outputPointsPerMillion: "",
  cachedInputPointsPerMillion: "",
  maxInputTokens: 131072,
  maxOutputTokens: 8192,
});

function fmtTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

export default function ChatProvidersPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [providers, setProviders] = useState<ChatProviderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    setLoading(true);
    try {
      if (!(await ensureSession())) return;
      const res = await adminChatProvidersApi.list();
      if (id !== requestRef.current) return;
      if (!res.success || !res.data) {
        setError(res.message || "读取供应商失败");
        return;
      }
      setProviders(res.data);
      setError("");
    } catch {
      if (id === requestRef.current) setError("读取供应商失败，请稍后重试");
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => {
      cancelAnimationFrame(frame);
      requestRef.current += 1;
    };
  }, [load]);

  // run wraps every mutation: one in flight at a time, refresh on success, and
  // the server's own message on failure (it explains what was wrong with the
  // address, the credential or the price).
  const run = async (key: string, action: () => Promise<{ success: boolean; message?: string }>, ok: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const res = await action();
      if (!res.success) {
        toast.error(res.message || "操作失败");
        return;
      }
      toast.success(ok);
      await load();
    } catch {
      toast.error("操作失败，请稍后重试");
    } finally {
      setBusy("");
    }
  };

  const addProvider = () => {
    const name = window.prompt("供应商名称（如 OpenAI 官方 / DeepSeek / 某中转站）");
    if (!name?.trim()) return;
    void run("new-provider", () => adminChatProvidersApi.createProvider({ name: name.trim() }), "已新增供应商");
  };

  return (
    <div className="adm-page">
      <AdminAlert tone="info" title="这里只影响 AI 聊天">
        主站用这里的地址和密钥直连第三方服务，并按用户实际 Token 用量扣主站积分。创作台生成与「模型管理」不读取这些配置。
        密钥加密保存，保存后不再回显。
      </AdminAlert>

      {error ? (
        <AdminAlert
          tone="error"
          title="供应商数据加载失败"
          action={
            <button type="button" className="adm-btn ghost" onClick={() => void load()}>
              <RefreshCw aria-hidden size={14} />
              重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      <Panel
        title="AI 聊天供应商"
        sub="一个供应商可配多组接入地址，调用时按顺序尝试，前一组连不上自动换下一组"
        tools={
          <button type="button" className="adm-btn" onClick={addProvider} disabled={!!busy}>
            <Plus aria-hidden size={14} />
            新增供应商
          </button>
        }
      >
        {loading ? (
          <TableSkeleton rows={3} />
        ) : providers.length === 0 ? (
          <AdminEmptyState title="还没有供应商" description="新增一个供应商，填好它的接入地址和 API Key，再拉取模型列表。" />
        ) : (
          <div className="cp-list">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} busy={busy} run={run} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

type Run = (key: string, action: () => Promise<{ success: boolean; message?: string }>, ok: string) => Promise<void>;

// InlineText is the page's editing idiom for a single value: it reads as text,
// commits on blur or Enter, and reverts on Escape. It saves only when the value
// actually changed, so tabbing through a row does not fire a request per field.
function InlineText({
  value,
  onSave,
  className = "",
  placeholder,
  label,
  disabled,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  placeholder?: string;
  label: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // A reload replaces the row, and the field must follow it rather than keep a
  // stale draft. Reconciling during render is how React wants props-derived
  // state adjusted; an effect here would fight the lint rule and flash.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  const commit = () => {
    const next = draft.trim();
    if (next === value.trim()) {
      setDraft(value);
      return;
    }
    onSave(next);
  };

  return (
    <input
      className={`cp-inline ${className}`.trim()}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function ProviderCard({ provider, busy, run }: { provider: ChatProviderVO; busy: string; run: Run }) {
  return (
    <section className="cp-provider">
      <header>
        <div>
          <InlineText
            label="供应商名称"
            className="cp-name"
            value={provider.name}
            disabled={!!busy}
            onSave={(name) => {
              if (!name) {
                toast.error("供应商名称不能为空");
                return;
              }
              void run(`pn-${provider.id}`, () => adminChatProvidersApi.updateProvider(provider.id, { name }), "已重命名");
            }}
          />
          <InlineText
            label="供应商备注"
            className="cp-remark"
            value={provider.remark}
            placeholder="备注（可留空）"
            disabled={!!busy}
            onSave={(remark) =>
              void run(`pr-${provider.id}`, () => adminChatProvidersApi.updateProvider(provider.id, { remark }), "已保存备注")
            }
          />
          <p>
            {provider.endpoints.length} 个接入地址 · {provider.models.filter((m) => m.enabled).length} /{" "}
            {provider.models.length} 个模型已开放
          </p>
        </div>
        <label className="cp-switch">
          <span>启用</span>
          <SwitchToggle
            checked={provider.enabled}
            onChange={(enabled) =>
              void run(`p-${provider.id}`, () => adminChatProvidersApi.updateProvider(provider.id, { enabled }), enabled ? "已启用" : "已停用")
            }
          />
        </label>
        <button
          type="button"
          className="adm-btn ghost danger"
          disabled={!!busy}
          onClick={() => {
            if (!window.confirm(`删除供应商「${provider.name}」及其全部地址与模型？`)) return;
            void run(`pd-${provider.id}`, () => adminChatProvidersApi.deleteProvider(provider.id), "已删除供应商");
          }}
        >
          <Trash2 aria-hidden size={14} />
          删除
        </button>
      </header>

      <EndpointList provider={provider} busy={busy} run={run} />
      <ModelList provider={provider} busy={busy} run={run} />
    </section>
  );
}

function EndpointList({ provider, busy, run }: { provider: ChatProviderVO; busy: string; run: Run }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");

  const add = () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      toast.error("请填写接入地址和 API Key");
      return;
    }
    void run(
      `e-new-${provider.id}`,
      () =>
        adminChatProvidersApi.createEndpoint(provider.id, {
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          label: label.trim(),
          sortOrder: provider.endpoints.length,
        }),
      "已新增接入地址",
    ).then(() => {
      setBaseUrl("");
      setApiKey("");
      setLabel("");
    });
  };

  return (
    <div className="cp-section">
      <h4>接入地址</h4>
      {provider.endpoints.length === 0 ? (
        <p className="cp-none">还没有接入地址，填一组后才能拉取模型。</p>
      ) : (
        <table className="cp-table">
          <thead>
            <tr>
              <th>顺序 / 备注</th>
              <th>地址</th>
              <th>密钥</th>
              <th>最近状态</th>
              <th>启用</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {provider.endpoints.map((endpoint, index) => (
              <EndpointRow
                key={endpoint.id}
                endpoint={endpoint}
                index={index}
                siblings={provider.endpoints}
                busy={busy}
                run={run}
              />
            ))}
          </tbody>
        </table>
      )}

      <FormGrid>
        <Field label="接入地址" span={2} hint="https 开头，可带路径前缀，不要写到 /v1 之后">
          <input inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com" />
        </Field>
        <Field label="API Key" hint="保存后不再回显">
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </Field>
        <Field label="备注" hint="如「主用」「备用」">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="可留空" />
        </Field>
      </FormGrid>
      <button type="button" className="adm-btn ghost" onClick={add} disabled={!!busy}>
        <Plus aria-hidden size={14} />
        添加这组地址
      </button>
    </div>
  );
}

function EndpointRow({
  endpoint,
  index,
  siblings,
  busy,
  run,
}: {
  endpoint: ChatEndpointVO;
  index: number;
  siblings: ChatEndpointVO[];
  busy: string;
  run: Run;
}) {
  const [key, setKey] = useState("");

  // Order is failover order, so it has to be changeable without deleting the
  // address and typing its credential again. Swapping two rows takes two saves;
  // they run inside one action so the list refreshes once, already in order.
  const move = (delta: number) => {
    const other = siblings[index + delta];
    if (!other) return;
    void run(
      `em-${endpoint.id}`,
      async () => {
        const first = await adminChatProvidersApi.updateEndpoint(endpoint.id, { sortOrder: index + delta });
        if (!first.success) return first;
        return adminChatProvidersApi.updateEndpoint(other.id, { sortOrder: index });
      },
      "已调整顺序",
    );
  };

  return (
    <tr>
      <td>
        <div className="cp-order">
          <strong>#{index + 1}</strong>
          <button
            type="button"
            className="cp-move"
            aria-label="上移，更早被尝试"
            disabled={!!busy || index === 0}
            onClick={() => move(-1)}
          >
            <ChevronUp aria-hidden size={14} />
          </button>
          <button
            type="button"
            className="cp-move"
            aria-label="下移，更晚被尝试"
            disabled={!!busy || index === siblings.length - 1}
            onClick={() => move(1)}
          >
            <ChevronDown aria-hidden size={14} />
          </button>
        </div>
        <InlineText
          label="接入地址备注"
          className="cp-remark"
          value={endpoint.label}
          placeholder="备注"
          disabled={!!busy}
          onSave={(label) =>
            void run(`el-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { label }), "已保存备注")
          }
        />
      </td>
      <td>
        <InlineText
          label="接入地址"
          className="mono"
          value={endpoint.baseUrl}
          disabled={!!busy}
          onSave={(baseUrl) => {
            if (!baseUrl) {
              toast.error("接入地址不能为空");
              return;
            }
            void run(`eu-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { baseUrl }), "已更新接入地址");
          }}
        />
      </td>
      <td>
        <input
          type="password"
          autoComplete="off"
          className="cp-key"
          value={key}
          placeholder={endpoint.hasApiKey ? MASK : "未设置"}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => {
            if (!key.trim()) return;
            void run(
              `e-${endpoint.id}`,
              () => adminChatProvidersApi.updateEndpoint(endpoint.id, { apiKey: key.trim() }),
              "已更新 API Key",
            ).then(() => setKey(""));
          }}
        />
      </td>
      <td>
        {endpoint.lastFailure ? (
          <span className="cp-bad">
            {endpoint.lastFailure}
            <small>{fmtTime(endpoint.lastFailedAt)}</small>
          </span>
        ) : endpoint.lastOkAt ? (
          <span className="cp-ok">
            正常
            <small>{fmtTime(endpoint.lastOkAt)}</small>
          </span>
        ) : (
          <span className="cp-idle">尚未调用</span>
        )}
      </td>
      <td>
        <SwitchToggle
          checked={endpoint.enabled}
          onChange={(enabled) =>
            void run(`es-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { enabled }), enabled ? "已启用" : "已停用")
          }
        />
      </td>
      <td>
        <button
          type="button"
          className="adm-btn ghost danger"
          disabled={!!busy}
          onClick={() => {
            if (!window.confirm(`删除接入地址 ${endpoint.baseUrl}？`)) return;
            void run(`ed-${endpoint.id}`, () => adminChatProvidersApi.deleteEndpoint(endpoint.id), "已删除接入地址");
          }}
        >
          <Trash2 aria-hidden size={14} />
        </button>
      </td>
    </tr>
  );
}

function ModelList({ provider, busy, run }: { provider: ChatProviderVO; busy: string; run: Run }) {
  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <h4>模型</h4>
        <button
          type="button"
          className="adm-btn ghost"
          disabled={!!busy || provider.endpoints.length === 0}
          onClick={() =>
            void run(`f-${provider.id}`, async () => {
              const res = await adminChatProvidersApi.fetchModels(provider.id);
              if (res.success && res.data) {
                toast.info(`上游共 ${res.data.total} 个模型，新增 ${res.data.added} 个`);
              }
              return res;
            }, "已拉取模型列表")
          }
        >
          <RefreshCw aria-hidden size={14} />
          从供应商拉取模型
        </button>
      </div>
      {provider.models.length === 0 ? (
        <p className="cp-none">还没有模型。填好接入地址后点「从供应商拉取模型」。</p>
      ) : (
        <table className="cp-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>输入 / 输出 积分每 1M Token</th>
              <th>Token 上限</th>
              <th>图片</th>
              <th>开放</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {provider.models.map((m) => (
              <ModelRow key={m.id} model={m} busy={busy} run={run} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ModelRow({ model, busy, run }: { model: ChatModelVO; busy: string; run: Run }) {
  const [draft, setDraft] = useState<ChatTokenPricing>(model.pricing ?? emptyPricing());
  const priced = !!model.pricing;

  const savePricing = () => {
    if (!draft.inputPointsPerMillion.trim() || !draft.outputPointsPerMillion.trim()) {
      toast.error("请填写输入和输出单价");
      return;
    }
    void run(
      `mp-${model.id}`,
      () => adminChatProvidersApi.updateModel(model.id, { pricing: { tokenPricing: { ...draft, enabled: true } } }),
      "已保存单价",
    );
  };

  return (
    <tr>
      <td>
        <InlineText
          label="模型显示名"
          className="cp-name"
          value={model.name}
          placeholder={model.modelKey}
          disabled={!!busy}
          onSave={(name) =>
            void run(`mn-${model.id}`, () => adminChatProvidersApi.updateModel(model.id, { name }), "已重命名")
          }
        />
        <small className="mono">{model.modelKey}</small>
        {model.priceError ? <small className="cp-bad">{model.priceError}</small> : null}
      </td>
      <td>
        <div className="cp-price">
          <input
            inputMode="decimal"
            aria-label="输入积分每百万 Token"
            value={draft.inputPointsPerMillion}
            onChange={(e) => setDraft({ ...draft, inputPointsPerMillion: e.target.value })}
            onBlur={savePricing}
            placeholder="输入"
          />
          <span>/</span>
          <input
            inputMode="decimal"
            aria-label="输出积分每百万 Token"
            value={draft.outputPointsPerMillion}
            onChange={(e) => setDraft({ ...draft, outputPointsPerMillion: e.target.value })}
            onBlur={savePricing}
            placeholder="输出"
          />
        </div>
      </td>
      <td>
        <div className="cp-price">
          <input
            type="number"
            min={1}
            aria-label="单次输入 Token 上限"
            value={draft.maxInputTokens ?? 131072}
            onChange={(e) => setDraft({ ...draft, maxInputTokens: Number(e.target.value) })}
            onBlur={savePricing}
          />
          <span>/</span>
          <input
            type="number"
            min={1}
            aria-label="单次输出 Token 上限"
            value={draft.maxOutputTokens ?? 8192}
            onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })}
            onBlur={savePricing}
          />
        </div>
      </td>
      <td>
        <SwitchToggle
          checked={model.vision}
          onChange={(vision) => void run(`mv-${model.id}`, () => adminChatProvidersApi.updateModel(model.id, { vision }), "已保存")}
        />
      </td>
      <td>
        <SwitchToggle
          checked={model.enabled}
          disabled={!priced && !model.enabled}
          onChange={(enabled) =>
            void run(`me-${model.id}`, () => adminChatProvidersApi.updateModel(model.id, { enabled }), enabled ? "已开放" : "已收回")
          }
        />
        {!priced ? <small className="cp-idle">先填单价</small> : null}
      </td>
      <td>
        <button
          type="button"
          className="adm-btn ghost danger"
          disabled={!!busy}
          onClick={() => {
            if (!window.confirm(`删除模型 ${model.modelKey}？`)) return;
            void run(`md-${model.id}`, () => adminChatProvidersApi.deleteModel(model.id), "已删除模型");
          }}
        >
          <Trash2 aria-hidden size={14} />
        </button>
      </td>
    </tr>
  );
}
