"use client";

/* ============================================================================
   /admin/email — 邮件配置.

   Faithful port of admin.js V.email(), now wired to the REAL backend (full CRUD
   on templates AND developer API keys):
     GET/POST/PUT/DELETE /api/admin/email/templates
     GET/POST/PUT/DELETE /api/admin/email/api-keys

     - KPI strip (今日发送 / 送达率 / 打开率 / 退信·投诉) — static chrome.
     - .adm-2col: SMTP 服务 (cfg rows) | 发送策略 (cfg rows) — static chrome.
     - 邮件模板: filterChips(全部 / 系统 / 营销 / 通知 by type) + 新建模板; table
       (模板 / 类型 / 触发场景 / 变量 / 状态[开关] / 操作[编辑·删除]) → tplModal.
     - API 密钥: 新建密钥; table (名称 / Key / 权限 / 日上限 / 状态[开关] /
       操作[编辑·删除]) → keyModal.

   Client component: filter state, template/key modals, switch toggles,
   loading/empty states.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  StatCardGrid,
  StatusPill,
  SwitchToggle,
  type Column,
  type StatCardProps,
  type StatusPillProps,
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

type PillTone = StatusPillProps["tone"];

/* ── static display chrome (no longer sourced from @/mock) ───────────────── */

const EMAIL_KPIS: StatCardProps[] = [
  { k: "今日发送", v: "48,210", d: "+6%", dir: "up" },
  { k: "送达率", v: "99.2%", d: "+0.1%", dir: "up" },
  { k: "打开率", v: "38.4%", d: "+2.1%", dir: "up" },
  { k: "退信 / 投诉", v: "0.6%", d: "-0.1%", dir: "up" },
];

