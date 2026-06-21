"use client";

/* ============================================================================
   /admin/points — 积分管理 (REAL data).

   Liuguang admin.js V.credit() skin, now backed by the real admin API
   (src/lib/admin-points-api.ts):
     - 积分规则   : GET/POST/PUT/DELETE /api/admin/points/rules
     - 积分流水   : GET /api/admin/points/transactions (paged, all users)
     - 手动调整   : POST /api/admin/points/adjust {userId,amount,remark}
                    (writes the REAL user balance + a ledger row)
     - 全局配置   : GET/PUT /api/admin/points/config (sys_config keys)

   KEEPS the exact liuguang markup/classes + shared components. Mock import dropped.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminPointsApi } from "@/lib/admin-points-api";
import type {
  AdminPointAdjustDTO,
  AdminPointRecord,
  AdminPointRule,
  AdminPointRuleUpsertDTO,
  AdminPointsConfig,
} from "@/types/admin-points";

const num = (n: number) => n.toLocaleString("zh-CN");
const signed = (n: number) => `${n > 0 ? "+" : ""}${num(n)}`;
const toInt = (s: string) => {
  const v = parseInt(String(s).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(v) ? v : 0;
};

function fmtTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("zh-CN", { hour12: false });
}

/** Map a changeType to a pill tone (positive grants green, consume red, adjust blue). */
function changeTone(changeType: string, amount: number): PillTone {
  if (changeType === "adjust") return "blue";
  if (amount < 0) return "red";
  return "green";
}

const TX_PAGE_SIZE = 10;

const EMPTY_CONFIG: AdminPointsConfig = {
  "points.checkinDaily": "",
  "points.inviteReward": "",
  "points.signupBonus": "",
  "points.exchangeRate": "",
};

/* ── rule modal form state ─────────────────────────────────────────────── */
interface RuleForm {
  name: string;
  scene: string;
  amount: string;
  trigger: string;
  enabled: boolean;
}
const emptyRuleForm = (): RuleForm => ({
  name: "",
  scene: "",
  amount: "",
  trigger: "",
  enabled: true,
});
const ruleToForm = (r: AdminPointRule): RuleForm => ({
  name: r.name,
  scene: r.scene,
  amount: String(r.amount),
  trigger: r.trigger,
  enabled: r.enabled,
});

/* ── adjust modal form state ───────────────────────────────────────────── */
interface AdjustForm {
  userId: string;
  amount: string;
  remark: string;
}
const emptyAdjustForm = (): AdjustForm => ({ userId: "", amount: "", remark: "" });

