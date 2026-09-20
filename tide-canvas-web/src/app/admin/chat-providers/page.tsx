"use client";

/* ============================================================================
   /admin/chat-providers — AI 聊天的供应商、接入地址与模型。

   主站在这里持有第三方 OpenAI 兼容服务的地址与密钥，直连它们，并按用户实际
   Token 用量从主站积分扣费。和「模型管理 / 创作台」完全分开：这里的任何配置
   都不会影响生成。

   三层结构：供应商 → 接入地址（可多组，按顺序尝试，前一组连不上换下一组）
   → 模型（拉取后默认未开放，填好每百万 Token 单价才能开放）。

   页面沿用后台的组件与样式体系（AdminModal / AdminTable / StatusPill /
   confirmDialog），不使用浏览器原生弹窗。
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FormGrid,
  Panel,
  StatusPill,
  SwitchToggle,
  TableSkeleton,
} from "@/components/admin";
import { confirmDialog } from "@/components/shared/confirm";
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
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("zh-CN", { hour12: false });
}

type Result = { success: boolean; message?: string };

/** Human-readable multiplier: "" and "1" both mean the listed price. */
const atList = (multiplier: string) => {
  const trimmed = multiplier.trim();
  return trimmed === "" || Number(trimmed) === 1;
};
type Run = (key: string, action: () => Promise<Result>, ok: string) => Promise<void>;

export default function ChatProvidersPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [providers, setProviders] = useState<ChatProviderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<ChatProviderVO | null>(null);
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
  const run: Run = async (key, action, ok) => {
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
          <button type="button" className="adm-btn" onClick={() => setCreateOpen(true)} disabled={!!busy}>
            <Plus aria-hidden size={14} />
            新增供应商
          </button>
        }
      >
        {loading ? (
          <TableSkeleton rows={3} />
        ) : providers.length === 0 ? (
          <AdminEmptyState
            title="还没有供应商"
            description="新增一个供应商，填好它的接入地址和 API Key，页面会顺手把模型列表拉回来。"
            action={
              <button type="button" className="adm-btn" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden size={14} />
                新增供应商
              </button>
            }
          />
        ) : (
          <div className="cp-list">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} busy={busy} run={run} onAddEndpoint={setAddTarget} />
            ))}
          </div>
        )}
      </Panel>

      <CreateProviderModal open={createOpen} onClose={() => setCreateOpen(false)} reload={load} />
      <AddEndpointModal provider={addTarget} onClose={() => setAddTarget(null)} reload={load} />
    </div>
  );
}

/* ---------------------------------------------------------------- modals */

