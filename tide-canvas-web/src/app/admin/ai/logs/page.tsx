"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, type BanInfo } from "@/lib/api";
import { toast } from "@/components/shared";
import type { AiGenerationLogVO } from "@/types/ai";
import { ScrollText, RefreshCw, X, CheckCircle2, XCircle, RotateCcw, ShieldBan } from "lucide-react";

/** 操作大类筛选项（与后端 operation_type 一一对应，单值相等过滤） */
const OP_TYPE_OPTIONS = [
  { value: "", label: "全部" },
  { value: "ai_generate", label: "AI 生成" },
  { value: "file_upload", label: "文件上传" },
  { value: "file_delete", label: "文件删除" },
  { value: "asset_save", label: "保存素材" },
  { value: "abuse_block", label: "刷流拦截" },
];

const OP_TYPE_LABEL: Record<string, string> = {
  ai_generate: "AI 生成",
  file_upload: "文件上传",
  file_delete: "文件删除",
  asset_save: "保存素材",
  abuse_block: "刷流拦截",
};

const OP_TYPE_STYLE: Record<string, string> = {
  ai_generate: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  file_upload: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  file_delete: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  asset_save: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  abuse_block: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

/** AI 生成细分操作 */
const OP_LABEL: Record<string, string> = {
  generation: "文生图",
  edits: "图生图",
  video: "视频",
};

/** ai_task.status → 展示 */
const TASK_STATUS: Record<number, { label: string; cls: string }> = {
  0: { label: "处理中", cls: "text-amber-600 dark:text-amber-400" },
  1: { label: "成功", cls: "text-green-600 dark:text-green-400" },
  2: { label: "失败", cls: "text-red-600 dark:text-red-400" },
  3: { label: "已取消", cls: "text-neutral-500" },
};

const PAGE_SIZE = 20;

export default function AdminAiLogsPage() {
  const [logs, setLogs] = useState<AiGenerationLogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [operationType, setOperationType] = useState("");
  const [success, setSuccess] = useState<"" | "0" | "1">("");
  const [taskIdInput, setTaskIdInput] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  const [taskId, setTaskId] = useState<number | undefined>();
  const [userId, setUserId] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [costSum, setCostSum] = useState(0);
  const [detail, setDetail] = useState<AiGenerationLogVO | null>(null);

  const [refundTarget, setRefundTarget] = useState<AiGenerationLogVO | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);

  // 封禁管理
  const [bansOpen, setBansOpen] = useState(false);
  const [bans, setBans] = useState<BanInfo[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banType, setBanType] = useState<"user" | "ip">("user");
  const [banValue, setBanValue] = useState("");
  const [banMinutes, setBanMinutes] = useState("10");
  const [banReason, setBanReason] = useState("");

  // 不在同步路径 setLoading(true)（避免 effect 内同步 setState）；仅 await 之后落数据
  const load = useCallback(async () => {
    const filters = {
      ...(operationType ? { operationType } : {}),
      ...(success !== "" ? { success: Number(success) } : {}),
      ...(taskId != null ? { taskId } : {}),
      ...(userId != null ? { userId } : {}),
    };
    try {
      // 列表 + 当前筛选条件下的上游成本汇总并行拉取
      const [res, sumRes] = await Promise.all([
        adminApi.ai.logs.list({ pageNum, pageSize: PAGE_SIZE, ...filters }),
        adminApi.ai.logs.costSum({ pageNum: 1, pageSize: 1, ...filters }),
      ]);
      if (res.success) {
        setLogs(res.data.records);
        setTotal(res.data.total);
      }
      if (sumRes.success) {
        setCostSum(Number(sumRes.data) || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [pageNum, operationType, success, taskId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applySearch = () => {
    setPageNum(1);
    const tid = taskIdInput.trim();
    const uid = userIdInput.trim();
    setTaskId(tid && /^\d+$/.test(tid) ? Number(tid) : undefined);
    setUserId(uid && /^\d+$/.test(uid) ? Number(uid) : undefined);
  };

  const handleRefund = async () => {
    if (!refundTarget) return;
    setRefunding(true);
    try {
      const res = await adminApi.points.refundTask({
        taskId: refundTarget.taskId,
        reason: refundReason.trim() || undefined,
      });
      if (res.success) {
        toast.success(`已退还 ${res.data} 积分`);
        setRefundTarget(null);
        setRefundReason("");
        void load();
      } else {
        toast.error(res.message || "退款失败");
      }
    } finally {
      setRefunding(false);
    }
  };

  const loadBans = useCallback(async () => {
    setBansLoading(true);
    try {
      const res = await adminApi.security.bans();
      if (res.success) setBans(res.data || []);
    } finally {
      setBansLoading(false);
    }
  }, []);

  const openBans = () => { setBansOpen(true); void loadBans(); };

  const handleUnban = async (actor: string) => {
    const res = await adminApi.security.unban(actor);
    if (res.success) { toast.success("已解封"); void loadBans(); } else { toast.error(res.message || "解封失败"); }
  };

  const handleManualBan = async () => {
    if (!banValue.trim()) { toast.error("请输入用户ID或IP"); return; }
    const minutes = Number(banMinutes) || 10;
    const res = await adminApi.security.ban({ type: banType, value: banValue.trim(), seconds: minutes * 60, reason: banReason.trim() || undefined });
    if (res.success) { toast.success("已封禁"); setBanValue(""); setBanReason(""); void loadBans(); } else { toast.error(res.message || "封禁失败"); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center gap-2">
        <ScrollText className="h-5 w-5" />
        <h1 className="text-lg font-bold">操作日志</h1>
        <span className="text-sm text-neutral-400">共 {total} 条</span>
        {costSum > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" title="当前筛选条件下全部记录的上游成本合计">
            上游成本 ${costSum.toFixed(4)}
          </span>
        )}
      </div>

      {/* 筛选栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {OP_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setPageNum(1); setOperationType(opt.value); }}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                operationType === opt.value
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="用户ID"
            className="w-28 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            value={taskIdInput}
            onChange={(e) => setTaskIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="任务ID"
            className="w-36 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-900"
          />
          <select
            value={success}
            onChange={(e) => { setPageNum(1); setSuccess(e.target.value as "" | "0" | "1"); }}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">全部状态</option>
            <option value="1">成功</option>
            <option value="0">失败</option>
          </select>
          <button
            onClick={applySearch}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            搜索
          </button>
          <button
            onClick={openBans}
            className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <ShieldBan className="h-3.5 w-3.5" /> 封禁管理
          </button>
          <button
            onClick={() => load()}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">类型</th>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">画布</th>
              <th className="px-4 py-3">任务ID</th>
              <th className="px-4 py-3">内容</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">耗时</th>
              <th className="px-4 py-3">成本</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-neutral-400">加载中…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-neutral-400">暂无日志</td></tr>
            ) : logs.map((l) => {
              const isAi = l.operationType === "ai_generate" || !l.operationType;
              const canRefund = isAi && l.taskId != null;
              return (
                <tr key={l.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{l.createTime?.replace("T", " ").slice(0, 19)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OP_TYPE_STYLE[l.operationType] || "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}>
                      {OP_TYPE_LABEL[l.operationType] || l.operationType || "AI 生成"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {l.userName ? <span>{l.userName}</span> : <span className="text-neutral-400">-</span>}
                    {l.userId != null && <span className="ml-1 text-neutral-400">#{l.userId}</span>}
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-3 text-xs" title={l.projectName || ""}>{l.projectName || <span className="text-neutral-400">-</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{l.taskId ?? "-"}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-xs" title={isAi ? `${OP_LABEL[l.operation] || l.operation || ""} ${l.model || ""}`.trim() : l.operation || ""}>
                    {isAi ? (
                      <span>
                        {OP_LABEL[l.operation] || l.operation || "-"}
                        {l.model ? <span className="ml-1 font-mono text-neutral-400">{l.model}</span> : null}
                      </span>
                    ) : (
                      l.operation || <span className="text-neutral-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {l.success === 1 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400"><CheckCircle2 className="h-3 w-3" />成功</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400"><XCircle className="h-3 w-3" />失败 {l.httpStatus || ""}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{l.durationMs != null ? `${(l.durationMs / 1000).toFixed(1)}s` : "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{l.cost != null ? <span className="font-mono text-emerald-600 dark:text-emerald-400">${Number(l.cost).toFixed(4)}</span> : <span className="text-neutral-400">-</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {canRefund && (
                      <button
                        onClick={() => { setRefundTarget(l); setRefundReason(""); }}
                        className="mr-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                        title="按该任务实际扣分全额退还积分"
                      >
                        <RotateCcw className="h-3 w-3" /> 退积分
                      </button>
                    )}
                    <button onClick={() => setDetail(l)} className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30">详情</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-sm">
        <button disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)} className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">上一页</button>
        <span className="text-neutral-500">{pageNum} / {totalPages}</span>
        <button disabled={pageNum >= totalPages} onClick={() => setPageNum((p) => p + 1)} className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">下一页</button>
      </div>

      {/* 封禁管理弹窗 */}
      {bansOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBansOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold"><ShieldBan className="h-4 w-4 text-red-500" /> 封禁管理</h2>
              <button onClick={() => setBansOpen(false)} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"><X className="h-4 w-4" /></button>
            </div>

            {/* 手动封禁 */}
            <div className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <select value={banType} onChange={(e) => setBanType(e.target.value as "user" | "ip")} className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                <option value="user">用户ID</option>
                <option value="ip">IP</option>
              </select>
              <input value={banValue} onChange={(e) => setBanValue(e.target.value)} placeholder={banType === "user" ? "用户ID" : "IP 地址"} className="w-40 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-900" />
              <input value={banMinutes} onChange={(e) => setBanMinutes(e.target.value)} placeholder="分钟" className="w-20 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-900" />
              <input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="原因(可选)" className="min-w-[120px] flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-900" />
              <button onClick={handleManualBan} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">封禁</button>
            </div>

            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-neutral-500">当前封禁 {bans.length} 条</span>
              <button onClick={() => loadBans()} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"><RefreshCw className="h-3 w-3" /> 刷新</button>
            </div>
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
                  <tr><th className="px-3 py-2">类型</th><th className="px-3 py-2">目标</th><th className="px-3 py-2">原因</th><th className="px-3 py-2">剩余</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {bansLoading ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">加载中…</td></tr>
                  ) : bans.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">暂无封禁</td></tr>
                  ) : bans.map((b) => (
                    <tr key={b.actor}>
                      <td className="px-3 py-2">{b.type === "ip" ? "IP" : b.type === "user" ? "用户" : b.type}</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.value}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-xs text-neutral-500" title={b.reason || ""}>{b.reason || "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">{fmtRemain(b.expireSeconds)}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => handleUnban(b.actor)} className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30">解封</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 退积分弹窗 */}
      {refundTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !refunding && setRefundTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <RotateCcw className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold">退还积分</h3>
                <p className="mt-1 text-sm text-neutral-500">
                  将按任务 <span className="font-mono">#{refundTarget.taskId}</span> 的实际扣分<strong>全额退还</strong>给用户
                  {refundTarget.userName ? ` ${refundTarget.userName}` : ""}。重复退款会被自动拦截。
                </p>
              </div>
            </div>
            <textarea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="退款原因（可选，将记入积分流水）"
              rows={3}
              className="mt-4 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setRefundTarget(null)}
                disabled={refunding}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                onClick={handleRefund}
                disabled={refunding}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {refunding ? "退款中…" : "确认退还"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">操作日志 #{detail.id}</h2>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"><X className="h-4 w-4" /></button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Field label="类型" value={OP_TYPE_LABEL[detail.operationType] || detail.operationType || "AI 生成"} />
              <Field label="用户" value={detail.userName ? `${detail.userName} (#${detail.userId})` : String(detail.userId ?? "-")} />
              <Field label="画布" value={detail.projectName || (detail.projectId ? `#${detail.projectId}` : "-")} />
              <Field label="任务ID" value={String(detail.taskId ?? "-")} />
              <Field label="任务状态" value={detail.taskStatus != null ? (TASK_STATUS[detail.taskStatus]?.label ?? String(detail.taskStatus)) : "-"} />
              <Field label="Handler" value={detail.handlerName || "-"} />
              <Field label="模型" value={detail.model || "-"} />
              <Field label="操作" value={OP_LABEL[detail.operation] || detail.operation || "-"} />
              <Field label="HTTP" value={String(detail.httpStatus ?? "-")} />
              <Field label="上游任务ID" value={detail.upstreamTaskId || "-"} />
              <Field label="耗时" value={detail.durationMs != null ? `${detail.durationMs} ms` : "-"} />
              <Field label="成本(USD)" value={detail.cost != null ? `$${Number(detail.cost).toFixed(4)}` : "-"} />
            </dl>
            {detail.requestUrl ? <Block label="请求地址" text={detail.requestUrl} /> : null}
            <Block label="请求体" text={pretty(detail.requestBody)} mono />
            <Block label="响应体" text={pretty(detail.responseBody)} mono />
            {detail.errorMsg ? <Block label="错误" text={detail.errorMsg} mono danger /> : null}
            {detail.resultUrl ? <Block label="结果地址" text={detail.resultUrl} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}

function Block({ label, text, mono, danger }: { label: string; text?: string; mono?: boolean; danger?: boolean }) {
  if (!text) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs text-neutral-400">{label}</p>
      <pre className={`max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-3 text-xs ${danger ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300" : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"} ${mono ? "font-mono" : ""}`}>{text}</pre>
    </div>
  );
}

function pretty(s?: string): string | undefined {
  if (!s) return s;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function fmtRemain(seconds: number): string {
  if (!seconds || seconds <= 0) return "已过期";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} 分`;
}
