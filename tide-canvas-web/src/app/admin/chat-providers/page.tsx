"use client";

/* ============================================================================
   /admin/chat-providers — AI 聊天的供应商、接入地址与模型。

   主站在这里持有第三方 OpenAI 兼容服务的地址与密钥，直连它们，并按用户实际
   Token 用量从主站积分扣费。和「模型管理 / 创作台」完全分开：这里的任何配置
   都不会影响生成。

   页面参照用户的价格表截图：模型系列标签、供应商倍率卡、输入/输出/缓存三列
   实收价。接入地址和默认定价收进折叠区；行级价格在明确保存的弹窗中编辑。
   人民币仅作计价参考，账单仍使用服务端返回的积分单价。

   三层结构：供应商 → 接入地址（可多组，按顺序尝试，前一组连不上换下一组）
   → 模型（拉取即按默认单价定价并开放，运营再按需改价或收回）。

   页面沿用后台的组件与样式体系（AdminModal / AdminTable / StatusPill /
   confirmDialog），不使用浏览器原生弹窗。
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronUp, Copy, Layers3, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { CHAT_FAMILIES, chatModelFamily, chatRateCNY } from "@/lib/chat-pricing-presentation";
import { ChatPriceEditor } from "./chat-price-editor";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FormGrid,
  ListSkeleton,
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

/** "" and "1" both mean the listed price. */
const atList = (multiplier: string) => {
  const trimmed = multiplier.trim();
  return trimmed === "" || Number(trimmed) === 1;
};

/** 3.5 stays 3.5, 70.0 becomes 70; six decimals like the server. */
function trimZeros(value: number): string {
  return Number(value.toFixed(6)).toString();
}

type Run = (key: string, action: () => Promise<Result>, ok: string) => Promise<void>;

/* ---------------------------------------------------------------- page */

export default function ChatProvidersPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [providers, setProviders] = useState<ChatProviderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<ChatProviderVO | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [family, setFamily] = useState("all");
  const requestRef = useRef(0);
  const mutationRef = useRef(false);

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
    if (mutationRef.current) return;
    mutationRef.current = true;
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
      mutationRef.current = false;
      setBusy("");
    }
  };

  // The selection follows the data: a deleted provider falls back to the first
  // one, and a freshly created provider is selected by the modal.
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  return (
    <div className="adm-page cp-page">
      <div className="cp-family-tabs" role="group" aria-label="模型系列">
        {CHAT_FAMILIES.map((item) => {
          const count = new Set(providers.flatMap((p) => p.models).filter((m) => item.id === "all" || chatModelFamily(m.modelKey) === item.id).map((m) => m.modelKey)).size;
          if (!count && item.id !== "all" && item.id !== family) return null;
          return <button key={item.id} type="button" aria-pressed={family === item.id} onClick={() => setFamily(item.id)}>{item.icon ? <Image src={`/model-icons/${item.icon}.png`} alt="" width={22} height={22} unoptimized /> : <Layers3 size={18} aria-hidden />}<span>{item.label}</span><small>{count}</small></button>;
        })}
      </div>
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

      <div className="cp-split">
        <ProviderNav
          providers={providers}
          loading={loading && providers.length === 0}
          selectedId={selected?.id ?? ""}
          onSelect={setSelectedId}
          onCreate={() => setCreateOpen(true)}
          disabled={!!busy}
        />

        <section className="cp-detail" role="tabpanel" aria-label={selected ? `${selected.name} 的设置` : "供应商设置"}>
          {loading && providers.length === 0 ? (
            <div className="cp-detail-body">
              <TableSkeleton rows={4} />
            </div>
          ) : !selected ? (
            <div className="cp-detail-body cp-detail-empty">
              <AdminEmptyState
                title="还没有供应商"
                description="新增一个 OpenAI 兼容服务，填好接入地址和 API Key，模型列表会随手拉回来。这里的配置只影响 AI 聊天，不影响创作台生成。"
                action={
                  <button type="button" className="adm-btn" onClick={() => setCreateOpen(true)}>
                    <Plus aria-hidden size={14} />
                    新增供应商
                  </button>
                }
              />
            </div>
          ) : (
            <ProviderDetail key={selected.id} provider={selected} family={family} busy={busy} run={run} onAddEndpoint={setAddTarget} />
          )}
        </section>
      </div>

      <CreateProviderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        reload={load}
        onCreated={setSelectedId}
      />
      <AddEndpointModal provider={addTarget} onClose={() => setAddTarget(null)} reload={load} />
    </div>
  );
}

