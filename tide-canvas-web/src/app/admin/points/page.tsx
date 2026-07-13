"use client";

/* ============================================================================
   /admin/points — 积分管理 (REAL data).

   Liuguang admin.js V.credit() skin, now backed by the real admin API
   (src/lib/admin-points-api.ts):
     - 积分流水   : GET /api/admin/points/transactions (paged, all users)
     - 手动调整   : POST /api/admin/points/adjust {userId,amount,remark}
                    (writes the REAL user balance + a ledger row)
     - 全局配置   : GET/PUT /api/admin/points/config (sys_config keys)

   （「积分规则」CRUD 已整链下线 2026-07-12：无任何业务消费方——生成消耗
     按模型定价、赠送走下方全局配置，规则表纯属摆设。）

   KEEPS the exact liuguang markup/classes + shared components. Mock import dropped.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FilterChips,
  FormCard,
  FormGrid,
  Panel,
  StatCardGrid,
  StatusPill,
  TableSkeleton,
  ListSkeleton,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/mock/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminPointsApi } from "@/lib/admin-points-api";
import { toast } from "@/components/shared/toast";
import type {
  AdminPointAdjustDTO,
  AdminPointRecord,
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

/** changeType → 中文标签（值域见后端 points/ledger.go 及各写入点）。 */
const CHANGE_TYPE_LABEL: Record<string, string> = {
  consume: "生成消耗",
  recharge: "充值",
  refund: "退款",
  checkin: "签到",
  signup: "注册奖励",
  adjust: "手动调整",
  admin: "后台发放",
};

/** 类型筛选 chips：label → changeType 值（「全部」不传）。 */
const TX_TYPE_FILTERS = ["全部", "生成消耗", "充值", "退款", "签到", "注册奖励", "手动调整", "后台发放"] as const;
const TX_TYPE_VALUE: Record<string, string | undefined> = {
  全部: undefined,
  生成消耗: "consume",
  充值: "recharge",
  退款: "refund",
  签到: "checkin",
  注册奖励: "signup",
  手动调整: "adjust",
  后台发放: "admin",
};

const TX_PAGE_SIZE = 10;

const EMPTY_CONFIG: AdminPointsConfig = {
  "points.checkinDaily": "",
  "points.inviteReward": "",
  "points.signupBonus": "",
};

/* ── adjust modal form state ───────────────────────────────────────────── */
interface AdjustForm {
  userId: string;
  amount: string;
  remark: string;
}
const emptyAdjustForm = (): AdjustForm => ({ userId: "", amount: "", remark: "" });

export default function AdminPointsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [ledger, setLedger] = useState<AdminPointRecord[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [config, setConfig] = useState<AdminPointsConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // adjust modal
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState<AdjustForm>(emptyAdjustForm());

  // 流水筛选：类型 chips（label 单选）+ 用户 ID 精确搜索。ref 供 loadLedger 读取，
  // 避免回调依赖筛选 state 导致身份变化。
  const [txFilter, setTxFilter] = useState("全部");
  const txTypeRef = useRef<string | undefined>(undefined);
  const [userQuery, setUserQuery] = useState("");
  const [userKeyword, setUserKeyword] = useState("");
  const userIdRef = useRef("");

  // reqId 守卫：快速切筛选/搜索时并发请求，慢的旧响应后到不能覆盖新筛选结果
  const ledgerReqRef = useRef(0);
  const loadLedger = useCallback(async (page: number) => {
    const id = ++ledgerReqRef.current;
    setLedgerLoading(true);
    try {
      const res = await adminPointsApi.listTransactions({
        pageNum: page,
        pageSize: TX_PAGE_SIZE,
        changeType: txTypeRef.current,
        userId: userIdRef.current || undefined,
      });
      if (id !== ledgerReqRef.current) return; // 过期响应丢弃
      if (res.success && res.data) {
        setLedger(res.data.records);
        setLedgerTotal(res.data.total);
        setLedgerPage(res.data.pageNum);
      } else {
        setError(res.message || "加载积分流水失败");
      }
    } catch {
      if (id !== ledgerReqRef.current) return;
      setError("加载积分流水失败，请稍后重试");
    } finally {
      if (id === ledgerReqRef.current) setLedgerLoading(false);
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
      await Promise.all([loadLedger(1), loadConfig()]);
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession, loadLedger, loadConfig]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadAll());
    return () => cancelAnimationFrame(frame);
  }, [loadAll]);


  /* ── KPIs derived from real data ─────────────────────────────────────── */
  const kpis: Kpi[] = useMemo(() => {
    const cfgNum = (k: keyof AdminPointsConfig) => {
      const v = String(config[k] ?? "").trim();
      return v === "" ? "—" : num(toInt(v));
    };
    return [
      { k: "流水记录", v: ledgerTotal.toLocaleString("zh-CN") },
      { k: "每日签到赠送", v: cfgNum("points.checkinDaily") },
      { k: "注册礼包", v: cfgNum("points.signupBonus") },
    ];
  }, [config, ledgerTotal]);

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

      {/* 积分流水 ledger (server-paged) + 手动调整 */}
      <Panel
        title="积分流水"
        sub="全部用户的积分变动明细"
        tools={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <FilterChips
              label="变动类型"
              options={[...TX_TYPE_FILTERS]}
              value={txFilter}
              onChange={(v) => {
                setTxFilter(v);
                txTypeRef.current = TX_TYPE_VALUE[v];
                loadLedger(1);
              }}
            />
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const kw = userQuery.trim();
                if (kw && !/^\d+$/.test(kw)) {
                  toast.error("用户 ID 是纯数字（用户管理里可复制）");
                  return;
                }
                userIdRef.current = kw;
                setUserKeyword(kw);
                loadLedger(1);
              }}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div className="adm-search" style={{ margin: 0 }}>
                <Search aria-hidden size={15} />
                <input
                  placeholder="用户 ID"
                  aria-label="按用户 ID 筛选流水"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
              </div>
              <button type="submit" className="adm-btn ghost">
                搜索
              </button>
              {userKeyword ? (
                <button
                  type="button"
                  className="adm-btn ghost"
                  onClick={() => {
                    userIdRef.current = "";
                    setUserQuery("");
                    setUserKeyword("");
                    loadLedger(1);
                  }}
                >
                  <X aria-hidden size={14} />
                  清除
                </button>
              ) : null}
            </form>
            <button type="button" className="adm-btn" onClick={openAdjust}>
              <SlidersHorizontal aria-hidden size={15} />
              手动调整
            </button>
          </div>
        }
      >
        {loading || ledgerLoading ? (
          <TableSkeleton />
        ) : ledger.length === 0 ? (
          <AdminEmptyState
            title={txFilter !== "全部" || userKeyword ? "当前筛选下没有流水" : "暂无积分流水"}
            description={
              txFilter !== "全部" || userKeyword
                ? "切换变动类型或清除用户 ID 后再查看。"
                : "自动赠送、消费和手动调整发生后，变动记录会显示在这里。"
            }
            action={
              txFilter !== "全部" || userKeyword ? (
                <button
                  type="button"
                  className="adm-btn ghost"
                  onClick={() => {
                    setTxFilter("全部");
                    txTypeRef.current = undefined;
                    userIdRef.current = "";
                    setUserQuery("");
                    setUserKeyword("");
                    loadLedger(1);
                  }}
                >
                  <X aria-hidden size={14} />
                  清除筛选
                </button>
              ) : undefined
            }
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
                    <StatusPill tone={changeTone(r.changeType, r.amount)}>
                      {CHANGE_TYPE_LABEL[r.changeType] ?? r.changeType}
                    </StatusPill>
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
