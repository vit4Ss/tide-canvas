"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { Bot, Coins, Save, Check } from "lucide-react";

interface HandlerRow {
  handlerName: string;
  displayName: string;
  description: string;
  pointCost: number;
}

export default function AdminAiHandlersPage() {
  const [handlers, setHandlers] = useState<HandlerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.ai.handlers.list();
      if (res.success) setHandlers(res.data as unknown as HandlerRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setCost = (name: string, cost: number) => {
    setHandlers((prev) =>
      prev.map((h) => (h.handlerName === name ? { ...h, pointCost: cost } : h))
    );
  };

  const handleSave = async (h: HandlerRow) => {
    setSavingName(h.handlerName);
    setSavedName(null);
    try {
      const res = await adminApi.ai.handlers.update(h.handlerName, {
        pointCost: Math.max(0, h.pointCost ?? 0),
      });
      if (res.success) {
        setSavedName(h.handlerName);
        setTimeout(() => setSavedName((cur) => (cur === h.handlerName ? null : cur)), 2000);
      }
    } finally {
      setSavingName(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Handler 积分配置</h2>
        <p className="mt-1 text-sm text-neutral-500">
          配置各 AI 能力每次调用消耗的积分，前台生成时按此扣减
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">能力</th>
                <th className="px-4 py-3 font-medium">标识</th>
                <th className="px-4 py-3 font-medium">消耗积分</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-neutral-50 dark:border-neutral-900">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : handlers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <Bot className="mx-auto h-10 w-10 text-neutral-300" />
                    <p className="mt-3 text-neutral-400">暂无 Handler 数据</p>
                  </td>
                </tr>
              ) : (
                handlers.map((h) => (
                  <tr
                    key={h.handlerName}
                    className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50 dark:border-neutral-900 dark:hover:bg-neutral-900/30"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                          <Coins className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-medium">{h.displayName}</p>
                          {h.description && (
                            <p className="text-xs text-neutral-400">{h.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{h.handlerName}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Coins className="h-3.5 w-3.5 text-amber-500" />
                        <input
                          type="number"
                          min={0}
                          value={h.pointCost ?? 0}
                          onChange={(e) => setCost(h.handlerName, Number(e.target.value))}
                          className="w-24 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleSave(h)}
                        disabled={savingName === h.handlerName}
                        className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                      >
                        {savedName === h.handlerName ? (
                          <>
                            <Check className="h-3.5 w-3.5" /> 已保存
                          </>
                        ) : (
                          <>
                            <Save className="h-3.5 w-3.5" /> {savingName === h.handlerName ? "保存中" : "保存"}
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
