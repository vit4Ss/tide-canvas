"use client";

/* ============================================================================
   /admin/email — 邮件配置.

   Faithful port of admin.js V.email(), now wired to the REAL backend (full CRUD
   on templates AND developer API keys):
     GET/POST/PUT/DELETE /api/admin/email/templates
     GET/POST/PUT/DELETE /api/admin/email/api-keys

     - KPI strip (邮件模板 / 启用模板 / API 密钥 / 启用密钥) — 由真实列表派生。
     - 邮件模板: filterChips(全部 / html / text by type) + 新建模板; table
       (模板 / 类型 / 触发场景 / 变量 / 状态[开关] / 操作[编辑·删除]) → tplModal.
     - API 密钥: 新建密钥; table (名称 / Key / 权限 / 日上限 / 状态[开关] /
       操作[编辑·删除]) → keyModal.

   原「SMTP 服务/发送策略」面板展示的是假配置，已移除
   （真实邮件配置在 配置管理 → mail 分组）。

   Client component: filter state, template/key modals, switch toggles,
   loading/empty states.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Mail,
  Plus,
  ShieldAlert,
} from "lucide-react";
import {
  AdminModal,
  AdminTable,
  Field,
  FilterChips,
  FormCard,
  FormGrid,
  FormSection,
  Panel,
  RowActions,
  SectionHeader,
  StatusPill,
  SwitchToggle,
  type Column,
  type StatusPillProps,
  TableSkeleton,
} from "@/components/admin";
import { adminEmailApi } from "@/lib/admin-email-api";
import type {
  EmailTemplateVO,
  EmailTemplateDTO,
  ApiKeyVO,
  ApiKeyDTO,
} from "@/types/admin-email";
import { useAuthStore } from "@/stores/use-auth-store";
import { formatDateTime } from "@/lib/utils";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";

type PillTone = StatusPillProps["tone"];

const TEMPLATE_FILTERS = ["全部", "html", "text"];
const TEMPLATE_TYPE_OPTIONS = ["html", "text"];
const KEY_SCOPE_OPTIONS = ["全部", "生成", "只读", "导出"];

/** Template type → pill tone. */
function typeTone(type: string): PillTone {
  return type === "text" ? "gray" : "blue";
}

/* ── modal state ─────────────────────────────────────────────────────────── */

interface TplModal {
  row: EmailTemplateVO | null;
}
interface KeyModal {
  row: ApiKeyVO | null;
}
interface CreatedSecret {
  name: string;
  value: string;
}

