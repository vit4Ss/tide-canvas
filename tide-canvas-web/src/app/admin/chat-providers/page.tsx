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

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, RefreshCw, Trash2 } from "lucide-react";
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

  const reset = () => {
    setName("");
    setRemark("");
    setBaseUrl("");
    setApiKey("");
    setLabel("");
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
    try {
      const created = await adminChatProvidersApi.createProvider({ name: trimmedName, remark: remark.trim() });
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
            toast.success(`已新增供应商，拉到 ${fetched.data.total} 个模型；填好单价后即可开放`);
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
        <div className="cp-meta">
          <span>
            <strong>{provider.endpoints.length}</strong> 个接入地址
          </span>
          <span>
            <strong>{open}</strong> / {provider.models.length} 个模型开放
          </span>
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

      <EndpointSection provider={provider} busy={busy} run={run} onAdd={onAddEndpoint} />
      <ModelSection provider={provider} busy={busy} run={run} />
    </section>
  );
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
        <div className="cp-addr-sub">
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

function ModelSection({ provider, busy, run }: { provider: ChatProviderVO; busy: string; run: Run }) {
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

      <AdminTable<ChatModelVO>
        className="cp-models"
        label={`${provider.name} 的模型`}
        rows={provider.models}
        rowKey={(m) => m.id}
        pageSize={20}
        empty={
          <AdminEmptyState
            title="还没有模型"
            description={provider.endpoints.length === 0 ? "先添加一组接入地址，再从供应商拉取模型。" : "点「从供应商拉取模型」把上游的模型列表拉回来。"}
          />
        }
        columns={[
          {
            header: "模型",
            cell: (m) => <ModelNameCell model={m} busy={busy} run={run} />,
          },
          {
            header: (
              <>
                单价
                <small className="cp-th-hint">积分 / 1M Token，输入 / 输出</small>
              </>
            ),
            width: "232px",
            cell: (m) => <PriceCell model={m} busy={busy} run={run} />,
          },
          {
            header: (
              <>
                图片
                <small className="cp-th-hint">关闭时聊天里不能传图</small>
              </>
            ),
            width: "112px",
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
            width: "112px",
            align: "center",
            cell: (m) => (
              <div className="cp-open">
                <SwitchToggle
                  checked={m.enabled}
                  disabled={!m.pricing && !m.enabled}
                  aria-label={`${m.name || m.modelKey} 是否开放给用户`}
                  onChange={(enabled) =>
                    void run(`me-${m.id}`, () => adminChatProvidersApi.updateModel(m.id, { enabled }), enabled ? "已开放" : "已收回")
                  }
                />
                {!m.pricing ? <small>先填单价</small> : null}
              </div>
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
    </div>
  );
}

// The price editor holds a draft of the four numbers and saves the set when a
// field loses focus with something changed. Saving on every blur would fire a
// request per Tab press; saving only on change keeps it to the edits.
function PriceCell({ model, busy, run }: { model: ChatModelVO; busy: string; run: Run }) {
  const saved = model.pricing ?? emptyPricing();
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<ChatTokenPricing>(saved);
  const [seen, setSeen] = useState(savedKey);
  if (seen !== savedKey) {
    setSeen(savedKey);
    setDraft(saved);
  }

  const commit = () => {
    if (JSON.stringify(draft) === savedKey) return;
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

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="cp-price" onBlur={(e) => {
      // Commit once when focus leaves the whole editor, not per field.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
    }}>
      <div className="cp-price-row">
        <input
          inputMode="decimal"
          aria-label="输入单价，积分每百万 Token"
          value={draft.inputPointsPerMillion}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, inputPointsPerMillion: e.target.value })}
          onKeyDown={onKey}
          placeholder="输入"
        />
        <span className="cp-sep">/</span>
        <input
          inputMode="decimal"
          aria-label="输出单价，积分每百万 Token"
          value={draft.outputPointsPerMillion}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, outputPointsPerMillion: e.target.value })}
          onKeyDown={onKey}
          placeholder="输出"
        />
      </div>
      <div className="cp-price-row cp-price-limits">
        <span className="cp-unit">上限</span>
        <input
          type="number"
          min={1}
          aria-label="单次输入 Token 上限"
          value={draft.maxInputTokens ?? 131072}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, maxInputTokens: Number(e.target.value) })}
          onKeyDown={onKey}
        />
        <span className="cp-sep">/</span>
        <input
          type="number"
          min={1}
          aria-label="单次输出 Token 上限"
          value={draft.maxOutputTokens ?? 8192}
          disabled={!!busy}
          onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) })}
          onKeyDown={onKey}
        />
      </div>
    </div>
  );
}
