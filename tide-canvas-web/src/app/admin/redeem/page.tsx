"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { RedeemCodeVO } from "@/types/redeem";
import { Ticket, Plus, RefreshCw, Copy, Check, Trash2, Ban, Power, X } from "lucide-react";
import { toast } from "@/components/shared/toast";

const STATUS: Record<number, { label: string; cls: string }> = {
  0: { label: "未使用", cls: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" },
  1: { label: "已使用", cls: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" },
  2: { label: "已停用", cls: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
};

export default function AdminRedeemPage() {
  const [list, setList] = useState<RedeemCodeVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const pageSize = 20;
  const [statusFilter, setStatusFilter] = useState<"" | "0" | "1" | "2">("");
  const [loaded, setLoaded] = useState(false);

  const [showGen, setShowGen] = useState(false);
  const [genCount, setGenCount] = useState(10);
  const [genPoints, setGenPoints] = useState(100);
  const [genExpire, setGenExpire] = useState("");
  const [genRemark, setGenRemark] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.redeem.list({ pageNum, pageSize, ...(statusFilter !== "" ? { status: Number(statusFilter) } : {}) });
      if (res.success) { setList(res.data.records); setTotal(res.data.total); }
    } finally {
      setLoaded(true);
    }
  }, [pageNum, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleGenerate = async () => {
    if (genCount < 1 || genPoints < 1) { toast.error("数量和积分需大于 0"); return; }
    setGenerating(true);
    try {
      const res = await adminApi.redeem.generate({
        count: genCount,
        points: genPoints,
        ...(genExpire ? { expireTime: `${genExpire} 23:59:59` } : {}),
        ...(genRemark ? { remark: genRemark } : {}),
      });
      if (res.success) {
        setGeneratedCodes(res.data);
        setShowGen(false);
        toast.success(`已生成 ${res.data.length} 个兑换码`);
        void load();
      } else {
        toast.error(res.message || "生成失败");
      }
    } finally {
      setGenerating(false);
    }
  };

  const copyText = async (text: string, mark: "all" | string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (mark === "all") { setCopiedAll(true); setTimeout(() => setCopiedAll(false), 2000); }
      else { setCopiedCode(mark); setTimeout(() => setCopiedCode((c) => (c === mark ? null : c)), 1500); }
    } catch { toast.error("复制失败"); }
  };

  const toggleStatus = async (r: RedeemCodeVO) => {
    if (r.status === 1) { toast.info("已使用的兑换码不可更改"); return; }
    const res = await adminApi.redeem.updateStatus(r.id, r.status === 2 ? 0 : 2);
    if (res.success) void load();
  };

  const del = async (id: number) => {
    if (!confirm("确定删除该兑换码？")) return;
    const res = await adminApi.redeem.delete(id);
    if (res.success) void load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5" />
          <h2 className="text-2xl font-bold">兑换码</h2>
          <span className="text-sm text-neutral-400">共 {total} 条</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => { setPageNum(1); setStatusFilter(e.target.value as "" | "0" | "1" | "2"); }}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
            <option value="">全部状态</option>
            <option value="0">未使用</option>
            <option value="1">已使用</option>
            <option value="2">已停用</option>
          </select>
          <button onClick={() => void load()} className="rounded-lg border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"><RefreshCw className="h-4 w-4" /></button>
          <button onClick={() => { setShowGen(true); setGeneratedCodes(null); }}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900">
            <Plus className="h-4 w-4" /> 生成兑换码
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-4 py-3">兑换码</th>
              <th className="px-4 py-3">积分</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">有效期</th>
              <th className="px-4 py-3">备注</th>
              <th className="px-4 py-3">创建时间</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {!loaded ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-400">加载中…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-400">暂无兑换码，点击右上角生成</td></tr>
            ) : list.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30">
                <td className="px-4 py-3">
                  <button onClick={() => copyText(r.code, r.code)} className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-blue-600" title="复制">
                    {r.code}
                    {copiedCode === r.code ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-neutral-400" />}
                  </button>
                </td>
                <td className="px-4 py-3 font-medium text-amber-600 dark:text-amber-400">+{r.points}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status]?.cls}`}>{STATUS[r.status]?.label ?? r.status}</span></td>
                <td className="px-4 py-3 text-xs text-neutral-500">{r.expireTime ? r.expireTime.replace("T", " ").slice(0, 16) : "永久"}</td>
                <td className="max-w-[160px] truncate px-4 py-3 text-xs text-neutral-500" title={r.remark}>{r.remark || "-"}</td>
                <td className="px-4 py-3 text-xs text-neutral-400">{r.createTime?.replace("T", " ").slice(0, 16)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {r.status !== 1 && (
                      <button onClick={() => toggleStatus(r)} title={r.status === 2 ? "启用" : "停用"}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        {r.status === 2 ? <Power className="h-4 w-4 text-green-600" /> : <Ban className="h-4 w-4" />}
                      </button>
                    )}
                    <button onClick={() => del(r.id)} title="删除" className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-sm">
        <button disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)} className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">上一页</button>
        <span className="text-neutral-500">{pageNum} / {totalPages}</span>
        <button disabled={pageNum >= totalPages} onClick={() => setPageNum((p) => p + 1)} className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">下一页</button>
      </div>

      {/* 生成弹窗 */}
      {showGen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowGen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><h3 className="font-bold">生成兑换码</h3><button onClick={() => setShowGen(false)}><X className="h-4 w-4 text-neutral-400" /></button></div>
            <div className="space-y-3">
              <div><label className="block text-sm font-medium">数量</label><input type="number" min={1} max={1000} value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></div>
              <div><label className="block text-sm font-medium">每个兑换积分</label><input type="number" min={1} value={genPoints} onChange={(e) => setGenPoints(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></div>
              <div><label className="block text-sm font-medium">有效期（留空=永久）</label><input type="date" value={genExpire} onChange={(e) => setGenExpire(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></div>
              <div><label className="block text-sm font-medium">备注</label><input value={genRemark} onChange={(e) => setGenRemark(e.target.value)} placeholder="如：双十一活动" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowGen(false)} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">取消</button>
              <button onClick={handleGenerate} disabled={generating} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900">{generating ? "生成中…" : "确认生成"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 生成结果（复制） */}
      {generatedCodes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setGeneratedCodes(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">已生成 {generatedCodes.length} 个</h3>
              <button onClick={() => copyText(generatedCodes.join("\n"), "all")} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
                {copiedAll ? <><Check className="h-3.5 w-3.5 text-green-500" /> 已复制</> : <><Copy className="h-3.5 w-3.5" /> 复制全部</>}
              </button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs dark:border-neutral-800 dark:bg-neutral-950">{generatedCodes.join("\n")}</pre>
            <div className="mt-4 flex justify-end"><button onClick={() => setGeneratedCodes(null)} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">完成</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