export default function AdminPointsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [rules, setRules] = useState<AdminPointRule[]>([]);
  const [ledger, setLedger] = useState<AdminPointRecord[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [config, setConfig] = useState<AdminPointsConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // rule modal
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AdminPointRule | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm());

  // adjust modal
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState<AdjustForm>(emptyAdjustForm());

  const loadRules = useCallback(async () => {
    const res = await adminPointsApi.listRules();
    if (res.success && res.data) setRules(res.data);
    else setError(res.message || "加载积分规则失败");
  }, []);

  const loadLedger = useCallback(async (page: number) => {
    setLedgerLoading(true);
    const res = await adminPointsApi.listTransactions({ pageNum: page, pageSize: TX_PAGE_SIZE });
    if (res.success && res.data) {
      setLedger(res.data.records);
      setLedgerTotal(res.data.total);
      setLedgerPage(res.data.pageNum);
    } else {
      setError(res.message || "加载积分流水失败");
    }
    setLedgerLoading(false);
  }, []);

  const loadConfig = useCallback(async () => {
    const res = await adminPointsApi.getConfig();
    if (res.success && res.data) setConfig({ ...EMPTY_CONFIG, ...res.data });
    else setError(res.message || "加载配置失败");
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      await Promise.all([loadRules(), loadLedger(1), loadConfig()]);
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession, loadRules, loadLedger, loadConfig]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const pageCount = Math.max(1, Math.ceil(ledgerTotal / TX_PAGE_SIZE));

  /* ── KPIs derived from real data ─────────────────────────────────────── */
  const kpis: Kpi[] = useMemo(() => {
    const enabledRules = rules.filter((r) => r.enabled).length;
    return [
      { k: "积分规则", v: String(rules.length), dir: "up" },
      { k: "启用规则", v: String(enabledRules), dir: "up" },
      { k: "流水记录", v: ledgerTotal.toLocaleString("zh-CN"), dir: "up" },
      { k: "兑换汇率", v: config["points.exchangeRate"] || "—", dir: "up" },
    ];
  }, [rules, ledgerTotal, config]);

  /* ── rule actions ────────────────────────────────────────────────────── */
  const openCreateRule = () => {
    setEditingRule(null);
    setRuleForm(emptyRuleForm());
    setRuleOpen(true);
  };
  const openEditRule = (r: AdminPointRule) => {
    setEditingRule(r);
    setRuleForm(ruleToForm(r));
    setRuleOpen(true);
  };
  const saveRule = async () => {
    const dto: AdminPointRuleUpsertDTO = {
      name: ruleForm.name.trim(),
      scene: ruleForm.scene.trim(),
      amount: toInt(ruleForm.amount),
      trigger: ruleForm.trigger.trim(),
      enabled: ruleForm.enabled,
    };
    if (!dto.name || !dto.scene) return;
    const res = editingRule
      ? await adminPointsApi.updateRule(editingRule.id, dto)
      : await adminPointsApi.createRule(dto);
    if (res.success) {
      setRuleOpen(false);
      loadRules();
    } else {
      setError(res.message || "保存规则失败");
    }
  };
  const toggleRule = async (r: AdminPointRule, next: boolean) => {
    const dto: AdminPointRuleUpsertDTO = {
      name: r.name,
      scene: r.scene,
      amount: r.amount,
      trigger: r.trigger,
      enabled: next,
    };
    const res = await adminPointsApi.updateRule(r.id, dto);
    if (res.success) loadRules();
    else setError(res.message || "更新状态失败");
  };
  const deleteRule = async (r: AdminPointRule) => {
    const res = await adminPointsApi.deleteRule(r.id);
    if (res.success) loadRules();
    else setError(res.message || "删除规则失败");
  };

  /* ── adjust action (writes REAL balance) ─────────────────────────────── */
  const openAdjust = () => {
    setAdjForm(emptyAdjustForm());
    setAdjOpen(true);
  };
  const saveAdjust = async () => {
    const dto: AdminPointAdjustDTO = {
      userId: adjForm.userId.trim(),
      amount: toInt(adjForm.amount),
      remark: adjForm.remark.trim() || undefined,
    };
    if (!dto.userId || dto.amount === 0) return;
    const res = await adminPointsApi.adjust(dto);
    if (res.success) {
      setAdjOpen(false);
      loadLedger(1);
    } else {
      setError(res.message || "调整积分失败");
    }
  };

  /* ── config save ─────────────────────────────────────────────────────── */
  const setConfigField = (key: keyof AdminPointsConfig, value: string) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const saveConfig = async () => {
    setSavingConfig(true);
    const res = await adminPointsApi.putConfig(config);
    if (res.success && res.data) setConfig({ ...EMPTY_CONFIG, ...res.data });
    else setError(res.message || "保存配置失败");
    setSavingConfig(false);
  };

  return (
    <>
      <StatCardGrid items={kpis} />

      {error ? (
        <div className="adm-panel" style={{ padding: 16 }}>
          <span className="tag2 red">
            <i className="dot" />
            {error}
          </span>
        </div>
      ) : null}

      {/* 积分规则 */}
      <Panel
        title="积分规则"
        sub="消耗规则、赠送与触发条件"
        tools={
          <button type="button" className="adm-btn" onClick={openCreateRule}>
            + 新增规则
          </button>
        }
      >
        {loading ? (
          <div style={{ padding: 18 }} className="muted">
            加载中…
          </div>
        ) : rules.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无积分规则，点击「新增规则」创建。
          </div>
        ) : (
          <AdminTable<AdminPointRule>
            rows={rules}
            rowKey={(r) => r.id}
            columns={[
              { header: "规则", className: "strong", cell: (r) => r.name, sortable: true, sortValue: (r) => r.name },
              { header: "场景", cell: (r) => r.scene, sortable: true, sortValue: (r) => r.scene },
              {
                header: "消耗 / 赠送",
                className: "mono",
                cell: (r) => signed(r.amount),
                sortable: true,
                sortValue: (r) => r.amount,
              },
              { header: "触发条件", className: "muted", cell: (r) => r.trigger || "—" },
              {
                header: "状态",
                cell: (r) => (
                  <SwitchToggle
                    checked={r.enabled}
                    onChange={(next) => toggleRule(r, next)}
                    aria-label={`${r.name} 开关`}
                  />
                ),
              },
              {
                header: "操作",
                align: "right",
                cell: (r) => (
                  <RowActions
                    actions={[
                      { label: "编辑", onClick: () => openEditRule(r) },
                      { label: "删除", onClick: () => deleteRule(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* 积分流水 ledger (server-paged) + 手动调整 */}
      <Panel
        title="积分流水"
        sub="全部用户的积分变动明细"
        tools={
          <button type="button" className="adm-btn" onClick={openAdjust}>
            + 手动调整
          </button>
        }
      >
        {loading || ledgerLoading ? (
          <div style={{ padding: 18 }} className="muted">
            加载中…
          </div>
        ) : ledger.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无积分流水。
          </div>
        ) : (
          <>
            <AdminTable<AdminPointRecord>
              rows={ledger}
              rowKey={(r) => r.id}
              columns={[
                { header: "时间", className: "mono muted", cell: (r) => fmtTime(r.createTime) },
                {
                  header: "用户",
                  className: "strong",
                  cell: (r) => r.user?.nickname || r.user?.username || r.userId,
                },
                {
                  header: "类型",
                  cell: (r) => (
                    <StatusPill tone={changeTone(r.changeType, r.amount)}>{r.changeType}</StatusPill>
                  ),
                },
                {
                  header: "变动",
                  align: "right",
                  className: "mono strong",
                  cell: (r) => signed(r.amount),
                },
                { header: "余额", align: "right", className: "mono", cell: (r) => num(r.balance) },
                { header: "说明", className: "muted", cell: (r) => r.remark || "—" },
              ]}
            />
            <div className="adm-pager">
              <span className="total">共 {ledgerTotal.toLocaleString("zh-CN")} 条</span>
              <div className="pgs">
                <button
                  type="button"
                  className="pg nav"
                  onClick={() => loadLedger(Math.max(1, ledgerPage - 1))}
                  disabled={ledgerPage <= 1}
                  aria-label="上一页"
                >
                  ‹
                </button>
                <button type="button" className="pg on">
                  {ledgerPage}
                </button>
                <span className="gap">/ {pageCount}</span>
                <button
                  type="button"
                  className="pg nav"
                  onClick={() => loadLedger(Math.min(pageCount, ledgerPage + 1))}
                  disabled={ledgerPage >= pageCount}
                  aria-label="下一页"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>

      {/* 积分全局配置 — sys_config keys (GET/PUT) */}
      <Panel
        title="积分全局配置"
        sub="签到 / 邀请 / 注册赠送与兑换汇率"
        tools={
          <button type="button" className="adm-btn" onClick={saveConfig} disabled={savingConfig}>
            {savingConfig ? "保存中…" : "保存配置"}
          </button>
        }
      >
        <div style={{ padding: 18 }}>
          <div className="cfg-grid">
            <div className="cfg-card">
              <h3>赠送规则</h3>
              <p>各场景的默认积分赠送数量。</p>
              <div className="cfg-row">
                <span className="lab">每日签到</span>
                <input
                  type="number"
                  value={config["points.checkinDaily"]}
                  onChange={(e) => setConfigField("points.checkinDaily", e.target.value)}
                />
                <span className="unit">积分</span>
              </div>
              <div className="cfg-row">
                <span className="lab">邀请奖励</span>
                <input
                  type="number"
                  value={config["points.inviteReward"]}
                  onChange={(e) => setConfigField("points.inviteReward", e.target.value)}
                />
                <span className="unit">积分</span>
              </div>
              <div className="cfg-row">
                <span className="lab">注册礼包</span>
                <input
                  type="number"
                  value={config["points.signupBonus"]}
                  onChange={(e) => setConfigField("points.signupBonus", e.target.value)}
                />
                <span className="unit">积分</span>
              </div>
            </div>
            <div className="cfg-card">
              <h3>汇率</h3>
              <p>充值时的人民币与积分兑换比例。</p>
              <div className="cfg-row">
                <span className="lab">1 元 =</span>
                <input
                  type="number"
                  value={config["points.exchangeRate"]}
                  onChange={(e) => setConfigField("points.exchangeRate", e.target.value)}
                />
                <span className="unit">积分</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* 新增 / 编辑规则 modal */}
      <AdminModal
        open={ruleOpen}
        title={editingRule ? "编辑规则" : "新增规则"}
        subtitle="配置积分消耗 / 赠送规则与触发条件"
        onClose={() => setRuleOpen(false)}
        onSave={saveRule}
      >
        <FormCard title="规则信息">
          <FormGrid>
            <Field label="规则名称" required span={2}>
              <input
                placeholder="如：文生图"
                value={ruleForm.name}
                onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="场景" required span={2}>
              <input
                placeholder="如：创作台"
                value={ruleForm.scene}
                onChange={(e) => setRuleForm((f) => ({ ...f, scene: e.target.value }))}
              />
            </Field>
            <Field label="消耗 / 赠送" required span={2} hint="负数为消耗，正数为赠送">
              <input
                type="number"
                placeholder="如：-10 或 200"
                value={ruleForm.amount}
                onChange={(e) => setRuleForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>
            <Field label="触发条件" span={2}>
              <input
                placeholder="如：每次生成"
                value={ruleForm.trigger}
                onChange={(e) => setRuleForm((f) => ({ ...f, trigger: e.target.value }))}
              />
            </Field>
            <Field label="状态" span={4} hint="关闭后该规则不再生效">
              <SwitchToggle
                checked={ruleForm.enabled}
                onChange={(next) => setRuleForm((f) => ({ ...f, enabled: next }))}
                aria-label="规则状态"
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>

      {/* 手动调整积分 modal — writes the REAL user balance */}
      <AdminModal
        open={adjOpen}
        title="手动调整积分"
        subtitle="直接增减指定用户的真实积分余额，并写入流水"
        footNote="此操作将立即改变用户余额"
        saveLabel="确认调整"
        onClose={() => setAdjOpen(false)}
        onSave={saveAdjust}
      >
        <FormCard title="调整信息">
          <FormGrid>
            <Field label="用户 ID" required span={2}>
              <input
                placeholder="目标用户的 ID"
                value={adjForm.userId}
                onChange={(e) => setAdjForm((f) => ({ ...f, userId: e.target.value }))}
              />
            </Field>
            <Field label="变动数量" required span={2} hint="正数增加，负数扣减">
              <input
                type="number"
                placeholder="如：500 或 -100"
                value={adjForm.amount}
                onChange={(e) => setAdjForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>
            <Field label="备注" span={4}>
              <input
                placeholder="如：活动补偿"
                value={adjForm.remark}
                onChange={(e) => setAdjForm((f) => ({ ...f, remark: e.target.value }))}
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}