interface CfgRow {
  label: string;
  value: string;
  unit?: string;
}
const SMTP_ROWS: CfgRow[] = [
  { label: "服务商", value: "阿里云邮件推送" },
  { label: "SMTP 主机", value: "smtp.tidecanvas.ai" },
  { label: "端口", value: "465" },
  { label: "加密", value: "SSL" },
  { label: "发件邮箱", value: "no-reply@tidecanvas.ai" },
  { label: "发件人名称", value: "TIDE CANVAS" },
];
const SEND_POLICY_ROWS: CfgRow[] = [
  { label: "每用户每日上限", value: "10", unit: "封" },
  { label: "每分钟发送上限", value: "600", unit: "封" },
  { label: "失败重试次数", value: "3" },
  { label: "营销邮件免打扰", value: "22:00–8:00" },
];

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
    loadTemplates();
  }, [loadTemplates]);
  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  // sync the enabled toggles when a modal opens
  const openTpl = (row: EmailTemplateVO | null) => {
    setTEnabled(row ? row.enabled : true);
    setTplModal({ row });
  };
  const openKey = (row: ApiKeyVO | null) => {
    setKEnabled(row ? row.enabled : true);
    setKeyModal({ row });
  };

  const saveTemplate = useCallback(async () => {
    if (!tplModal) return;
    setSaving(true);
    try {
      await ensureSession();
      const dto: EmailTemplateDTO = {
        name: tNameRef.current?.value.trim() ?? "",
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
      if (res.success) {
        setTplModal(null);
        await loadTemplates();
      }
    } finally {
      setSaving(false);
    }
  }, [tplModal, tEnabled, ensureSession, loadTemplates]);

  const saveApiKey = useCallback(async () => {
    if (!keyModal) return;
    setSaving(true);
    try {
      await ensureSession();
      const limitVal = kLimitRef.current?.value;
      const limitNum = limitVal ? Number(limitVal) : undefined;
      const dto: ApiKeyDTO = {
        name: kNameRef.current?.value.trim() ?? "",
        scope: kScopeRef.current?.value ?? "",
        keyValue: kValueRef.current?.value.trim() || undefined,
        dailyLimit: Number.isFinite(limitNum) ? limitNum : undefined,
        expiry: kExpiryRef.current?.value || undefined,
        enabled: kEnabled,
      };
      const res = keyModal.row
        ? await adminEmailApi.updateApiKey(keyModal.row.id, dto)
        : await adminEmailApi.createApiKey(dto);
      if (res.success) {
        setKeyModal(null);
        await loadApiKeys();
      }
    } finally {
      setSaving(false);
    }
  }, [keyModal, kEnabled, ensureSession, loadApiKeys]);

  const deleteTemplate = useCallback(
    async (row: EmailTemplateVO) => {
      await ensureSession();
      const res = await adminEmailApi.deleteTemplate(row.id);
      if (res.success) await loadTemplates();
    },
    [ensureSession, loadTemplates],
  );

  const deleteApiKey = useCallback(
    async (row: ApiKeyVO) => {
      await ensureSession();
      const res = await adminEmailApi.deleteApiKey(row.id);
      if (res.success) await loadApiKeys();
    },
    [ensureSession, loadApiKeys],
  );

  const toggleTemplate = useCallback(
    async (row: EmailTemplateVO, next: boolean) => {
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
    },
    [ensureSession, loadTemplates],
  );

  const toggleApiKey = useCallback(
    async (row: ApiKeyVO, next: boolean) => {
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

  return (
    <>
      <StatCardGrid items={EMAIL_KPIS} />

      <div className="adm-2col">
        <Panel title="SMTP 服务" sub="发件服务器与认证">
          <div style={{ padding: 18 }}>
            <div className="cfg-card" style={{ border: "none", padding: 0, boxShadow: "none" }}>
              {SMTP_ROWS.map((row) => (
                <div className="cfg-row" key={row.label}>
                  <span className="lab">{row.label}</span>
                  <span className="muted">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="发送策略" sub="频控与降级">
          <div style={{ padding: 18 }}>
            <div className="cfg-card" style={{ border: "none", padding: 0, boxShadow: "none" }}>
              {SEND_POLICY_ROWS.map((row) => (
                <div className="cfg-row" key={row.label}>
                  <span className="lab">{row.label}</span>
                  <span className="muted">
                    {row.value}
                    {row.unit ? ` ${row.unit}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* 邮件模板 */}
      <Panel
        title="邮件模板"
        sub="系统与营销邮件模板"
        tools={
          <>
            <FilterChips options={TEMPLATE_FILTERS} value={filter} onChange={(v) => setFilter(v)} />
            <button type="button" className="adm-btn" onClick={() => openTpl(null)}>
              + 新建模板
            </button>
          </>
        }
      >
        {loadingTpl ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            加载中…
          </div>
        ) : tplError ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            {tplError}
          </div>
        ) : templates.length === 0 ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            暂无邮件模板
          </div>
        ) : (
          <AdminTable<EmailTemplateVO>
            rows={templates}
            rowKey={(r) => r.id}
            columns={tplColumns}
            pageSize={10}
            total={filter === "全部" ? tplTotal : templates.length}
          />
        )}
      </Panel>

      {/* API 密钥 */}
      <Panel
        title="API 密钥"
        sub="第三方接入与回调密钥"
        tools={
          <button type="button" className="adm-btn ghost" onClick={() => openKey(null)}>
            + 新建密钥
          </button>
        }
      >
        {loadingKey ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            加载中…
          </div>
        ) : keyError ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            {keyError}
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            暂无 API 密钥
          </div>
        ) : (
          <AdminTable<ApiKeyVO>
            rows={apiKeys}
            rowKey={(r) => r.id}
            columns={keyColumns}
            pageSize={10}
            total={keyTotal}
          />
        )}
      </Panel>

      {/* tplModal */}
      <AdminModal
        open={tplModal != null}
        title={editingTpl ? `编辑模板 · ${editingTpl.name}` : "新建模板"}
        subtitle={editingTpl ? "编辑邮件模板内容" : "新建邮件模板"}
        saveLabel={saving ? "保存中…" : "保存"}
        onClose={() => (saving ? undefined : setTplModal(null))}
        onSave={saveTemplate}
      >
        {tplModal ? (
          <FormCard title="模板信息" style={{ marginTop: 0 }}>
            <FormGrid>
              <Field label="模板名称" required span={2}>
                <input ref={tNameRef} placeholder="如：注册验证码" defaultValue={editingTpl?.name ?? ""} />
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
                <input ref={tSceneRef} placeholder="如：用户注册" defaultValue={editingTpl?.scene ?? ""} />
              </Field>
              <Field label="可用变量" span={2}>
                <input ref={tVarsRef} placeholder="{code} {name}" defaultValue={editingTpl?.variables ?? ""} />
              </Field>
              <Field label="邮件标题" span={4}>
                <input ref={tSubjectRef} placeholder="【TIDE CANVAS】您的验证码" defaultValue={editingTpl?.subject ?? ""} />
              </Field>
            </FormGrid>
            <FormSection label="正文">
              <textarea
                ref={tBodyRef}
                defaultValue={editingTpl?.body ?? ""}
                placeholder="您好 {name}，您的验证码是 {code}，5 分钟内有效。"
                style={{
                  width: "100%",
                  minHeight: 120,
                  padding: "12px 13px",
                  borderRadius: 10,
                  background: "var(--panel)",
                  border: "1px solid transparent",
                  font: "inherit",
                  fontSize: 13,
                  color: "var(--text)",
                  resize: "vertical",
                }}
              />
            </FormSection>
            <FormSection label="选项">
              <div className="cfg-card" style={{ boxShadow: "none", padding: "4px 16px" }}>
                <div className="cfg-row">
                  <span className="lab">启用模板</span>
                  <SwitchToggle checked={tEnabled} onChange={setTEnabled} aria-label="启用模板" />
                </div>
              </div>
            </FormSection>
          </FormCard>
        ) : null}
      </AdminModal>

      {/* keyModal */}
      <AdminModal
        open={keyModal != null}
        title={editingKey ? `密钥 · ${editingKey.name}` : "新建密钥"}
        subtitle={editingKey ? "编辑 / 轮换 API 密钥" : "创建一个新的 API 密钥"}
        saveLabel={saving ? "保存中…" : "保存"}
        onClose={() => (saving ? undefined : setKeyModal(null))}
        onSave={saveApiKey}
      >
        {keyModal ? (
          <FormCard title="密钥信息" style={{ marginTop: 0 }}>
            <FormGrid>
              <Field label="名称" required span={2}>
                <input ref={kNameRef} placeholder="如：前台 Web" defaultValue={editingKey?.name ?? ""} />
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
              <Field label="Key" span={4} hint={editingKey ? "留空则保持不变" : "留空则自动生成"}>
                <input ref={kValueRef} placeholder="留空自动生成" defaultValue={editingKey?.keyValue ?? ""} />
              </Field>
              <Field label="调用上限 / 日" span={2}>
                <input ref={kLimitRef} type="number" placeholder="不限 (0)" defaultValue={editingKey?.dailyLimit ? String(editingKey.dailyLimit) : ""} />
              </Field>
              <Field label="到期" span={2}>
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
            <FormSection label="选项">
              <div className="cfg-card" style={{ boxShadow: "none", padding: "4px 16px" }}>
                <div className="cfg-row">
                  <span className="lab">启用</span>
                  <SwitchToggle checked={kEnabled} onChange={setKEnabled} aria-label="启用" />
                </div>
                {editingKey ? (
                  <div className="cfg-row">
                    <span className="lab">创建于</span>
                    <span className="muted">{editingKey.expiry ? `到期 ${formatDateTime(editingKey.expiry)}` : "永久"}</span>
                  </div>
                ) : null}
              </div>
            </FormSection>
          </FormCard>
        ) : null}
      </AdminModal>
    </>
  );
}