export default function AdminEmailPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [filter, setFilter] = useState(TEMPLATE_FILTERS[0]);
  const [templates, setTemplates] = useState<EmailTemplateVO[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyVO[]>([]);
  const [tplTotal, setTplTotal] = useState(0);
  const [keyTotal, setKeyTotal] = useState(0);
  const [loadingTpl, setLoadingTpl] = useState(true);
  const [loadingKey, setLoadingKey] = useState(true);
  const [tplError, setTplError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const [tplModal, setTplModal] = useState<TplModal | null>(null);
  const [keyModal, setKeyModal] = useState<KeyModal | null>(null);
  const [saving, setSaving] = useState(false);
  const [tplFormError, setTplFormError] = useState<string | null>(null);
  const [keyFormError, setKeyFormError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<CreatedSecret | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);

  // template form refs
  const tNameRef = useRef<HTMLInputElement>(null);
  const tTypeRef = useRef<HTMLSelectElement>(null);
  const tSceneRef = useRef<HTMLInputElement>(null);
  const tVarsRef = useRef<HTMLInputElement>(null);
  const tSubjectRef = useRef<HTMLInputElement>(null);
  const tBodyRef = useRef<HTMLTextAreaElement>(null);
  const [tEnabled, setTEnabled] = useState(true);

  // api key form refs
  const kNameRef = useRef<HTMLInputElement>(null);
  const kScopeRef = useRef<HTMLSelectElement>(null);
  const kValueRef = useRef<HTMLInputElement>(null);
  const kLimitRef = useRef<HTMLInputElement>(null);
  const kExpiryRef = useRef<HTMLInputElement>(null);
  const [kEnabled, setKEnabled] = useState(true);

  const loadTemplates = useCallback(async () => {
    setLoadingTpl(true);
    setTplError(null);
    try {
      await ensureSession();
      const res = await adminEmailApi.listTemplates({
        pageNum: 1,
        pageSize: 100,
        type: filter === "全部" ? undefined : filter,
      });
      if (res.success && res.data) {
        setTemplates(res.data.records);
        setTplTotal(res.data.total);
      } else {
        setTplError(res.message || "加载模板失败");
        setTemplates([]);
        setTplTotal(0);
      }
    } catch {
      setTplError("加载模板失败");
      setTemplates([]);
      setTplTotal(0);
    } finally {
      setLoadingTpl(false);
    }
  }, [ensureSession, filter]);

  const loadApiKeys = useCallback(async () => {
    setLoadingKey(true);
    setKeyError(null);
    try {
      await ensureSession();
      const res = await adminEmailApi.listApiKeys({ pageNum: 1, pageSize: 100 });
      if (res.success && res.data) {
        setApiKeys(res.data.records);
        setKeyTotal(res.data.total);
      } else {
        setKeyError(res.message || "加载密钥失败");
        setApiKeys([]);
        setKeyTotal(0);
      }
    } catch {
      setKeyError("加载密钥失败");
      setApiKeys([]);
      setKeyTotal(0);
    } finally {
      setLoadingKey(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadTemplates());
    return () => cancelAnimationFrame(frame);
  }, [loadTemplates]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadApiKeys());
    return () => cancelAnimationFrame(frame);
  }, [loadApiKeys]);

  // sync the enabled toggles when a modal opens
  const openTpl = (row: EmailTemplateVO | null) => {
    setTplFormError(null);
    setTEnabled(row ? row.enabled : true);
    setTplModal({ row });
  };
  const openKey = (row: ApiKeyVO | null) => {
    setKeyFormError(null);
    setKEnabled(row ? row.enabled : true);
    setKeyModal({ row });
  };

  const saveTemplate = useCallback(async () => {
    if (!tplModal) return;
    const name = tNameRef.current?.value.trim() ?? "";
    if (!name) {
      const message = "请填写模板名称";
      setTplFormError(message);
      tNameRef.current?.focus();
      toast.error(message);
      return false;
    }
    setTplFormError(null);
    setSaving(true);
    try {
      await ensureSession();
      const dto: EmailTemplateDTO = {
        name,
        type: tTypeRef.current?.value ?? "html",
        scene: tSceneRef.current?.value ?? "",
        variables: tVarsRef.current?.value ?? "",
        subject: tSubjectRef.current?.value ?? "",
        body: tBodyRef.current?.value ?? "",
        enabled: tEnabled,
      };
      const res = tplModal.row
        ? await adminEmailApi.updateTemplate(tplModal.row.id, dto)
        : await adminEmailApi.createTemplate(dto);
      if (!res.success) {
        const message = res.message || "保存模板失败";
        setTplFormError(message);
        toast.error(message);
        return false;
      }
      setTplModal(null);
      await loadTemplates();
      toast.success(tplModal.row ? "邮件模板已更新" : "邮件模板已创建");
    } catch {
      const message = "保存模板失败，请稍后重试";
      setTplFormError(message);
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [tplModal, tEnabled, ensureSession, loadTemplates]);

  const saveApiKey = useCallback(async () => {
    if (!keyModal) return;
    const name = kNameRef.current?.value.trim() ?? "";
    if (!name) {
      const message = "请填写密钥名称";
      setKeyFormError(message);
      kNameRef.current?.focus();
      toast.error(message);
      return false;
    }
    setKeyFormError(null);
    setSaving(true);
    try {
      await ensureSession();
      const limitVal = kLimitRef.current?.value;
      const limitNum = limitVal ? Number(limitVal) : undefined;
      const suppliedKey = kValueRef.current?.value.trim() ?? "";
      const creating = keyModal.row == null;
      const autoGenerated = creating && suppliedKey.length === 0;
      const dto: ApiKeyDTO = {
        name,
        scope: kScopeRef.current?.value ?? "",
        keyValue: suppliedKey || undefined,
        dailyLimit: Number.isFinite(limitNum) ? limitNum : undefined,
        expiry: kExpiryRef.current?.value || undefined,
        enabled: kEnabled,
      };
      const res = keyModal.row
        ? await adminEmailApi.updateApiKey(keyModal.row.id, dto)
        : await adminEmailApi.createApiKey(dto);
      if (!res.success) {
        const message = res.message || "保存密钥失败";
        setKeyFormError(message);
        toast.error(message);
        return false;
      }
      setKeyModal(null);
      if (autoGenerated && res.data?.keyValue) {
        setSecretCopied(false);
        setCreatedSecret({ name, value: res.data.keyValue });
      } else {
        toast.success(creating ? "API 密钥已创建" : "API 密钥已更新");
      }
      await loadApiKeys();
    } catch {
      const message = "保存密钥失败，请稍后重试";
      setKeyFormError(message);
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [keyModal, kEnabled, ensureSession, loadApiKeys]);

  const copyCreatedSecret = useCallback(async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret.value);
      setSecretCopied(true);
      toast.success("完整 API Key 已复制");
    } catch {
      secretInputRef.current?.focus();
      secretInputRef.current?.select();
      toast.error("自动复制失败，请使用 Ctrl/Cmd + C 手动复制");
    }
  }, [createdSecret]);

  const deleteTemplate = useCallback(
    async (row: EmailTemplateVO) => {
      if (
        !(await confirmDialog({
          title: "删除邮件模板",
          message: `确认永久删除模板「${row.name}」？使用该模板的触发场景将无法继续发送对应邮件，此操作不可恢复。`,
          confirmText: "确认删除",
          danger: true,
        }))
      ) {
        return;
      }
      try {
        await ensureSession();
        const res = await adminEmailApi.deleteTemplate(row.id);
        if (res.success) {
          await loadTemplates();
          toast.success(`模板「${row.name}」已删除`);
        } else {
          toast.error(res.message || "删除模板失败");
        }
      } catch {
        toast.error("删除模板失败，请稍后重试");
      }
    },
    [ensureSession, loadTemplates],
  );

  const deleteApiKey = useCallback(
    async (row: ApiKeyVO) => {
      if (
        !(await confirmDialog({
          title: "删除 API 密钥",
          message: `确认永久删除密钥「${row.name}」？所有使用该密钥的请求会立即失效，此操作不可恢复。`,
          confirmText: "确认删除",
          danger: true,
        }))
      ) {
        return;
      }
      try {
        await ensureSession();
        const res = await adminEmailApi.deleteApiKey(row.id);
        if (res.success) {
          await loadApiKeys();
          toast.success(`密钥「${row.name}」已删除`);
        } else {
          toast.error(res.message || "删除密钥失败");
        }
      } catch {
        toast.error("删除密钥失败，请稍后重试");
      }
    },
    [ensureSession, loadApiKeys],
  );

  const toggleTemplate = useCallback(
    async (row: EmailTemplateVO, next: boolean) => {
      try {
        await ensureSession();
        const dto: EmailTemplateDTO = {
          name: row.name,
          type: row.type,
          scene: row.scene,
          variables: row.variables,
          subject: row.subject,
          body: row.body,
          enabled: next,
        };
        const res = await adminEmailApi.updateTemplate(row.id, dto);
        if (res.success) await loadTemplates();
        else toast.error(res.message || "更新模板状态失败");
      } catch {
        toast.error("更新模板状态失败，请稍后重试");
      }
    },
    [ensureSession, loadTemplates],
  );

  const toggleApiKey = useCallback(
    async (row: ApiKeyVO, next: boolean) => {
      try {
        await ensureSession();
        const dto: ApiKeyDTO = {
          name: row.name,
          scope: row.scope,
          dailyLimit: row.dailyLimit,
          expiry: row.expiry || undefined,
          enabled: next,
        };
        const res = await adminEmailApi.updateApiKey(row.id, dto);
        if (res.success) await loadApiKeys();
        else toast.error(res.message || "更新密钥状态失败");
      } catch {
        toast.error("更新密钥状态失败，请稍后重试");
      }
    },
    [ensureSession, loadApiKeys],
  );

  const tplColumns: Column<EmailTemplateVO>[] = useMemo(
    () => [
      { header: "模板", className: "strong", cell: (r) => r.name },
      { header: "类型", cell: (r) => <StatusPill tone={typeTone(r.type)}>{r.type || "html"}</StatusPill> },
      { header: "触发场景", className: "muted", cell: (r) => r.scene || "—" },
      {
        header: "变量",
        className: "mono muted",
        cell: (r) => <span style={{ fontSize: "11.5px" }}>{r.variables || "—"}</span>,
      },
      {
        header: "状态",
        cell: (r) => (
          <SwitchToggle
            checked={r.enabled}
            onChange={(next) => toggleTemplate(r, next)}
            aria-label={`${r.name} 启用`}
          />
        ),
      },
      {
        header: "操作",
        align: "right",
        cell: (r) => (
          <RowActions
            actions={[
              { label: "编辑", onClick: () => openTpl(r) },
              { label: "删除", onClick: () => deleteTemplate(r), danger: true },
            ]}
          />
        ),
      },
    ],
    [deleteTemplate, toggleTemplate],
  );

  const keyColumns: Column<ApiKeyVO>[] = useMemo(
    () => [
      { header: "名称", className: "strong", cell: (r) => r.name },
      { header: "Key", className: "mono muted", cell: (r) => r.keyValue },
      { header: "权限", cell: (r) => <StatusPill tone="blue">{r.scope || "—"}</StatusPill> },
      {
        header: "日上限",
        className: "mono",
        cell: (r) => (r.dailyLimit ? r.dailyLimit.toLocaleString() : "不限"),
      },
      {
        header: "状态",
        cell: (r) => (
          <SwitchToggle
            checked={r.enabled}
            onChange={(next) => toggleApiKey(r, next)}
            aria-label={`${r.name} 启用`}
          />
        ),
      },
      {
        header: "操作",
        align: "right",
        cell: (r) => (
          <RowActions
            actions={[
              { label: "编辑", onClick: () => openKey(r) },
              { label: "删除", onClick: () => deleteApiKey(r), danger: true },
            ]}
          />
        ),
      },
    ],
    [deleteApiKey, toggleApiKey],
  );

  const editingTpl = tplModal?.row ?? null;
  const editingKey = keyModal?.row ?? null;
  const enabledTemplateCount = templates.filter((template) => template.enabled).length;
  const enabledKeyCount = apiKeys.filter((key) => key.enabled).length;

  return (
    <div className="email-admin-page" aria-busy={saving}>
      <SectionHeader
        title="邮件与 API"
        sub="分别管理用户触达内容与第三方访问凭证；两类设置彼此独立"
      />

      {/* 邮件模板 */}
      <Panel
        className="email-task-panel email-template-panel"
        title={
          <span className="email-panel-title">
            <Mail aria-hidden size={16} />
            邮件模板
          </span>
        }
        sub={
          loadingTpl
            ? "加载模板列表…"
            : `${tplTotal} 个模板 · 当前列表 ${enabledTemplateCount} 个已启用 · 管理系统与营销邮件内容`
        }
        tools={
          <>
            <div role="group" aria-label="按邮件模板类型筛选">
              <FilterChips options={TEMPLATE_FILTERS} value={filter} onChange={(v) => setFilter(v)} />
            </div>
            <button
              type="button"
              className="adm-btn"
              onClick={() => openTpl(null)}
              aria-label="新建邮件模板"
            >
              <Plus aria-hidden size={14} />
              新建模板
            </button>
          </>
        }
      >
        {loadingTpl ? (
          <TableSkeleton />
        ) : tplError ? (
          <div className="email-task-state is-error" role="alert">
            <AlertCircle aria-hidden size={20} />
            <strong>邮件模板加载失败</strong>
            <span>{tplError}</span>
            <button type="button" className="adm-btn ghost" onClick={loadTemplates}>
              重新加载
            </button>
          </div>
        ) : templates.length === 0 ? (
          <div className="email-task-state">
            <Mail aria-hidden size={20} />
            <strong>{filter === "全部" ? "还没有邮件模板" : `没有 ${filter} 类型的模板`}</strong>
            <span>
              {filter === "全部"
                ? "创建模板后，可用于注册、通知或营销触达。"
                : "切换筛选条件，或创建一个符合当前类型的模板。"}
            </span>
            <button type="button" className="adm-btn ghost" onClick={() => openTpl(null)}>
              <Plus aria-hidden size={14} />
              新建模板
            </button>
          </div>
        ) : (
          <AdminTable<EmailTemplateVO>
            rows={templates}
            rowKey={(r) => r.id}
            columns={tplColumns}
            label="邮件模板列表"
            pageSize={10}
            total={filter === "全部" ? tplTotal : templates.length}
          />
        )}
      </Panel>

      <div className="email-section-break" aria-hidden="true">
        <span>开发者接入</span>
        <i />
      </div>

      {/* API 密钥 */}
      <Panel
        className="email-task-panel email-key-panel"
        title={
          <span className="email-panel-title">
            <KeyRound aria-hidden size={16} />
            API 密钥
          </span>
        }
        sub={
          loadingKey
            ? "加载访问凭证…"
            : `${keyTotal} 个密钥 · ${enabledKeyCount} 个已启用 · 完整密钥只在创建时展示一次`
        }
        tools={
          <button
            type="button"
            className="adm-btn"
            onClick={() => openKey(null)}
            aria-label="新建 API 密钥"
          >
            <Plus aria-hidden size={14} />
            新建密钥
          </button>
        }
      >
        {loadingKey ? (
          <TableSkeleton />
        ) : keyError ? (
          <div className="email-task-state is-error" role="alert">
            <AlertCircle aria-hidden size={20} />
            <strong>API 密钥加载失败</strong>
            <span>{keyError}</span>
            <button type="button" className="adm-btn ghost" onClick={loadApiKeys}>
              重新加载
            </button>
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="email-task-state">
            <KeyRound aria-hidden size={20} />
            <strong>还没有 API 密钥</strong>
            <span>为第三方应用创建独立凭证，并按用途设置权限与调用上限。</span>
            <button type="button" className="adm-btn ghost" onClick={() => openKey(null)}>
              <Plus aria-hidden size={14} />
              新建密钥
            </button>
          </div>
        ) : (
          <AdminTable<ApiKeyVO>
            rows={apiKeys}
            rowKey={(r) => r.id}
            columns={keyColumns}
            label="API 密钥列表"
            pageSize={10}
            total={keyTotal}
          />
        )}
      </Panel>

      {/* tplModal */}
      <AdminModal
        open={tplModal != null}
        size="lg"
        title={editingTpl ? `编辑模板 · ${editingTpl.name}` : "新建模板"}
        subtitle={editingTpl ? "更新触发场景、邮件标题与正文" : "创建可复用的系统或营销邮件内容"}
        saveLabel={editingTpl ? "保存模板" : "创建模板"}
        onClose={() => {
          if (!saving) {
            setTplFormError(null);
            setTplModal(null);
          }
        }}
        onSave={saveTemplate}
      >
        {tplModal ? (
          <FormCard title="模板信息" style={{ marginTop: 0 }}>
            <FormGrid>
              <Field
                label="模板名称"
                required
                span={2}
                hint={
                  tplFormError ? (
                    <span className="email-field-error" role="alert">
                      {tplFormError}
                    </span>
                  ) : (
                    "用于后台识别，不会出现在邮件正文中"
                  )
                }
              >
                <input
                  ref={tNameRef}
                  placeholder="如：注册验证码"
                  defaultValue={editingTpl?.name ?? ""}
                  aria-invalid={Boolean(tplFormError)}
                  onChange={() => setTplFormError(null)}
                />
              </Field>
              <Field label="类型" span={2}>
                <select ref={tTypeRef} defaultValue={editingTpl?.type ?? TEMPLATE_TYPE_OPTIONS[0]}>
                  {TEMPLATE_TYPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="触发场景" span={2}>
                <input
                  ref={tSceneRef}
                  placeholder="如：用户注册"
                  defaultValue={editingTpl?.scene ?? ""}
                />
              </Field>
              <Field label="可用变量" span={2} hint="使用空格分隔，例如 {code} {name}">
                <input
                  ref={tVarsRef}
                  placeholder="{code} {name}"
                  defaultValue={editingTpl?.variables ?? ""}
                  spellCheck={false}
                />
              </Field>
              <Field label="邮件标题" span={4}>
                <input
                  ref={tSubjectRef}
                  placeholder="【FlowingLight】您的验证码"
                  defaultValue={editingTpl?.subject ?? ""}
                />
              </Field>
            </FormGrid>
            <FormSection
              label="邮件正文"
              hint="可直接使用上方声明的变量；发送前请确认 HTML 标签完整。"
            >
              <textarea
                ref={tBodyRef}
                defaultValue={editingTpl?.body ?? ""}
                placeholder="您好 {name}，您的验证码是 {code}，5 分钟内有效。"
                className="email-body-editor"
                aria-label="邮件正文"
                spellCheck={false}
              />
            </FormSection>
            <FormSection label="模板状态">
              <div className="email-option-row">
                <div>
                  <strong>启用模板</strong>
                  <span>关闭后保留内容，但不再用于发送。</span>
                </div>
                <SwitchToggle
                  checked={tEnabled}
                  onChange={setTEnabled}
                  aria-label="启用邮件模板"
                />
              </div>
            </FormSection>
          </FormCard>
        ) : null}
      </AdminModal>

      {/* keyModal */}
      <AdminModal
        open={keyModal != null}
        size="md"
        title={editingKey ? `密钥 · ${editingKey.name}` : "新建密钥"}
        subtitle={editingKey ? "调整权限、额度或轮换现有凭证" : "为单一应用创建独立访问凭证"}
        saveLabel={editingKey ? "保存密钥" : "创建密钥"}
        onClose={() => {
          if (!saving) {
            setKeyFormError(null);
            setKeyModal(null);
          }
        }}
        onSave={saveApiKey}
      >
        {keyModal ? (
          <FormCard title="密钥信息" style={{ marginTop: 0 }}>
            <FormGrid>
              <Field
                label="名称"
                required
                span={2}
                hint={
                  keyFormError ? (
                    <span className="email-field-error" role="alert">
                      {keyFormError}
                    </span>
                  ) : (
                    "建议使用应用或接入方名称"
                  )
                }
              >
                <input
                  ref={kNameRef}
                  placeholder="如：内容发布服务"
                  defaultValue={editingKey?.name ?? ""}
                  aria-invalid={Boolean(keyFormError)}
                  onChange={() => setKeyFormError(null)}
                />
              </Field>
              <Field label="权限范围" span={2}>
                <select ref={kScopeRef} defaultValue={editingKey?.scope ?? KEY_SCOPE_OPTIONS[0]}>
                  {KEY_SCOPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={editingKey ? "轮换 Key" : "自定义 Key"}
                span={4}
                hint={
                  editingKey
                    ? "留空会保留当前密钥；输入新值将立即使旧密钥失效"
                    : "建议留空，由系统生成高强度密钥；完整值仅展示一次"
                }
              >
                <input
                  ref={kValueRef}
                  placeholder={editingKey ? "留空保持现有密钥" : "留空由系统自动生成"}
                  defaultValue=""
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </Field>
              <Field label="调用上限 / 日" span={2} hint="留空或 0 表示不限">
                <input
                  ref={kLimitRef}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="不限"
                  defaultValue={editingKey?.dailyLimit ? String(editingKey.dailyLimit) : ""}
                />
              </Field>
              <Field label="到期时间" span={2} hint="留空表示永久有效">
                <input
                  ref={kExpiryRef}
                  type="datetime-local"
                  defaultValue={(() => {
                    if (!editingKey?.expiry) return "";
                    const d = new Date(editingKey.expiry);
                    if (Number.isNaN(d.getTime())) return "";
                    const pad = (n: number) => String(n).padStart(2, "0");
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                  })()}
                />
              </Field>
            </FormGrid>
            <FormSection label="密钥状态">
              <div className="email-option-stack">
                <div className="email-option-row">
                  <div>
                    <strong>启用密钥</strong>
                    <span>关闭后所有使用该密钥的请求将被拒绝。</span>
                  </div>
                  <SwitchToggle
                    checked={kEnabled}
                    onChange={setKEnabled}
                    aria-label="启用 API 密钥"
                  />
                </div>
                {editingKey ? (
                  <div className="email-key-meta">
                    <span>当前有效期</span>
                    <strong>
                      {editingKey.expiry ? formatDateTime(editingKey.expiry) : "永久"}
                    </strong>
                  </div>
                ) : null}
              </div>
            </FormSection>
          </FormCard>
        ) : null}
      </AdminModal>

      <div className="one-time-secret-shell">
        <AdminModal
          open={createdSecret != null}
          size="sm"
          title="保存新的 API Key"
          subtitle={createdSecret ? `「${createdSecret.name}」已创建成功` : undefined}
          footNote="关闭后无法再次查看完整密钥"
          saveLabel="我已保存"
          closeable={false}
          showCancel={false}
          onClose={() => undefined}
          onSave={() => {
            if (!secretCopied) {
              toast.error("请先复制并妥善保存完整 API Key");
              return false;
            }
            setCreatedSecret(null);
            setSecretCopied(false);
          }}
        >
          {createdSecret ? (
            <div className="secret-result">
              <div className="secret-warning" id="one-time-secret-note" role="note">
                <ShieldAlert aria-hidden size={20} />
                <div>
                  <strong>仅展示一次</strong>
                  <p>请立即复制到密码管理器或安全的密钥存储中。离开此弹窗后只能重新轮换。</p>
                </div>
              </div>
              <div className="secret-field">
                <label htmlFor="new-api-key-secret">完整 API Key</label>
                <div className="secret-copy-row">
                  <input
                    ref={secretInputRef}
                    id="new-api-key-secret"
                    value={createdSecret.value}
                    readOnly
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="one-time-secret-note secret-copy-status"
                    onFocus={(event) => event.currentTarget.select()}
                    onCopy={() => setSecretCopied(true)}
                  />
                  <button
                    type="button"
                    className="adm-btn secret-copy-button"
                    onClick={copyCreatedSecret}
                    aria-label={`复制 ${createdSecret.name} 的完整 API Key`}
                  >
                    {secretCopied ? (
                      <Check aria-hidden size={14} />
                    ) : (
                      <Copy aria-hidden size={14} />
                    )}
                    {secretCopied ? "已复制" : "复制"}
                  </button>
                </div>
                <span
                  id="secret-copy-status"
                  className={
                    secretCopied ? "secret-copy-status is-copied" : "secret-copy-status"
                  }
                  aria-live="polite"
                >
                  {secretCopied ? "已复制，请确认已存入安全位置。" : "复制后才能确认关闭。"}
                </span>
              </div>
            </div>
          ) : null}
        </AdminModal>
      </div>

      <style>{`
        .email-admin-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 100%;
          min-width: 0;
          max-width: 1600px;
          margin-inline: auto;
        }
        .email-admin-page > .adm-panel { margin-bottom: 0; }
        .email-admin-page .email-task-panel {
          border-color: var(--border);
          box-shadow: none;
        }
        .email-admin-page .email-panel-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .email-admin-page .email-panel-title svg { color: var(--text-faint); }
        .email-admin-page .email-section-break {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 4px 0 -4px;
          color: var(--text-faint);
          font-size: 12px;
          font-weight: 500;
        }
        .email-admin-page .email-section-break i {
          flex: 1;
          height: 1px;
          background: var(--border);
        }
        .email-admin-page .email-task-state {
          display: flex;
          min-height: 220px;
          padding: 40px 24px;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 7px;
          color: var(--text-faint);
          text-align: center;
        }
        .email-admin-page .email-task-state strong {
          margin-top: 2px;
          color: var(--text);
          font-size: 13.5px;
          font-weight: 600;
        }
        .email-admin-page .email-task-state span {
          max-width: 46ch;
          font-size: 12.5px;
          line-height: 1.6;
        }
        .email-admin-page .email-task-state .adm-btn { margin-top: 8px; }
        .email-admin-page .email-task-state.is-error svg { color: var(--danger); }
        .email-admin-page .email-field-error { color: var(--danger); }
        .email-admin-page input[aria-invalid="true"] { border-color: var(--danger); }
        .email-admin-page .email-body-editor {
          width: 100%;
          min-height: 220px;
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: var(--surface);
          color: var(--text);
          font: inherit;
          font-family: var(--mono);
          font-size: 12.5px;
          line-height: 1.65;
          resize: vertical;
          transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
        }
        .email-admin-page .email-body-editor:hover { border-color: var(--border-strong); }
        .email-admin-page .email-body-editor:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .email-admin-page .email-option-stack {
          overflow: hidden;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
        }
        .email-admin-page .email-option-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-height: 58px;
          padding: 10px 14px;
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          background: var(--surface);
        }
        .email-admin-page .email-option-stack .email-option-row {
          border: 0;
          border-radius: 0;
        }
        .email-admin-page .email-option-row > div {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 2px;
        }
        .email-admin-page .email-option-row strong {
          color: var(--text);
          font-size: 12.5px;
          font-weight: 500;
        }
        .email-admin-page .email-option-row span {
          color: var(--text-faint);
          font-size: 11.5px;
          line-height: 1.5;
        }
        .email-admin-page .email-key-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-height: 42px;
          padding: 8px 14px;
          border-top: 1px solid var(--border);
          color: var(--text-faint);
          font-size: 11.5px;
        }
        .email-admin-page .email-key-meta strong {
          color: var(--text-dim);
          font-family: var(--mono);
          font-weight: 500;
        }
        .email-admin-page .one-time-secret-shell .adm-mhead .x,
        .email-admin-page .one-time-secret-shell .adm-mfoot .adm-btn.ghost { display: none; }
        .email-admin-page .secret-result { padding-top: 18px; }
        .email-admin-page .secret-warning {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px;
          border: 1px solid color-mix(in srgb, var(--warn) 25%, var(--border));
          border-radius: var(--r-lg);
          background: var(--warn-soft);
          color: var(--warn);
        }
        .email-admin-page .secret-warning svg { flex: none; margin-top: 1px; }
        .email-admin-page .secret-warning strong {
          display: block;
          color: var(--text);
          font-size: 12.5px;
          font-weight: 600;
        }
        .email-admin-page .secret-warning p {
          margin: 3px 0 0;
          color: var(--text-dim);
          font-size: 11.5px;
          line-height: 1.55;
        }
        .email-admin-page .secret-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 16px;
        }
        .email-admin-page .secret-field > label {
          color: var(--text-dim);
          font-size: 12px;
          font-weight: 500;
        }
        .email-admin-page .secret-copy-row {
          display: flex;
          align-items: stretch;
          gap: 8px;
        }
        .email-admin-page .secret-copy-row input {
          min-width: 0;
          flex: 1;
          height: 38px;
          padding: 0 10px;
          border: 1px solid var(--border);
          border-radius: var(--r);
          background: var(--panel);
          color: var(--text);
          font-family: var(--mono);
          font-size: 12px;
        }
        .email-admin-page .secret-copy-row input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .email-admin-page .secret-copy-button { min-width: 82px; justify-content: center; }
        .email-admin-page .secret-copy-status {
          min-height: 18px;
          color: var(--text-faint);
          font-size: 11.5px;
        }
        .email-admin-page .secret-copy-status.is-copied { color: var(--ok); }
        @media (max-width: 760px) {
          .email-admin-page .email-section-break { margin-top: 0; }
          .email-admin-page .email-option-row { align-items: flex-start; }
          .email-admin-page .secret-copy-row { flex-direction: column; }
          .email-admin-page .secret-copy-button { min-height: 36px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .email-admin-page .email-body-editor { transition: none; }
        }
      `}</style>
    </div>
  );
}
