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
import { Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
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
  TableSkeleton,
  ListSkeleton,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminPointsApi } from "@/lib/admin-points-api";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";
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
    try {
      const res = await adminPointsApi.listRules();
      if (res.success && res.data) setRules(res.data);
      else setError(res.message || "加载积分规则失败");
    } catch {
      setError("加载积分规则失败，请稍后重试");
    }
  }, []);

  const loadLedger = useCallback(async (page: number) => {
    setLedgerLoading(true);
    try {
      const res = await adminPointsApi.listTransactions({ pageNum: page, pageSize: TX_PAGE_SIZE });
      if (res.success && res.data) {
        setLedger(res.data.records);
        setLedgerTotal(res.data.total);
        setLedgerPage(res.data.pageNum);
      } else {
        setError(res.message || "加载积分流水失败");
      }
    } catch {
      setError("加载积分流水失败，请稍后重试");
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await adminPointsApi.getConfig();
      if (res.success && res.data) setConfig({ ...EMPTY_CONFIG, ...res.data });
      else setError(res.message || "加载配置失败");
    } catch {
      setError("加载配置失败，请稍后重试");
    }
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
    const frame = requestAnimationFrame(() => void loadAll());
    return () => cancelAnimationFrame(frame);
  }, [loadAll]);


  /* ── KPIs derived from real data ─────────────────────────────────────── */
  const kpis: Kpi[] = useMemo(() => {
    const enabledRules = rules.filter((r) => r.enabled).length;
    return [
      { k: "积分规则", v: String(rules.length) },
      { k: "启用规则", v: String(enabledRules) },
      { k: "流水记录", v: ledgerTotal.toLocaleString("zh-CN") },
    ];
  }, [rules, ledgerTotal]);

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
    if (!dto.name || !dto.scene) {
      toast.error(!dto.name ? "请填写规则名称" : "请填写适用场景");
      return false;
    }
    try {
      const res = editingRule
        ? await adminPointsApi.updateRule(editingRule.id, dto)
        : await adminPointsApi.createRule(dto);
      if (res.success) {
        setRuleOpen(false);
        loadRules();
        toast.success(editingRule ? "规则已更新" : "规则已创建");
      } else {
        toast.error(res.message || "保存规则失败");
        return false;
      }
    } catch {
      toast.error("保存规则失败，请稍后重试");
      return false;
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
    try {
      const res = await adminPointsApi.updateRule(r.id, dto);
      if (!res.success) toast.error(res.message || "规则状态更新失败");
    } catch {
      toast.error("规则状态更新失败，请稍后重试");
    } finally {
      loadRules();
    }
  };
  const deleteRule = async (r: AdminPointRule) => {
    if (
      !(await confirmDialog({
        title: "删除积分规则",
        message: `确认永久删除规则「${r.name}」？删除后该场景将不再按此规则自动变动积分，历史流水不会受影响。`,
        confirmText: "确认删除",
      }))
    )
      return;
    try {
      const res = await adminPointsApi.deleteRule(r.id);
      if (res.success) {
        toast.success(`已删除规则「${r.name}」`);
        loadRules();
      } else toast.error(res.message || "删除规则失败");
    } catch {
      toast.error("删除规则失败，请稍后重试");
    }
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
    if (!dto.userId || dto.amount === 0) {
      toast.error(!dto.userId ? "请填写目标用户 ID" : "积分变动数量不能为 0");
      return false;
    }
    try {
      const res = await adminPointsApi.adjust(dto);
      if (res.success) {
        setAdjOpen(false);
        loadLedger(1);
        toast.success("用户积分已调整并写入流水");
      } else {
        toast.error(res.message || "调整积分失败");
        return false;
      }
    } catch {
      toast.error("调整积分失败，请稍后重试");
      return false;
    }
  };

  /* ── config save ─────────────────────────────────────────────────────── */
  const setConfigField = (key: keyof AdminPointsConfig, value: string) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const saveConfig = async () => {
    if (savingConfig) return;
    setSavingConfig(true);
    try {
      const res = await adminPointsApi.putConfig(config);
      if (res.success && res.data) {
        setConfig({ ...EMPTY_CONFIG, ...res.data });
        toast.success("积分全局配置已保存");
      } else toast.error(res.message || "保存配置失败");
    } catch {
      toast.error("保存配置失败，请稍后重试");
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="adm-page">
      <StatCardGrid items={kpis} />

      {error ? (
        <AdminAlert
          tone="error"
          title="积分数据加载失败"
          action={
            <button type="button" className="adm-btn ghost" onClick={loadAll}>
              <RefreshCw aria-hidden size={14} />
              重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      {/* 积分规则 */}
      <Panel
        title="积分规则"
        sub="消耗规则、赠送与触发条件"
        tools={
          <button type="button" className="adm-btn" onClick={openCreateRule}>
            <Plus aria-hidden size={15} />
            新增规则
          </button>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : rules.length === 0 ? (
          <AdminEmptyState
            title="暂无积分规则"
            description="创建消耗或赠送规则，统一管理各业务场景的积分变动。"
            action={
              <button type="button" className="adm-btn" onClick={openCreateRule}>
                <Plus aria-hidden size={15} />
                新增规则
              </button>
            }
          />
        ) : (
          <AdminTable<AdminPointRule>
            label="积分规则列表"
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
            <SlidersHorizontal aria-hidden size={15} />
            手动调整
          </button>
        }
      >
        {loading || ledgerLoading ? (
          <TableSkeleton />
        ) : ledger.length === 0 ? (
          <AdminEmptyState
            title="暂无积分流水"
            description="自动赠送、消费和手动调整发生后，变动记录会显示在这里。"
          />
        ) : (
          <>
            <AdminTable<AdminPointRecord>
              label="积分流水列表"
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
              server={{
                page: ledgerPage,
                pageSize: TX_PAGE_SIZE,
                total: ledgerTotal,
                onPage: loadLedger,
              }}
            />
          </>
        )}
      </Panel>

      {/* 积分全局配置 — sys_config keys (GET/PUT) */}
      <Panel
        title="积分全局配置"
        sub="签到 / 邀请 / 注册赠送"
        tools={
          <button type="button" className="adm-btn" onClick={saveConfig} disabled={savingConfig || loading} aria-busy={savingConfig}>
            {savingConfig ? "保存中…" : "保存配置"}
          </button>
        }
      >
        {loading ? (
          <div style={{ padding: 18 }}><ListSkeleton rows={3} height={40} /></div>
        ) : <div style={{ padding: 18 }}>
          <div className="cfg-grid">
            <div className="cfg-card">
              <h3>赠送规则</h3>
              <p>各场景的默认积分赠送数量。</p>
              <div className="cfg-row">
                <label className="lab" htmlFor="points-checkin-daily">每日签到</label>
                <input
                  id="points-checkin-daily"
                  type="number"
                  min={0}
                  value={config["points.checkinDaily"]}
                  onChange={(e) => setConfigField("points.checkinDaily", e.target.value)}
                />
                <span className="unit">积分</span>
              </div>
              <div className="cfg-row">
                <label className="lab" htmlFor="points-invite-reward">邀请奖励</label>
                <input
                  id="points-invite-reward"
                  type="number"
                  min={0}
                  value={config["points.inviteReward"]}
                  onChange={(e) => setConfigField("points.inviteReward", e.target.value)}
                />
                <span className="unit">积分</span>
              </div>
              <div className="cfg-row">
                <label className="lab" htmlFor="points-signup-bonus">注册礼包</label>
                <input
                  id="points-signup-bonus"
                  type="number"
                  min={0}
                  value={config["points.signupBonus"]}
                  onChange={(e) => setConfigField("points.signupBonus", e.target.value)}
                />
                <span className="unit">积分</span>
              </div>
            </div>
          </div>
        </div>}
      </Panel>

      {/* 新增 / 编辑规则 modal */}
      <AdminModal
        open={ruleOpen}
        size="md"
        title={editingRule ? "编辑规则" : "新增规则"}
        subtitle="配置积分消耗 / 赠送规则与触发条件"
        footNote="保存后立即用于后续积分结算，历史流水不会重算"
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
        size="md"
        title="手动调整积分"
        subtitle="直接增减指定用户的真实积分余额，并写入流水"
        footNote="确认后立即改变真实余额并写入不可编辑的积分流水"
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
    </div>
  );
}
