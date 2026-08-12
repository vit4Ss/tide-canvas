"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus, RefreshCw, Search, X } from "lucide-react";
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
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
  TableSkeleton,
} from "@/components/admin";
import type { Kpi, PillTone } from "@/components/admin/admin-constants";
import { adminActivationCodesApi } from "@/lib/admin-activation-codes-api";
import { toast } from "@/components/shared/toast";
import { useAuthStore } from "@/stores/use-auth-store";
import type {
  ActivationCodeState,
  AdminActivationCode,
  AdminActivationCodeClaim,
  AdminActivationCodeGenerateResult,
  AdminActivationCodeSummary,
} from "@/types/admin-activation-codes";

const CODE_PAGE_SIZE = 20;
const CLAIM_PAGE_SIZE = 20;

const EMPTY_SUMMARY: AdminActivationCodeSummary = {
  totalCodes: 0,
  available: 0,
  claims: 0,
  pointsIssued: 0,
};

const STATE_FILTERS = ["全部", "可领取", "已停用", "已过期", "已领完"] as const;
const STATE_VALUE: Record<string, ActivationCodeState | undefined> = {
  全部: undefined,
  可领取: "available",
  已停用: "disabled",
  已过期: "expired",
  已领完: "exhausted",
};
const STATE_META: Record<ActivationCodeState, { label: string; tone: PillTone }> = {
  available: { label: "可领取", tone: "green" },
  disabled: { label: "已停用", tone: "gray" },
  expired: { label: "已过期", tone: "amber" },
  exhausted: { label: "已领完", tone: "red" },
};

function fmtTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function datetimeLocalAfter(days: number): string {
  const date = new Date(Date.now() + days * 86400000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

interface GenerateForm {
  batchName: string;
  quantity: string;
  usageLimit: string;
  points: string;
  expiresAt: string;
}

const emptyGenerateForm = (): GenerateForm => ({
  batchName: "",
  quantity: "10",
  usageLimit: "1",
  points: "100",
  expiresAt: datetimeLocalAfter(30),
});

export default function AdminActivationCodesPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [codes, setCodes] = useState<AdminActivationCode[]>([]);
  const [codeTotal, setCodeTotal] = useState(0);
  const [codePage, setCodePage] = useState(1);
  const [claims, setClaims] = useState<AdminActivationCodeClaim[]>([]);
  const [claimTotal, setClaimTotal] = useState(0);
  const [claimPage, setClaimPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [codesLoading, setCodesLoading] = useState(false);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stateFilter, setStateFilter] = useState("全部");
  const stateRef = useRef<ActivationCodeState | undefined>(undefined);
  const [codeQuery, setCodeQuery] = useState("");
  const [codeKeyword, setCodeKeyword] = useState("");
  const codeKeywordRef = useRef("");
  const [claimQuery, setClaimQuery] = useState("");
  const [claimKeyword, setClaimKeyword] = useState("");
  const claimKeywordRef = useRef("");
  const [claimCode, setClaimCode] = useState<AdminActivationCode | null>(null);
  const claimCodeRef = useRef<string | undefined>(undefined);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState<GenerateForm>(emptyGenerateForm());
  const [generated, setGenerated] = useState<AdminActivationCodeGenerateResult | null>(null);

  const codeReqRef = useRef(0);
  const loadCodes = useCallback(async (page: number) => {
    const requestId = ++codeReqRef.current;
    setCodesLoading(true);
    try {
      const res = await adminActivationCodesApi.list({
        pageNum: page,
        pageSize: CODE_PAGE_SIZE,
        keyword: codeKeywordRef.current || undefined,
        state: stateRef.current,
      });
      if (requestId !== codeReqRef.current) return;
      if (res.success && res.data) {
        setCodes(res.data.records);
        setCodeTotal(res.data.total);
        setCodePage(res.data.pageNum);
      } else {
        setError(res.message || "加载激活码失败");
      }
    } catch {
      if (requestId === codeReqRef.current) setError("加载激活码失败，请稍后重试");
    } finally {
      if (requestId === codeReqRef.current) setCodesLoading(false);
    }
  }, []);

  const claimReqRef = useRef(0);
  const loadClaims = useCallback(async (page: number) => {
    const requestId = ++claimReqRef.current;
    setClaimsLoading(true);
    try {
      const res = await adminActivationCodesApi.listClaims({
        pageNum: page,
        pageSize: CLAIM_PAGE_SIZE,
        keyword: claimKeywordRef.current || undefined,
        activationCodeId: claimCodeRef.current,
      });
      if (requestId !== claimReqRef.current) return;
      if (res.success && res.data) {
        setClaims(res.data.records);
        setClaimTotal(res.data.total);
        setClaimPage(res.data.pageNum);
      } else {
        setError(res.message || "加载领取记录失败");
      }
    } catch {
      if (requestId === claimReqRef.current) setError("加载领取记录失败，请稍后重试");
    } finally {
      if (requestId === claimReqRef.current) setClaimsLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    const res = await adminActivationCodesApi.summary();
    if (res.success && res.data) setSummary(res.data);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      await Promise.all([loadSummary(), loadCodes(1), loadClaims(1)]);
    } catch {
      setError("激活码数据加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [ensureSession, loadCodes, loadClaims, loadSummary]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadAll());
    return () => cancelAnimationFrame(frame);
  }, [loadAll]);

  const kpis: Kpi[] = useMemo(
    () => [
      { k: "激活码总数", v: summary.totalCodes.toLocaleString("zh-CN") },
      { k: "当前可领取", v: summary.available.toLocaleString("zh-CN") },
      { k: "累计领取", v: summary.claims.toLocaleString("zh-CN") },
      { k: "累计发放积分", v: summary.pointsIssued.toLocaleString("zh-CN") },
    ],
    [summary],
  );

  const openGenerate = () => {
    setGenerateForm(emptyGenerateForm());
    setGenerateOpen(true);
  };

  const generateCodes = async (): Promise<boolean> => {
    const quantity = Number(generateForm.quantity);
    const usageLimit = Number(generateForm.usageLimit);
    const points = Number(generateForm.points);
    const expiry = new Date(generateForm.expiresAt);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
      toast.error("生成数量需为 1–200 的整数");
      return false;
    }
    if (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 100000) {
      toast.error("单码使用次数需为 1–100000 的整数");
      return false;
    }
    if (!Number.isInteger(points) || points < 1 || points > 1000000) {
      toast.error("单次增加积分需为 1–1000000 的整数");
      return false;
    }
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      toast.error("请选择晚于当前时间的到期时间");
      return false;
    }
    try {
      const res = await adminActivationCodesApi.generate({
        batchName: generateForm.batchName.trim() || undefined,
        quantity,
        usageLimit,
        points,
        expiresAt: expiry.toISOString(),
      });
      if (!res.success || !res.data) {
        toast.error(res.message || "生成激活码失败");
        return false;
      }
      setGenerated(res.data);
      toast.success(`已生成 ${res.data.quantity} 个激活码`);
      await Promise.all([loadCodes(1), loadSummary()]);
      return true;
    } catch {
      toast.error("生成激活码失败，请稍后重试");
      return false;
    }
  };

  const copyGenerated = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.codes.join("\n"));
      toast.success(`已复制 ${generated.codes.length} 个激活码`);
    } catch {
      toast.error("复制失败，请手动选择代码文本");
    }
  };

  const toggleCode = async (row: AdminActivationCode, enabled: boolean) => {
    try {
      const res = await adminActivationCodesApi.updateStatus(row.id, enabled);
      if (!res.success) toast.error(res.message || "状态更新失败");
      else toast.success(enabled ? "激活码已启用" : "激活码已停用");
    } catch {
      toast.error("状态更新失败，请稍后重试");
    } finally {
      await Promise.all([loadCodes(codePage), loadSummary()]);
    }
  };

  const showClaimsForCode = (row: AdminActivationCode) => {
    setClaimCode(row);
    claimCodeRef.current = row.id;
    setClaimQuery("");
    setClaimKeyword("");
    claimKeywordRef.current = "";
    loadClaims(1);
    requestAnimationFrame(() => document.getElementById("activation-claims")?.scrollIntoView({ behavior: "smooth" }));
  };

  const clearClaimCode = () => {
    setClaimCode(null);
    claimCodeRef.current = undefined;
    loadClaims(1);
  };

  return (
    <div className="adm-page">
      <StatCardGrid items={kpis} />

      {error ? (
        <AdminAlert
          tone="error"
          title="激活码数据加载失败"
          action={
            <button type="button" className="adm-btn ghost" onClick={loadAll}>
              <RefreshCw aria-hidden size={14} />重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      <Panel
        title="激活码"
        sub="明文仅在生成完成时展示一次；后台列表只保留安全掩码"
        tools={
          <div className="activation-toolbar">
            <FilterChips
              label="激活码状态"
              options={[...STATE_FILTERS]}
              value={stateFilter}
              onChange={(value) => {
                setStateFilter(value);
                stateRef.current = STATE_VALUE[value];
                loadCodes(1);
              }}
            />
            <form
              role="search"
              className="activation-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                const keyword = codeQuery.trim();
                codeKeywordRef.current = keyword;
                setCodeKeyword(keyword);
                loadCodes(1);
              }}
            >
              <div className="adm-search">
                <Search aria-hidden size={15} />
                <input
                  value={codeQuery}
                  onChange={(event) => setCodeQuery(event.target.value)}
                  placeholder="批次 / 代码掩码"
                  aria-label="搜索激活码批次或代码掩码"
                />
              </div>
              {codeKeyword ? (
                <button
                  type="button"
                  className="adm-btn ghost"
                  onClick={() => {
                    setCodeQuery("");
                    setCodeKeyword("");
                    codeKeywordRef.current = "";
                    loadCodes(1);
                  }}
                >
                  <X aria-hidden size={14} />清除
                </button>
              ) : null}
            </form>
            <button type="button" className="adm-btn" onClick={openGenerate}>
              <Plus aria-hidden size={15} />生成激活码
            </button>
          </div>
        }
      >
        {loading || codesLoading ? (
          <TableSkeleton />
        ) : codes.length === 0 ? (
          <AdminEmptyState
            title={stateFilter !== "全部" || codeKeyword ? "当前筛选下没有激活码" : "还没有激活码"}
            description="生成后可设置单码使用次数、积分额度和统一到期时间。"
            action={
              <button type="button" className="adm-btn" onClick={openGenerate}>
                <Plus aria-hidden size={15} />生成激活码
              </button>
            }
          />
        ) : (
          <AdminTable<AdminActivationCode>
            label="激活码列表"
            rows={codes}
            rowKey={(row) => row.id}
            columns={[
              { header: "激活码", width: "15%", className: "mono strong", cell: (row) => row.codeHint },
              {
                header: "批次",
                width: "16%",
                cell: (row) => <span className="truncate" title={row.batchName}>{row.batchName}</span>,
              },
              { header: "积分", width: "8%", align: "right", className: "mono strong", cell: (row) => `+${row.points.toLocaleString("zh-CN")}` },
              {
                header: "使用进度",
                width: "12%",
                className: "mono",
                cell: (row) => (
                  <span title={`已领取 ${row.usedCount} 次，可领取 ${row.usageLimit} 次`}>
                    {row.usedCount.toLocaleString("zh-CN")} / {row.usageLimit.toLocaleString("zh-CN")}
                  </span>
                ),
              },
              {
                header: "状态",
                width: "10%",
                cell: (row) => <StatusPill tone={STATE_META[row.state].tone}>{STATE_META[row.state].label}</StatusPill>,
              },
              { header: "到期时间", width: "17%", className: "mono muted", cell: (row) => fmtTime(row.expiresAt) },
              {
                header: "启用",
                width: "7%",
                cell: (row) => (
                  <SwitchToggle checked={row.enabled} onChange={(next) => toggleCode(row, next)} aria-label={`${row.codeHint} 启用状态`} />
                ),
              },
              {
                header: "操作",
                width: "15%",
                align: "right",
                cell: (row) => <RowActions actions={[{ label: "领取记录", onClick: () => showClaimsForCode(row) }]} />,
              },
            ]}
            server={{ page: codePage, pageSize: CODE_PAGE_SIZE, total: codeTotal, onPage: loadCodes }}
          />
        )}
      </Panel>

      <div id="activation-claims">
        <Panel
          title="领取记录"
          sub={claimCode ? `正在查看 ${claimCode.codeHint} · ${claimCode.batchName}` : "按用户、批次和领取时间追溯每一次积分到账"}
          tools={
            <div className="activation-toolbar">
              {claimCode ? (
                <button type="button" className="adm-btn ghost" onClick={clearClaimCode}>
                  <X aria-hidden size={14} />查看全部激活码
                </button>
              ) : null}
              <form
                role="search"
                className="activation-search-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const keyword = claimQuery.trim();
                  claimKeywordRef.current = keyword;
                  setClaimKeyword(keyword);
                  loadClaims(1);
                }}
              >
                <div className="adm-search">
                  <Search aria-hidden size={15} />
                  <input
                    value={claimQuery}
                    onChange={(event) => setClaimQuery(event.target.value)}
                    placeholder="用户 / 批次 / 代码掩码"
                    aria-label="搜索领取记录"
                  />
                </div>
                {claimKeyword ? (
                  <button
                    type="button"
                    className="adm-btn ghost"
                    onClick={() => {
                      setClaimQuery("");
                      setClaimKeyword("");
                      claimKeywordRef.current = "";
                      loadClaims(1);
                    }}
                  >
                    <X aria-hidden size={14} />清除
                  </button>
                ) : null}
                <button type="button" className="adm-btn ghost" disabled={claimsLoading} onClick={() => loadClaims(claimPage)}>
                  <RefreshCw className={claimsLoading ? "adm-spin" : undefined} aria-hidden size={14} />刷新
                </button>
              </form>
            </div>
          }
        >
          {loading || claimsLoading ? (
            <TableSkeleton />
          ) : claims.length === 0 ? (
            <AdminEmptyState
              title={claimCode || claimKeyword ? "没有匹配的领取记录" : "暂时没有领取记录"}
              description="用户成功兑换后，会在这里记录用户、积分、到账余额、来源代码和领取时间。"
            />
          ) : (
            <AdminTable<AdminActivationCodeClaim>
              label="激活码领取记录"
              rows={claims}
              rowKey={(row) => row.id}
              columns={[
                { header: "领取时间", width: "17%", className: "mono muted", cell: (row) => fmtTime(row.createTime) },
                {
                  header: "用户",
                  width: "18%",
                  className: "strong",
                  cell: (row) => (
                    <span className="truncate" title={row.userId}>
                      {row.user?.nickname || row.user?.username || row.userId}
                    </span>
                  ),
                },
                { header: "激活码", width: "15%", className: "mono", cell: (row) => row.codeHint },
                {
                  header: "批次",
                  width: "17%",
                  cell: (row) => <span className="truncate" title={row.batchName}>{row.batchName}</span>,
                },
                { header: "增加积分", width: "10%", align: "right", className: "mono strong", cell: (row) => `+${row.points.toLocaleString("zh-CN")}` },
                { header: "到账余额", width: "10%", align: "right", className: "mono", cell: (row) => row.balance.toLocaleString("zh-CN") },
                { header: "领取 IP", width: "13%", className: "mono muted", cell: (row) => row.clientIp || "—" },
              ]}
              server={{ page: claimPage, pageSize: CLAIM_PAGE_SIZE, total: claimTotal, onPage: loadClaims }}
            />
          )}
        </Panel>
      </div>

      <AdminModal
        open={generateOpen}
        title="生成激活码"
        subtitle="同一用户对同一个激活码只能领取一次"
        saveLabel="生成"
        footNote="生成后仅展示一次明文，请及时复制并妥善保存。"
        onClose={() => setGenerateOpen(false)}
        onSave={generateCodes}
      >
        <FormCard title="发放规则">
          <FormGrid>
            <Field label="批次名称" span={2} hint="用于后台检索和领取追踪；留空将自动命名。">
              <input
                value={generateForm.batchName}
                maxLength={64}
                placeholder="例如：八月新用户活动"
                onChange={(event) => setGenerateForm((form) => ({ ...form, batchName: event.target.value }))}
              />
            </Field>
            <Field label="生成数量" required>
              <input
                type="number"
                min={1}
                max={200}
                value={generateForm.quantity}
                onChange={(event) => setGenerateForm((form) => ({ ...form, quantity: event.target.value }))}
              />
            </Field>
            <Field label="单码使用次数" required hint="每个用户最多领取一次；次数代表可领取的不同用户数。">
              <input
                type="number"
                min={1}
                max={100000}
                value={generateForm.usageLimit}
                onChange={(event) => setGenerateForm((form) => ({ ...form, usageLimit: event.target.value }))}
              />
            </Field>
            <Field label="每次增加积分" required>
              <input
                type="number"
                min={1}
                max={1000000}
                value={generateForm.points}
                onChange={(event) => setGenerateForm((form) => ({ ...form, points: event.target.value }))}
              />
            </Field>
            <Field label="到期时间" required>
              <input
                type="datetime-local"
                value={generateForm.expiresAt}
                onChange={(event) => setGenerateForm((form) => ({ ...form, expiresAt: event.target.value }))}
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>

      <AdminModal
        open={generated != null}
        title="激活码已生成"
        subtitle={generated ? `${generated.batchName} · ${generated.quantity} 个` : undefined}
        size="lg"
        showCancel={false}
        saveLabel="我已保存，关闭"
        footNote="关闭后无法再次查看这些完整激活码。"
        onClose={() => setGenerated(null)}
      >
        {generated ? (
          <div className="activation-result">
            <div className="activation-result-head">
              <p>请复制并交付给需要领取积分的用户。</p>
              <button type="button" className="adm-btn ghost" onClick={copyGenerated}>
                <Copy aria-hidden size={14} />复制全部
              </button>
            </div>
            <textarea
              className="activation-code-list"
              value={generated.codes.join("\n")}
              readOnly
              rows={Math.min(12, Math.max(4, generated.codes.length))}
              aria-label="本次生成的激活码"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}