/* ---------------------------------------------------------------- nav */

// The list is the overview: every provider, whether it is on, how many models
// it has open, and whether an address is failing. It answers "is anything
// wrong" before a single detail is read.
function ProviderNav({
  providers,
  loading,
  selectedId,
  onSelect,
  onCreate,
  disabled,
}: {
  providers: ChatProviderVO[];
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  disabled: boolean;
}) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const index = providers.findIndex((p) => p.id === selectedId);
    if (index < 0) return;
    const next = providers[index + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    onSelect(next.id);
    (e.currentTarget.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <aside className="cp-nav">
      <div className="cp-nav-head">
        <h2>
          选择供应商分组
          {providers.length > 0 ? <span className="cp-n">{providers.length}</span> : null}
        </h2>
        <button type="button" className="cp-nav-add" aria-label="新增供应商" title="新增供应商" disabled={disabled} onClick={onCreate}>
          <Plus aria-hidden size={15} />
        </button>
      </div>

      {loading ? (
        <div className="cp-nav-list">
          <ListSkeleton rows={3} height={52} gap={4} />
        </div>
      ) : providers.length === 0 ? (
        <p className="cp-nav-none">还没有供应商</p>
      ) : (
        <div className="cp-nav-list" role="tablist" aria-orientation="horizontal" aria-label="供应商" onKeyDown={onKey}>
          {providers.map((p) => {
            const open = p.models.filter((m) => m.enabled).length;
            const failing = p.endpoints.some((e) => e.enabled && !!e.lastFailure);
            const on = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                data-id={p.id}
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                disabled={disabled}
                className={`cp-nav-item${on ? " on" : ""}${p.enabled ? "" : " is-off"}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="cp-nav-name">{p.name}</span>
                <span className="cp-nav-rate"><b>{p.priceMultiplier.trim() || "1"}</b> ×<small>分组倍率</small></span>
                <span className="cp-nav-sub">
                  {p.models.length > 0 ? (
                    <>
                      <b>{open}</b>/{p.models.length} 开放
                    </>
                  ) : (
                    "没有模型"
                  )}
                  {" · "}
                  {p.endpoints.length} 个地址
                  {!p.enabled ? " · 已停用" : null}
                  {failing ? <em> · 地址失败</em> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------- detail */

function ProviderDetail({
  provider,
  family,
  busy,
  run,
  onAddEndpoint,
}: {
  provider: ChatProviderVO;
  family: string;
  busy: string;
  run: Run;
  onAddEndpoint: (provider: ChatProviderVO) => void;
}) {
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
    <div className={`cp-detail-body${provider.enabled ? "" : " is-off"}`}>


      <div className="cp-billing-banner"><Layers3 size={19} aria-hidden /><div><strong>当前单价：基准单价 × {provider.priceMultiplier.trim() || "1"}</strong><span>计价换算 1 元 = 10 积分 · 费用保留六位小数，账户累计满 1 积分再扣款</span></div></div>
      <ModelSection provider={provider} family={family} busy={busy} run={run} />
      <details className="cp-settings"><summary>接入地址与定价设置 <ChevronDown size={16} aria-hidden /></summary>
      <header className="cp-dhead">
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
        <label className="cp-switch">
          <span>{provider.enabled ? "启用中" : "已停用"}</span>
          <SwitchToggle
            checked={provider.enabled}
            disabled={!!busy}
            onChange={(enabled) =>
              void run(`p-${provider.id}`, () => adminChatProvidersApi.updateProvider(provider.id, { enabled }), enabled ? "已启用" : "已停用")
            }
          />
        </label>
      </header>
      <EndpointSection provider={provider} busy={busy} run={run} onAdd={onAddEndpoint} />
      <PricingSection provider={provider} busy={busy} run={run} />

      {/* A div, not <footer>: the site theme paints a bare <footer> as the black brand strip. */}
      <div className="cp-danger">
        <button type="button" className="adm-btn ghost danger" disabled={!!busy} onClick={() => void remove()}>
          <Trash2 aria-hidden size={14} />
          删除供应商
        </button>
        <small>连同全部接入地址与模型一起删除，已开放的模型会立刻从聊天里消失。</small>
      </div>
      </details>
    </div>
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

/* ---------------------------------------------------------------- sections */

function SectionHead({ title, count, desc, tools }: { title: string; count?: number; desc?: string; tools?: React.ReactNode }) {
  return (
    <div className="cp-sec-head">
      <div className="cp-sec-title">
        <h3>
          {title}
          {count != null && count > 0 ? <span className="cp-n">{count}</span> : null}
        </h3>
        {desc ? <p>{desc}</p> : null}
      </div>
      {tools ? <div className="cp-sec-tools">{tools}</div> : null}
    </div>
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
    <section className="cp-sec" aria-label="接入地址">
      <SectionHead
        title="接入地址"
        count={provider.endpoints.length}
        desc={provider.endpoints.length > 1 ? "调用时按顺序尝试，前一组连不上自动换下一组" : "同一供应商可以配多组地址互为备用"}
        tools={
          <button type="button" className="adm-btn ghost" disabled={!!busy} onClick={() => onAdd(provider)}>
            <Plus aria-hidden size={14} />
            添加地址
          </button>
        }
      />

      {provider.endpoints.length === 0 ? (
        <p className="cp-none">还没有接入地址。添加一组 base_url 和 API Key 后才能拉取模型。</p>
      ) : (
        <ol className="cp-eps">
          {provider.endpoints.map((endpoint, index) => (
            <EndpointRow key={endpoint.id} endpoint={endpoint} index={index} siblings={provider.endpoints} busy={busy} run={run} />
          ))}
        </ol>
      )}
    </section>
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
  const ordered = siblings.length > 1;

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
    <li className={`cp-ep${endpoint.enabled ? "" : " is-off"}`}>
      {ordered ? <span className="cp-ep-order">{index + 1}</span> : null}

      <div className="cp-ep-main">
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
          placeholder="添加备注"
          disabled={!!busy}
          onSave={(label) =>
            void run(`el-`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { label }), "已保存备注")
          }
        />
        {plain ? <span className="cp-warn">http 明文传输，API Key 会在网络上裸露</span> : null}
      </div>

      <div className="cp-ep-key">
        <KeyCell endpoint={endpoint} busy={busy} run={run} />
      </div>

      <div className="cp-ep-health">
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

      <SwitchToggle
        checked={endpoint.enabled}
        aria-label={`启用 ${endpoint.baseUrl}`}
        onChange={(enabled) =>
          void run(`es-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { enabled }), enabled ? "已启用" : "已停用")
        }
      />

      <div className="rowacts cp-ep-acts">
        {ordered ? (
          <>
            <button type="button" aria-label="上移，更早被尝试" disabled={!!busy || index === 0} onClick={() => move(-1)}>
              <ChevronUp aria-hidden size={14} />
            </button>
            <button type="button" aria-label="下移，更晚被尝试" disabled={!!busy || index === siblings.length - 1} onClick={() => move(1)}>
              <ChevronDown aria-hidden size={14} />
            </button>
          </>
        ) : null}
        <button type="button" className="danger" aria-label="删除此地址" disabled={!!busy} onClick={() => void remove()}>
          <Trash2 aria-hidden size={14} />
        </button>
      </div>
    </li>
  );
}

// The credential never comes back from the server, so at rest the row only
// says whether one is saved. Replacing it is a deliberate step: a field appears
// on request, saves on Enter or blur, and disappears again.
function KeyCell({ endpoint, busy, run }: { endpoint: ChatEndpointVO; busy: string; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");

  const commit = () => {
    const next = key.trim();
    setEditing(false);
    setKey("");
    if (!next) return;
    void run(`e-${endpoint.id}`, () => adminChatProvidersApi.updateEndpoint(endpoint.id, { apiKey: next }), "已更新 API Key");
  };

  if (editing) {
    return (
      <span className="cp-key-edit">
        <input
          type="password"
          autoComplete="off"
          autoFocus
          aria-label="新的 API Key，回车保存"
          placeholder="粘贴新 Key，回车保存"
          value={key}
          disabled={!!busy}
          onChange={(e) => setKey(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setKey("");
              setEditing(false);
            }
          }}
        />
      </span>
    );
  }

  return (
    <span className="cp-key">
      <span className={endpoint.hasApiKey ? "" : "is-warn"}>{endpoint.hasApiKey ? "密钥已设置" : "未设置密钥"}</span>
      <button type="button" className="cp-linkbtn" disabled={!!busy} onClick={() => setEditing(true)}>
        {endpoint.hasApiKey ? "替换" : "设置"}
      </button>
    </span>
  );
}

/* ---------------------------------------------------------------- pricing rules */

// Default price and multiplier for one provider, as two settings rows. Saved
// together when focus leaves the editor with something changed: the default is
// copied into this provider's unpriced models (the server reports how many),
// the multiplier scales every model's listed price at sale time.
function PricingSection({ provider, busy, run }: { provider: ChatProviderVO; busy: string; run: Run }) {
  const fallback = provider.fallbackPricing;
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
  const factor = Number(multiplier);
  const validFactor = !atList(multiplier) && Number.isFinite(factor) && factor > 0;
  // Blank fields mean the built-in default, so the preview prices that.
  const effectiveInput = draft.input.trim() || fallback.inputPointsPerMillion;
  const effectiveOutput = draft.output.trim() || fallback.outputPointsPerMillion;
  const preview = validFactor ? `${trimZeros(Number(effectiveInput) * factor)} / ${trimZeros(Number(effectiveOutput) * factor)}` : "";

  return (
    <section className="cp-sec" aria-label="定价规则">
      <SectionHead title="定价规则" desc="用户看到的和账单记的都是实收价：各模型单价 × 倍率" />

      <div
        className="cp-rules"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
        }}
      >
        <div className="cp-rule">
          <div className="cp-rule-label">
            <span>默认单价</span>
            <small>留空按内置默认 {fallback.inputPointsPerMillion} / {fallback.outputPointsPerMillion}；拉取和开放时补价的模型都用它</small>
          </div>
          <div className="cp-rule-ctl">
            <label className="cp-num">
              <input inputMode="decimal" value={draft.input} disabled={!!busy} placeholder={fallback.inputPointsPerMillion} onChange={(e) => setDraft({ ...draft, input: e.target.value })} onKeyDown={onKey} />
              <span>输入</span>
            </label>
            <label className="cp-num">
              <input inputMode="decimal" value={draft.output} disabled={!!busy} placeholder={fallback.outputPointsPerMillion} onChange={(e) => setDraft({ ...draft, output: e.target.value })} onKeyDown={onKey} />
              <span>输出</span>
            </label>
            <span className="cp-unit">积分 / 1M Token</span>
          </div>
        </div>

        <div className="cp-rule">
          <div className="cp-rule-label">
            <span>倍率</span>
            <small>0.7 即按原价七折结算，留空按原价</small>
          </div>
          <div className="cp-rule-ctl">
            <label className="cp-num">
              <input inputMode="decimal" value={draft.multiplier} disabled={!!busy} placeholder="1" onChange={(e) => setDraft({ ...draft, multiplier: e.target.value })} onKeyDown={onKey} />
            </label>
            <span className="cp-unit">
              {preview ? (
                <>
                  按当前默认单价实收 <b>{preview}</b>
                </>
              ) : validFactor ? (
                `各模型按原价 × ${multiplier} 结算`
              ) : (
                "按原价结算"
              )}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- models */

type ModelFilter = "all" | "open" | "unpriced";

function ModelSection({ provider, family, busy, run }: { provider: ChatProviderVO; family: string; busy: string; run: Run }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ModelFilter>("all");
  const [showReference, setShowReference] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingModel = provider.models.find((m) => m.id === editingId);

  const fetchModels = () =>
    void run(
      `f-${provider.id}`,
      async () => {
        const res = await adminChatProvidersApi.fetchModels(provider.id);
        if (res.success && res.data) {
          toast.info(`上游共 ${res.data.total} 个模型，新增 ${res.data.added} 个${res.data.filled ? `，补价并开放 ${res.data.filled} 个` : ""}`);
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

  const categoryModels = useMemo(() => provider.models.filter((m) => family === "all" || chatModelFamily(m.modelKey) === family), [provider.models, family]);
  const counts = useMemo(() => {
    const open = categoryModels.filter((m) => m.enabled).length;
    const unpriced = categoryModels.filter((m) => !m.pricing).length;
    const ready = categoryModels.filter((m) => !m.enabled && !m.priceError).length;
    return { open, unpriced, ready };
  }, [categoryModels]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return provider.models.filter((m) => {
      if (family !== "all" && chatModelFamily(m.modelKey) !== family) return false;
      if (filter === "open" && !m.enabled) return false;
      if (filter === "unpriced" && m.pricing) return false;
      if (!needle) return true;
      return m.modelKey.toLowerCase().includes(needle) || (m.name || "").toLowerCase().includes(needle);
    });
  }, [provider.models, query, filter, family]);

  // Bulk open/close run as one action so the page reloads once, in order, and
  // stop at the first refusal so the operator sees which row the server rejected.
  const setAll = async (enabled: boolean) => {
    const targets = categoryModels.filter((m) => (enabled ? !m.enabled && !m.priceError : m.enabled));
    if (!targets.length) return;
    const ok = await confirmDialog({
      title: enabled ? `开放 ${targets.length} 个模型` : `收回 ${targets.length} 个模型`,
      message: enabled
        ? "开放后用户立刻能在聊天里选到这些模型，并按各自的实收价计费。尚未定价的会先按默认单价定价。"
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
    ? provider.endpoints.length === 0 ? "先添加一组接入地址，再从供应商拉取模型。" : "点「拉取模型」把上游的模型列表拉回来。"
    : "没有匹配的模型，换个关键词或筛选试试。";

  const desc = provider.models.length === 0
    ? "拉到的模型按默认单价定价并开放，默认接受图片"
    : counts.unpriced > 0
      ? `${counts.unpriced} 个尚未定价，开放时会按默认单价定价`
      : counts.open > 0
        ? `${counts.open} 个已开放给用户`
        : "都已定价，还没有开放";

  return (
    <section className="cp-sec cp-sec-models" aria-label="模型">
      <SectionHead
        title={`${CHAT_FAMILIES.find((item) => item.id === family)?.label || "模型"}价格列表`}
        count={rows.length}
        desc={desc}
        tools={
          <button type="button" className="adm-btn ghost" disabled={!!busy || provider.endpoints.length === 0} onClick={fetchModels}>
            <RefreshCw aria-hidden size={14} />
            拉取模型
          </button>
        }
      />

      {provider.models.length > 0 ? (
        <div className="cp-model-tools">
          <div className="adm-search cp-model-search">
            <Search size={14} aria-hidden />
            <input aria-label="搜索模型" placeholder="搜索模型名或 key" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="adm-segment" role="group" aria-label="筛选模型">
            {([
              ["all", "全部", categoryModels.length],
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
            <label className="cp-show-reference"><input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} />显示参考价</label>
            {counts.ready > 0 ? (
              <button type="button" className="adm-btn" disabled={!!busy} onClick={() => void setAll(true)}>
                开放全部
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

      {provider.models.length === 0 ? (
        <p className="cp-none">{emptyText}</p>
      ) : (
      <>
      <div className="cp-rate-unit">¥ / 1M Tokens <span>实际扣费积分同时展示；参考价来自定价截图，非实时官方报价</span></div>
      <p className="cp-table-scroll-hint">左右滑动查看完整价格与管理操作</p>
      <div className="cp-models-wrap">
        <AdminTable<ChatModelVO>
          className="cp-models"
          label={`${provider.name} 的模型`}
          rows={rows}
          rowKey={(m) => m.id}
          pageSize={20}
          empty={<AdminEmptyState title="没有匹配的模型" description={emptyText} />}
          columns={[
            {
              header: "模型",
              cell: (m) => <ModelNameCell model={m} busy={busy} run={run} />,
            },
            ...([
              ["输入价格", "inputPointsPerMillion"],
              ["输出价格", "outputPointsPerMillion"],
              ["缓存读取", "cachedInputPointsPerMillion"],
            ] as const).map(([header, field]) => ({
              header, width: "160px", align: "right" as const,
              cell: (m: ChatModelVO) => <TokenRate model={m} field={field} showReference={showReference} />,
            })),
            {
              header: <span title="是否接受用户传图">图片</span>,
              width: "84px",
              align: "center",
              cell: (m) => (
                <SwitchToggle
                  checked={m.vision}
                  disabled={!!busy}
                  aria-label={`${m.name || m.modelKey} 是否接受图片`}
                  onChange={(vision) => void run(`mv-${m.id}`, () => adminChatProvidersApi.updateModel(m.id, { vision }), "已保存")}
                />
              ),
            },
            {
              header: <span title="未定价的模型开放时按默认单价定价">开放</span>,
              width: "84px",
              align: "center",
              cell: (m) => (
                <span className="cp-open" title={m.priceError && !m.enabled ? "单价无效，先修正再开放" : !m.pricing ? "开放时按默认单价定价" : undefined}>
                  <SwitchToggle
                    checked={m.enabled}
                    disabled={!!busy || (!!m.priceError && !m.enabled)}
                    aria-label={`${m.name || m.modelKey} 是否开放给用户`}
                    onChange={(enabled) =>
                      void run(`me-${m.id}`, () => adminChatProvidersApi.updateModel(m.id, { enabled }), enabled ? "已开放" : "已收回")
                    }
                  />
                </span>
              ),
            },
            {
              header: "管理",
              width: "126px",
              align: "right",
              cell: (m) => (
                <div className="cp-model-actions">
                  <button type="button" className="cp-edit-price" disabled={!!busy} onClick={() => setEditingId(m.id)} aria-label={`修改 ${m.name || m.modelKey} 的单价`}><Pencil size={13} aria-hidden />编辑价格</button>
                  <button type="button" className="cp-remove-model" aria-label={`删除 ${m.modelKey}`} disabled={!!busy} onClick={() => void removeModel(m)}>
                    <Trash2 aria-hidden size={14} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>
      </>
      )}
      {editingModel && <ChatPriceEditor key={editingModel.id} model={editingModel} multiplier={provider.priceMultiplier} disabled={!!busy} onClose={() => setEditingId(null)} save={async (pricing) => {
        let saved = false;
        await run(`mp-${editingModel.id}`, async () => { const res = await adminChatProvidersApi.updateModel(editingModel.id, { pricing: { tokenPricing: pricing } }); saved = res.success; return res; }, "已保存单价");
        return saved;
      }} />}
    </section>
  );
}

function ModelNameCell({ model, busy, run }: { model: ChatModelVO; busy: string; run: Run }) {
  const icon = CHAT_FAMILIES.find((item) => item.id === chatModelFamily(model.modelKey))?.icon;
  return (
    <div className="cp-model-identity"><span className="cp-model-logo">{icon ? <Image src={`/model-icons/${icon}.png`} alt="" width={24} height={24} unoptimized /> : <Layers3 size={21} aria-hidden />}</span>
    <div className="cp-model">
      <InlineText
        label="模型显示名"
        className="cp-model-name"
        value={model.name}
        placeholder={model.modelKey}
        disabled={!!busy}
        onSave={(name) => void run(`mn-${model.id}`, () => adminChatProvidersApi.updateModel(model.id, { name }), "已重命名")}
      />
      {model.name || model.rivals > 0 ? (
        <span className="cp-model-sub">
          {model.name ? <code className="cp-model-key">{model.modelKey}</code> : null}
          <button type="button" className="cp-copy-key" aria-label={`复制 ${model.modelKey}`} onClick={async () => { try { await navigator.clipboard.writeText(model.modelKey); toast.success("已复制模型 ID"); } catch { toast.error("复制失败，请手动选择模型 ID"); } }}><Copy size={12} aria-hidden /></button>
          {model.rivals > 0 ? (
            model.preferred ? (
              <span title={`另有 ${model.rivals} 家供应商提供这个模型，首选失败时依次切换`}>
                <StatusPill tone="blue">首选</StatusPill>
              </span>
            ) : (
              <button
                type="button"
                className="cp-linkbtn"
                disabled={!!busy}
                title={model.pricing && model.enabled ? "目前作为备用，首选失败时才会用到" : "开放并定价后才能参与切换"}
                onClick={() => void run(`mf-${model.id}`, () => adminChatProvidersApi.preferModel(model.id), "已设为首选供应商")}
              >
                设为首选
              </button>
            )
          ) : null}
        </span>
      ) : null}
    </div>
    </div>
  );
}

function TokenRate({ model, field, showReference }: { model: ChatModelVO; field: "inputPointsPerMillion" | "outputPointsPerMillion" | "cachedInputPointsPerMillion"; showReference: boolean }) {
  const value = model.effectivePricing?.[field] ?? (field === "cachedInputPointsPerMillion" ? model.effectivePricing?.inputPointsPerMillion : undefined);
  const reference = model.referencePricing?.[field];
  if (value === undefined) return <span className="cp-rate-unavailable">{model.priceError || "未配置有效单价"}</span>;
  return <div className="cp-token-rate"><strong>¥{chatRateCNY(value)}</strong><span>{value} 积分</span>{showReference && reference !== undefined && <small>参考 ¥{chatRateCNY(reference)}</small>}</div>;
}

/* ---------------------------------------------------------------- modals */

// One step creates a usable provider: name it, give it its first address, and
// the model list comes back in the same save. A provider with no address is
// a dead end, so the address is offered here rather than left for later.
function CreateProviderModal({
  open,
  onClose,
  reload,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  reload: () => Promise<void>;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [defaultInput, setDefaultInput] = useState("");
  const [defaultOutput, setDefaultOutput] = useState("");
  const [multiplier, setMultiplier] = useState("2");

  const reset = () => {
    setName("");
    setRemark("");
    setBaseUrl("");
    setApiKey("");
    setLabel("");
    setDefaultInput("");
    setDefaultOutput("");
    setMultiplier("2");
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
            toast.success(`已新增供应商，拉到 ${fetched.data.total} 个模型，已按默认单价定价并开放`);
          } else {
            toast.info(`已新增供应商和接入地址；拉取模型失败：${fetched.message || "请稍后重试"}`);
          }
        }
      }
      onCreated(created.data.id);
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
      subtitle="一个 OpenAI 兼容服务。地址可以现在填，也可以建好后再添加；只影响 AI 聊天，不影响创作台生成"
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
        <Field label="默认输入单价" span={2} hint="积分 / 1M Token，留空按内置默认">
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