// One step creates a usable provider: name it, give it its first address, and
// the model list comes back in the same save. A provider with no address is
// a dead end, so the address is offered here rather than left for later.
function CreateProviderModal({ open, onClose, reload }: { open: boolean; onClose: () => void; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [defaultInput, setDefaultInput] = useState("");
  const [defaultOutput, setDefaultOutput] = useState("");
  const [multiplier, setMultiplier] = useState("");

  const reset = () => {
    setName("");
    setRemark("");
    setBaseUrl("");
    setApiKey("");
    setLabel("");
    setDefaultInput("");
    setDefaultOutput("");
    setMultiplier("");
  };

  const save = async (): Promise<boolean> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("请填写供应商名称");
      return false;
    }
    const url = baseUrl.trim();
    const key = apiKey.trim();
    if ((url && !key) || (!url && key)) {
      toast.error("接入地址和 API Key 要一起填，或都留空稍后再加");
      return false;
    }
    const input = defaultInput.trim();
    const output = defaultOutput.trim();
    if ((input && !output) || (!input && output)) {
      toast.error("默认单价要同时填输入和输出，或都留空");
      return false;
    }
    try {
      const created = await adminChatProvidersApi.createProvider({
        name: trimmedName,
        remark: remark.trim(),
        defaultPricing: input ? { tokenPricing: { ...emptyPricing(), inputPointsPerMillion: input, outputPointsPerMillion: output } } : null,
        priceMultiplier: multiplier.trim(),
      });
      if (!created.success || !created.data) {
        toast.error(created.message || "创建供应商失败");
        return false;
      }
      if (!url) {
        toast.success("已新增供应商，接下来添加一组接入地址");
      } else {
        const endpoint = await adminChatProvidersApi.createEndpoint(created.data.id, { baseUrl: url, apiKey: key, label: label.trim() });
        if (!endpoint.success) {
          toast.error(endpoint.message || "供应商已创建，但接入地址未能保存，请在列表里补填");
        } else {
          const fetched = await adminChatProvidersApi.fetchModels(created.data.id);
          if (fetched.success && fetched.data) {
            toast.success(input ? `已新增供应商，拉到 ${fetched.data.total} 个模型，已按默认单价定价；打开「开放」即可` : `已新增供应商，拉到 ${fetched.data.total} 个模型；填好单价后即可开放`);
          } else {
            toast.info(`已新增供应商和接入地址；拉取模型失败：${fetched.message || "请稍后重试"}`);
          }
        }
      }
      await reload();
      reset();
      return true;
    } catch {
      toast.error("操作失败，请稍后重试");
      return false;
    }
  };

  return (
    <AdminModal
      open={open}
      size="md"
      title="新增供应商"
      subtitle="一个 OpenAI 兼容服务；地址可以现在填，也可以建好后在列表里添加"
      saveLabel="创建"
      onClose={() => {
        reset();
        onClose();
      }}
      onSave={save}
    >
      <FormGrid>
        <Field label="供应商名称" required span={2} hint="如 OpenAI 官方 / DeepSeek / 某中转站">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="备注" span={2}>
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可留空" />
        </Field>
        <Field label="接入地址" span={4} hint="http 或 https 开头。供应商文档里的 base_url 直接粘贴即可，带不带 /v1 都行">
          <input inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>
        <Field label="API Key" span={2} hint="加密保存，之后只显示是否已设置">
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </Field>
        <Field label="地址备注" span={2} hint="如「主用」「备用」">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="可留空" />
        </Field>
        <Field label="默认输入单价" span={2} hint="积分 / 1M Token，拉到的模型自动使用">
          <input inputMode="decimal" value={defaultInput} onChange={(e) => setDefaultInput(e.target.value)} placeholder="可留空" />
        </Field>
        <Field label="默认输出单价" span={2} hint="积分 / 1M Token">
          <input inputMode="decimal" value={defaultOutput} onChange={(e) => setDefaultOutput(e.target.value)} placeholder="可留空" />
        </Field>
        <Field label="倍率" span={2} hint="实收 = 单价 × 倍率；0.7 即七折，留空按原价">
          <input inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} placeholder="1" />
        </Field>
      </FormGrid>
    </AdminModal>
  );
}

function AddEndpointModal({ provider, onClose, reload }: { provider: ChatProviderVO | null; onClose: () => void; reload: () => Promise<void> }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");

  const reset = () => {
    setBaseUrl("");
    setApiKey("");
    setLabel("");
  };

  const save = async (): Promise<boolean> => {
    if (!provider) return true;
    if (!baseUrl.trim() || !apiKey.trim()) {
      toast.error("请填写接入地址和 API Key");
      return false;
    }
    try {
      const res = await adminChatProvidersApi.createEndpoint(provider.id, {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        label: label.trim(),
        sortOrder: provider.endpoints.length,
      });
      if (!res.success) {
        toast.error(res.message || "创建接入地址失败");
        return false;
      }
      toast.success("已添加接入地址");
      await reload();
      reset();
      return true;
    } catch {
      toast.error("操作失败，请稍后重试");
      return false;
    }
  };

  return (
    <AdminModal
      open={!!provider}
      size="md"
      title={provider ? `为「${provider.name}」添加接入地址` : "添加接入地址"}
      subtitle="同一供应商可以配多组地址互为备用，调用时按顺序尝试"
      saveLabel="添加"
      onClose={() => {
        reset();
        onClose();
      }}
      onSave={save}
    >
      <FormGrid>
        <Field label="接入地址" required span={4} hint="http 或 https 开头。供应商文档里的 base_url 直接粘贴即可，带不带 /v1 都行">
          <input inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" autoFocus />
        </Field>
        <Field label="API Key" required span={2} hint="加密保存，之后只显示是否已设置">
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </Field>
        <Field label="备注" span={2} hint="如「主用」「备用」">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="可留空" />
        </Field>
      </FormGrid>
    </AdminModal>
  );
}

