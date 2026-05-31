"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { AiGenerationLogVO } from "@/types/ai";
import { ScrollText, RefreshCw, X, CheckCircle2, XCircle } from "lucide-react";

const OP_LABEL: Record<string, string> = {
  generation: "文生图",
  edits: "图生图",
  video: "视频",
};

export default function AdminAiLogsPage() {
  const [logs, setLogs] = useState<AiGenerationLogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const pageSize = 20;
  const [success, setSuccess] = useState<"" | "0" | "1">("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AiGenerationLogVO | null>(null);

  // 不在同步路径 setLoading(true)（避免 effect 内同步 setState）；仅 await 之后落数据
  const load = useCallback(async () => {
    try {
      const res = await adminApi.ai.logs.list({
        pageNum,
        pageSize,
        ...(success !== "" ? { success: Number(success) } : {}),
      });
      if (res.success) {
        setLogs(res.data.records);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [pageNum, success]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" />
          <h1 className="text-lg font-bold">AI 生成日志</h1>
          <span className="text-sm text-neutral-400">共 {total} 条</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={success}
            onChange={(e) => { setPageNum(1); setSuccess(e.target.value as "" | "0" | "1"); }}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">全部</option>
            <option value="1">成功</option>
            <option value="0">失败</option>
          </select>
          <button
            onClick={load}
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
              <th className="px-4 py-3">操作</th>
              <th className="px-4 py-3">模型</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">耗时</th>
              <th className="px-4 py-3">错误 / 结果</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-400">加载中…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-400">暂无日志</td></tr>
            ) : logs.map((l) => (
              <tr key={l.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{l.createTime?.replace("T", " ").slice(0, 19)}</td>
                <td className="px-4 py-3">{OP_LABEL[l.operation] || l.operation}</td>
                <td className="px-4 py-3 font-mono text-xs">{l.model}</td>
                <td className="px-4 py-3">
                  {l.success === 1 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400"><CheckCircle2 className="h-3 w-3" />成功</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400"><XCircle className="h-3 w-3" />失败 {l.httpStatus || ""}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{l.durationMs != null ? `${(l.durationMs / 1000).toFixed(1)}s` : "-"}</td>
                <td className="max-w-[280px] truncate px-4 py-3 text-xs text-neutral-500" title={l.errorMsg || l.resultUrl || ""}>{l.errorMsg || l.resultUrl || "-"}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setDetail(l)} className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30">详情</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-sm">
        <button disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)} className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">上一页</button>
        <span className="text-neutral-500">{pageNum} / {totalPages}</span>
        <button disabled={pageNum >= totalPages} onClick={() => setPageNum((p) => p + 1)} className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-neutral-700">下一页</button>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">生成日志 #{detail.id}</h2>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"><X className="h-4 w-4" /></button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Field label="任务ID" value={String(detail.taskId ?? "-")} />
              <Field label="用户ID" value={String(detail.userId ?? "-")} />
              <Field label="Handler" value={detail.handlerName} />
              <Field label="模型" value={detail.model} />
              <Field label="操作" value={OP_LABEL[detail.operation] || detail.operation} />
              <Field label="HTTP" value={String(detail.httpStatus ?? "-")} />
              <Field label="上游任务ID" value={detail.upstreamTaskId || "-"} />
              <Field label="耗时" value={detail.durationMs != null ? `${detail.durationMs} ms` : "-"} />
            </dl>
            <Block label="请求地址" text={detail.requestUrl} />
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