/* ---------------------------------------------------------------- inline edit */

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
  // state adjusted.
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

/* ---------------------------------------------------------------- provider */

function ProviderCard({
  provider,
  busy,
  run,
  onAddEndpoint,
}: {
  provider: ChatProviderVO;
  busy: string;
  run: Run;
  onAddEndpoint: (provider: ChatProviderVO) => void;
}) {
  const open = provider.models.filter((m) => m.enabled).length;

  const remove = async () => {
    const ok = await confirmDialog({
      title: "删除供应商",
      message: `删除「${provider.name}」及其全部接入地址与模型？已开放给用户的模型会立刻从聊天里消失。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    void run(`pd-${provider.id}`, () => adminChatProvidersApi.deleteProvider(provider.id), "已删除供应商");
  };

  return (
    <section className={`cp-provider${provider.enabled ? "" : " is-off"}`} aria-label={provider.name}>
      <header className="cp-head">
        <div className="cp-ident">
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
            placeholder="添加备注"
            disabled={!!busy}
            onSave={(remark) =>
              void run(`pr-${provider.id}`, () => adminChatProvidersApi.updateProvider(provider.id, { remark }), "已保存备注")
            }
          />
        </div>
        <div className="cp-meta" aria-label="概况">
          <span>
            <strong>{provider.endpoints.length}</strong> 个地址
          </span>
          <span className={open > 0 ? "is-live" : ""}>
            <strong>{open}</strong> / {provider.models.length} 开放
          </span>
          {!atList(provider.priceMultiplier) ? (
            <span>
              倍率 <strong>{provider.priceMultiplier.trim()}</strong>
            </span>
          ) : null}
        </div>
        <div className="cp-acts">
          <label className="cp-switch">
            <span>{provider.enabled ? "启用中" : "已停用"}</span>
            <SwitchToggle
              checked={provider.enabled}
              onChange={(enabled) =>
                void run(`p-${provider.id}`, () => adminChatProvidersApi.updateProvider(provider.id, { enabled }), enabled ? "已启用" : "已停用")
              }
            />
          </label>
          <button type="button" className="adm-btn ghost danger" disabled={!!busy} onClick={() => void remove()}>
            <Trash2 aria-hidden size={14} />
            删除
          </button>
        </div>
      </header>

      <PricingRulesSection provider={provider} busy={busy} run={run} />
      <EndpointSection provider={provider} busy={busy} run={run} onAdd={onAddEndpoint} />
      <ModelSection provider={provider} busy={busy} run={run} />
    </section>
  );
}

/* ---------------------------------------------------------------- pricing rules */

// Default price and multiplier for one provider. Saved together when focus
// leaves the editor with something changed: the default is copied into this
// provider's unpriced models (the server reports how many), the multiplier
// scales every model's listed price at sale time.
function PricingRulesSection({ provider, busy, run }: { provider: ChatProviderVO; busy: string; run: Run }) {
  const saved = {
    input: provider.defaultPricing?.inputPointsPerMillion ?? "",
    output: provider.defaultPricing?.outputPointsPerMillion ?? "",
    multiplier: provider.priceMultiplier ?? "",
  };
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [seen, setSeen] = useState(savedKey);
  if (seen !== savedKey) {
    setSeen(savedKey);
    setDraft(saved);
  }

  const commit = () => {
    if (JSON.stringify(draft) === savedKey) return;
    const input = draft.input.trim();
    const output = draft.output.trim();
    if ((input && !output) || (!input && output)) {
      toast.error("默认单价要同时填输入和输出，或都留空");
      return;
    }
    const defaultPricing = input
      ? { tokenPricing: { ...(provider.defaultPricing ?? emptyPricing()), enabled: true, inputPointsPerMillion: input, outputPointsPerMillion: output } }
      : null;
    void run(
      `pp-${provider.id}`,
      async () => {
        const res = await adminChatProvidersApi.updateProvider(provider.id, { defaultPricing, priceMultiplier: draft.multiplier.trim() });
        const filled = res.success ? Number((res.data as { filled?: number } | undefined)?.filled ?? 0) : 0;
        if (filled > 0) toast.info(`默认单价已填入 ${filled} 个尚未定价的模型`);
        return res;
      },
      "已保存定价规则",
    );
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  const multiplier = draft.multiplier.trim();
  const preview = !atList(multiplier) && draft.input.trim() && draft.output.trim() && Number.isFinite(Number(multiplier)) && Number(multiplier) > 0
    ? `${trimZeros(Number(draft.input) * Number(multiplier))} / ${trimZeros(Number(draft.output) * Number(multiplier))}`
    : "";

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <h4>定价规则</h4>
      </div>
      <div
        className="cp-rules"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
        }}
      >
        <label className="cp-field">
          <span>默认输入单价</span>
          <input inputMode="decimal" value={draft.input} disabled={!!busy} placeholder="积分 / 1M" onChange={(e) => setDraft({ ...draft, input: e.target.value })} onKeyDown={onKey} />
        </label>
        <label className="cp-field">
          <span>默认输出单价</span>
          <input inputMode="decimal" value={draft.output} disabled={!!busy} placeholder="积分 / 1M" onChange={(e) => setDraft({ ...draft, output: e.target.value })} onKeyDown={onKey} />
        </label>
        <label className="cp-field">
          <span>倍率</span>
          <input inputMode="decimal" value={draft.multiplier} disabled={!!busy} placeholder="1" onChange={(e) => setDraft({ ...draft, multiplier: e.target.value })} onKeyDown={onKey} />
        </label>
        <p className="cp-rules-note">
          默认单价会自动填给新拉取和尚未定价的模型，已填过的不动。实收 = 各模型单价 × 倍率，0.7 即按原价七折结算；用户看到的和账单记的都是实收价。
          {preview ? <> 按当前默认单价，实收 <b>{preview}</b>。</> : null}
        </p>
      </div>
    </div>
  );
}

/** 3.5 stays 3.5, 70.0 becomes 70; six decimals like the server. */
function trimZeros(value: number): string {
  return Number(value.toFixed(6)).toString();
}

/* ---------------------------------------------------------------- endpoints */

function EndpointSection({
  provider,
  busy,
  run,
  onAdd,
}: {
  provider: ChatProviderVO;
  busy: string;
  run: Run;
  onAdd: (provider: ChatProviderVO) => void;
}) {
  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <h4>
          接入地址
          <span className="cp-n">{provider.endpoints.length}</span>
        </h4>
        <button type="button" className="adm-btn ghost" disabled={!!busy} onClick={() => onAdd(provider)}>
          <Plus aria-hidden size={14} />
          添加地址
        </button>
      </div>

      {provider.endpoints.length === 0 ? (
        <p className="cp-none">还没有接入地址。添加一组 base_url 和 API Key 后才能拉取模型。</p>
      ) : (
        <div className="cp-endpoints" role="list" aria-label="接入地址">
          <div className="cp-endpoint cp-endpoint-cols" aria-hidden>
            <span>顺序</span>
            <span>地址</span>
            <span>API Key</span>
            <span>最近状态</span>
            <span>启用</span>
            <span />
          </div>
          {provider.endpoints.map((endpoint, index) => (
            <EndpointRow key={endpoint.id} endpoint={endpoint} index={index} siblings={provider.endpoints} busy={busy} run={run} />
          ))}
        </div>
      )}
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

  const remove = async () => {
    const ok = await confirmDialog({
      title: "删除接入地址",
      message: `删除 ${endpoint.baseUrl}？它保存的 API Key 会一并删除。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    void run(`ed-${endpoint.id}`, () => adminChatProvidersApi.deleteEndpoint(endpoint.id), "已删除接入地址");
  };

  const plain = endpoint.baseUrl.startsWith("http://");

  return (
    <div className="cp-endpoint" role="listitem">
      <div className="cp-order">
        <strong>#{index + 1}</strong>
        <span className="cp-move-group">
          <button type="button" className="cp-move" aria-label="上移，更早被尝试" disabled={!!busy || index === 0} onClick={() => move(-1)}>
            <ChevronUp aria-hidden size={13} />
          </button>
          <button
            type="button"
            className="cp-move"
            aria-label="下移，更晚被尝试"
            disabled={!!busy || index === siblings.length - 1}
            onClick={() => move(1)}
          >
            <ChevronDown aria-hidden size={13} />
          </button>
        </span>
      </div>

      <div className="cp-addr">
        <InlineText
          label="接入地址"
          className="cp-url"
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
        <InlineText
          label="接入地址备注"
          className="cp-label"
          value={endpoint.label}
          placeholder="备注"
          disabled={!!busy}
          onSave={(label) =>
            void run(`el-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { label }), "已保存备注")
          }
        />
        {plain ? <span className="cp-warn">http 明文传输，API Key 会在网络上裸露</span> : null}
      </div>

      <div className="cp-keycell">
        <input
          type="password"
          autoComplete="off"
          className="cp-key"
          aria-label="API Key，输入新值并离开即保存"
          value={key}
          placeholder={endpoint.hasApiKey ? MASK : "未设置"}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => {
            if (!key.trim()) return;
            void run(`e-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { apiKey: key.trim() }), "已更新 API Key").then(() =>
              setKey(""),
            );
          }}
        />
        <small>{endpoint.hasApiKey ? "已设置，输入新值可替换" : "尚未设置"}</small>
      </div>

      <div className="cp-health">
        {endpoint.lastFailure ? (
          <>
            <StatusPill tone="red">失败</StatusPill>
            <small title={endpoint.lastFailure}>
              {endpoint.lastFailure}
              {fmtTime(endpoint.lastFailedAt) ? ` · ${fmtTime(endpoint.lastFailedAt)}` : ""}
            </small>
          </>
        ) : endpoint.lastOkAt ? (
          <>
            <StatusPill tone="green">正常</StatusPill>
            <small>{fmtTime(endpoint.lastOkAt)}</small>
          </>
        ) : (
          <>
            <StatusPill tone="gray">尚未调用</StatusPill>
            <small>还没有请求经过这里</small>
          </>
        )}
      </div>

      <div className="cp-toggle">
        <SwitchToggle
          checked={endpoint.enabled}
          aria-label="启用此地址"
          onChange={(enabled) =>
            void run(`es-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { enabled }), enabled ? "已启用" : "已停用")
          }
        />
      </div>

      <div className="cp-rowact">
        <button type="button" className="adm-btn ghost danger cp-icon" aria-label="删除此地址" disabled={!!busy} onClick={() => void remove()}>
          <Trash2 aria-hidden size={14} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- models */

type ModelFilter = "all" | "open" | "unpriced";

function ModelSection({ provider, busy, run }: { provider: ChatProviderVO; busy: string; run: Run }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ModelFilter>("all");

  const fetchModels = () =>
    void run(
      `f-${provider.id}`,
      async () => {
        const res = await adminChatProvidersApi.fetchModels(provider.id);
        if (res.success && res.data) {
          toast.info(`上游共 ${res.data.total} 个模型，新增 ${res.data.added} 个`);
        }
        return res;
      },
      "已拉取模型列表",
    );

  const removeModel = async (model: ChatModelVO) => {
    const ok = await confirmDialog({
      title: "删除模型",
      message: `删除 ${model.modelKey}？正在用它聊天的用户下次同步后将看不到这个模型。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    void run(`md-${model.id}`, () => adminChatProvidersApi.deleteModel(model.id), "已删除模型");
  };

  const counts = useMemo(() => {
    const open = provider.models.filter((m) => m.enabled).length;
    const unpriced = provider.models.filter((m) => !m.pricing).length;
    const ready = provider.models.filter((m) => m.pricing && !m.enabled).length;
    return { open, unpriced, ready };
  }, [provider.models]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return provider.models.filter((m) => {
      if (filter === "open" && !m.enabled) return false;
      if (filter === "unpriced" && m.pricing) return false;
      if (!needle) return true;
      return m.modelKey.toLowerCase().includes(needle) || (m.name || "").toLowerCase().includes(needle);
    });
  }, [provider.models, query, filter]);

  // Bulk open/close run as one action so the page reloads once, in order, and
  // stop at the first refusal so the operator sees which row the server rejected.
  const setAll = async (enabled: boolean) => {
    const targets = provider.models.filter((m) => (enabled ? m.pricing && !m.enabled : m.enabled));
    if (!targets.length) return;
    const ok = await confirmDialog({
      title: enabled ? `开放 ${targets.length} 个模型` : `收回 ${targets.length} 个模型`,
      message: enabled
        ? "开放后用户立刻能在聊天里选到这些模型，并按各自的实收价计费。未定价的模型不会被开放。"
        : "收回后这些模型立刻从用户的模型列表里消失，进行中的对话不受影响。",
      confirmText: enabled ? "全部开放" : "全部收回",
      danger: !enabled,
    });
    if (!ok) return;
    void run(
      `ma-${provider.id}`,
      async () => {
        let done = 0;
        for (const m of targets) {
          const res = await adminChatProvidersApi.updateModel(m.id, { enabled });
          if (!res.success) {
            if (done) toast.info(`前 ${done} 个已${enabled ? "开放" : "收回"}，在 ${m.modelKey} 处停止`);
            return res;
          }
          done++;
        }
        return { success: true };
      },
      enabled ? `已开放 ${targets.length} 个模型` : `已收回 ${targets.length} 个模型`,
    );
  };

  const emptyText = provider.models.length === 0
    ? provider.endpoints.length === 0 ? "先添加一组接入地址，再从供应商拉取模型。" : "点「从供应商拉取模型」把上游的模型列表拉回来。"
    : "没有匹配的模型，换个关键词或筛选试试。";

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <h4>
          模型
          <span className="cp-n">{provider.models.length}</span>
        </h4>
        <button type="button" className="adm-btn ghost" disabled={!!busy || provider.endpoints.length === 0} onClick={fetchModels}>
          <RefreshCw aria-hidden size={14} />
          从供应商拉取模型
        </button>
      </div>

      {provider.models.length > 0 ? (
        <div className="cp-model-tools">
          <div className="adm-search cp-model-search">
            <Search size={14} aria-hidden />
            <input aria-label="搜索模型" placeholder="搜索模型名或 key" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="adm-segment" role="group" aria-label="筛选模型">
            {([
              ["all", "全部", provider.models.length],
              ["open", "已开放", counts.open],
              ["unpriced", "未定价", counts.unpriced],
            ] as const).map(([key, label, n]) => (
              <button key={key} type="button" className={`adm-chip${filter === key ? " on" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
                <small>{n}</small>
              </button>
            ))}
          </div>
          <div className="cp-model-bulk">
            {counts.ready > 0 ? (
              <button type="button" className="adm-btn" disabled={!!busy} onClick={() => void setAll(true)}>
                开放全部已定价
                <small>{counts.ready}</small>
              </button>
            ) : null}
            {counts.open > 0 ? (
              <button type="button" className="adm-btn ghost" disabled={!!busy} onClick={() => void setAll(false)}>
                收回全部
                <small>{counts.open}</small>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <AdminTable<ChatModelVO>
        className="cp-models"
        label={`${provider.name} 的模型`}
        rows={rows}
        rowKey={(m) => m.id}
        pageSize={20}
        empty={<AdminEmptyState title={provider.models.length === 0 ? "还没有模型" : "没有匹配的模型"} description={emptyText} />}
        columns={[
          {
            header: "模型",
            cell: (m) => <ModelNameCell model={m} busy={busy} run={run} />,
          },
          {
            header: (
              <>
                定价
                <small className="cp-th-hint">积分 / 1M Token · 点击修改</small>
              </>
            ),
            width: "400px",
            cell: (m) => <PriceCell model={m} multiplier={provider.priceMultiplier} busy={busy} run={run} />,
          },
          {
            header: (
              <>
                图片
                <small className="cp-th-hint">关闭则不能传图</small>
              </>
            ),
            width: "88px",
            align: "center",
            cell: (m) => (
              <SwitchToggle
                checked={m.vision}
                aria-label={`${m.name || m.modelKey} 是否接受图片`}
                onChange={(vision) => void run(`mv-${m.id}`, () => adminChatProvidersApi.updateModel(m.id, { vision }), "已保存")}
              />
            ),
          },
          {
            header: "开放",
            width: "80px",
            align: "center",
            cell: (m) => (
              <span className="cp-open" title={!m.pricing && !m.enabled ? "先填写单价才能开放" : undefined}>
                <SwitchToggle
                  checked={m.enabled}
                  disabled={!m.pricing && !m.enabled}
                  aria-label={`${m.name || m.modelKey} 是否开放给用户`}
                  onChange={(enabled) =>
                    void run(`me-${m.id}`, () => adminChatProvidersApi.updateModel(m.id, { enabled }), enabled ? "已开放" : "已收回")
                  }
                />
              </span>
            ),
          },
          {
            header: "",
            width: "48px",
            align: "right",
            cell: (m) => (
              <button type="button" className="adm-btn ghost danger cp-icon" aria-label={`删除 ${m.modelKey}`} disabled={!!busy} onClick={() => void removeModel(m)}>
                <Trash2 aria-hidden size={14} />
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

function ModelNameCell({ model, busy, run }: { model: ChatModelVO; busy: string; run: Run }) {
  return (
    <div className="cp-model">
      <InlineText
        label="模型显示名"
        className="cp-model-name"
        value={model.name}
        placeholder={model.modelKey}
        disabled={!!busy}
        onSave={(name) => void run(`mn-${model.id}`, () => adminChatProvidersApi.updateModel(model.id, { name }), "已重命名")}
      />
      <code className="cp-model-key">{model.modelKey}</code>
      {model.priceError ? <span className="cp-warn">{model.priceError}</span> : null}
      {model.rivals > 0 ? (
        <div className="cp-rival">
          {model.preferred ? (
            <>
              <StatusPill tone="blue">首选</StatusPill>
              <small>另有 {model.rivals} 家供应商提供，首选失败时依次切换</small>
            </>
          ) : (
            <>
              <button
                type="button"
                className="adm-btn ghost cp-prefer"
                disabled={!!busy}
                onClick={() => void run(`mf-${model.id}`, () => adminChatProvidersApi.preferModel(model.id), "已设为首选供应商")}
              >
                设为首选
              </button>
              <small>{model.pricing && model.enabled ? "目前作为备用，首选失败时才会用到" : "开放并定价后才能参与切换"}</small>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// The price reads as text until the operator clicks it: a table of seventeen
// rows must not be seventeen rows of input boxes. The editor holds a draft of
// the four numbers and saves the set once when focus leaves it with something
// changed; Escape drops the draft.
function PriceCell({ model, multiplier, busy, run }: { model: ChatModelVO; multiplier: string; busy: string; run: Run }) {
  const saved = model.pricing ?? emptyPricing();
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<ChatTokenPricing>(saved);
  const [seen, setSeen] = useState(savedKey);
  const [editing, setEditing] = useState(false);
  if (seen !== savedKey) {
    setSeen(savedKey);
    setDraft(saved);
    setEditing(false);
  }

  const commit = () => {
    if (JSON.stringify(draft) === savedKey) {
      setEditing(false);
      return;
    }
    if (!draft.inputPointsPerMillion.trim() || !draft.outputPointsPerMillion.trim()) {
      toast.error("请填写输入和输出单价");
      return;
    }
    setEditing(false);
    void run(
      `mp-${model.id}`,
      () => adminChatProvidersApi.updateModel(model.id, { pricing: { tokenPricing: { ...draft, enabled: true } } }),
      "已保存单价",
    );
  };

  const cancel = () => {
    setDraft(saved);
    setEditing(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const scaled = model.effectivePricing && !atList(multiplier) ? model.effectivePricing : null;

  if (!editing) {
    if (!model.pricing) {
      return (
        <div className="cp-price-view is-empty">
          <button type="button" className="adm-btn ghost cp-price-fill" disabled={!!busy} onClick={() => setEditing(true)}>
            <Pencil aria-hidden size={13} />
            填写单价
          </button>
          {model.priceError ? <span className="cp-warn">{model.priceError}</span> : <small>未定价的模型不能开放</small>}
        </div>
      );
    }
    return (
      <button type="button" className="cp-price-view" disabled={!!busy} aria-label={`修改 ${model.name || model.modelKey} 的单价`} onClick={() => setEditing(true)}>
        <span className="cp-price-main">
          <b>{model.pricing.inputPointsPerMillion}</b>
          <i>/</i>
          <b>{model.pricing.outputPointsPerMillion}</b>
          <small>积分 / 1M</small>
          <Pencil aria-hidden size={12} className="cp-price-pen" />
        </span>
        <span className="cp-price-sub">
          {scaled ? (
            <>
              实收 <em>{scaled.inputPointsPerMillion}</em> / <em>{scaled.outputPointsPerMillion}</em>
              <span aria-hidden> · </span>
            </>
          ) : null}
          上限 {(model.pricing.maxInputTokens ?? 131072).toLocaleString()} / {(model.pricing.maxOutputTokens ?? 8192).toLocaleString()}
        </span>
      </button>
    );
  }

  return (
    <div
      className="cp-price"
      onBlur={(e) => {
        // Commit once when focus leaves the whole editor, not per field.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
      }}
    >
      <label className="cp-field">
        <span>输入单价</span>
        <input
          inputMode="decimal"
          autoFocus
          value={draft.inputPointsPerMillion}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, inputPointsPerMillion: e.target.value })}
          onKeyDown={onKey}
          placeholder="必填"
        />
      </label>
      <label className="cp-field">
        <span>输出单价</span>
        <input
          inputMode="decimal"
          value={draft.outputPointsPerMillion}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, outputPointsPerMillion: e.target.value })}
          onKeyDown={onKey}
          placeholder="必填"
        />
      </label>
      <label className="cp-field cp-field-limit">
        <span>输入上限</span>
        <input
          type="number"
          min={1}
          value={draft.maxInputTokens ?? 131072}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, maxInputTokens: Number(e.target.value) })}
          onKeyDown={onKey}
        />
      </label>
      <label className="cp-field cp-field-limit">
        <span>输出上限</span>
        <input
          type="number"
          min={1}
          value={draft.maxOutputTokens ?? 8192}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })}
          onKeyDown={onKey}
        />
      </label>
      <p className="cp-price-hint">
        {scaled ? <>实收 <b>{scaled.inputPointsPerMillion}</b> / <b>{scaled.outputPointsPerMillion}</b> · 倍率 {multiplier.trim()} · </> : null}
        回车或移开焦点保存，Esc 取消
      </p>
    </div>
  );
}
