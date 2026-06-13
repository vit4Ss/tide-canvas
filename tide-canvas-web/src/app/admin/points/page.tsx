"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Coins, TrendingUp, Users, ArrowUpRight, ArrowDownLeft,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PointsTransactionVO } from "@/types/points";
import { POINTS_TYPE_NAMES } from "@/types/points";

const PAGE_SIZE = 20;

export default function AdminPointsPage() {
  const [transactions, setTransactions] = useState<PointsTransactionVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState<number | undefined>();
  const [filterUserId, setFilterUserId] = useState("");

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.points.transactions({
        pageNum,
        pageSize: PAGE_SIZE,
        type: filterType,
        userId: filterUserId ? Number(filterUserId) : undefined,
      });
      if (res.success) {
        setTransactions(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [pageNum, filterType, filterUserId]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">积分管理</h2>
        <p className="mt-1 text-sm text-neutral-500">管理用户积分，查看交易记录</p>
      </div>

      {/* Overview Cards (mock data) */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-neutral-500">平台积分总量</p>
              <p className="text-xl font-bold">-</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2.5 text-green-600 dark:bg-green-950 dark:text-green-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-neutral-500">今日交易笔数</p>
              <p className="text-xl font-bold">-</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-50 p-2.5 text-purple-600 dark:bg-purple-950 dark:text-purple-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-neutral-500">今日签到人数</p>
              <p className="text-xl font-bold">-</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 提示：调整积分已移至用户管理 */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/50">
        手动调整积分已移至「用户管理」——在用户列表中点击对应用户的「调积分」即可。
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <Label>按用户ID筛选</Label>
          <div className="flex gap-2">
            <Input
              placeholder="用户ID"
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              className="w-32"
              type="number"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>按类型筛选</Label>
          <div className="flex flex-wrap gap-1">
            <Button
              variant={filterType === undefined ? "default" : "ghost"}
              size="sm"
              onClick={() => { setFilterType(undefined); setPageNum(1); }}
            >
              全部
            </Button>
            {Object.entries(POINTS_TYPE_NAMES).map(([typeId, name]) => (
              <Button
                key={typeId}
                variant={filterType === Number(typeId) ? "default" : "ghost"}
                size="sm"
                onClick={() => { setFilterType(Number(typeId)); setPageNum(1); }}
              >
                {name}
              </Button>
            ))}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setFilterUserId(""); setFilterType(undefined); setPageNum(1); }}
        >
          重置
        </Button>
      </div>

      {/* Transaction Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-neutral-400">
          暂无交易记录
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="pb-3 pr-4 font-medium text-neutral-500">ID</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">类型</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">金额</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">余额</th>
                <th className="hidden pb-3 pr-4 font-medium text-neutral-500 md:table-cell">备注</th>
                <th className="pb-3 font-medium text-neutral-500">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-3 pr-4 font-mono text-xs">{tx.id}</td>
                  <td className="py-3 pr-4">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
                      {tx.typeName || POINTS_TYPE_NAMES[tx.type] || "未知"}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center gap-0.5 font-semibold ${
                        tx.amount >= 0 ? "text-green-600" : "text-red-500"
                      }`}
                    >
                      {tx.amount >= 0 ? (
                        <ArrowDownLeft className="h-3 w-3" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3" />
                      )}
                      {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-neutral-500">{tx.balanceAfter}</td>
                  <td className="hidden py-3 pr-4 text-neutral-500 md:table-cell">
                    {tx.remark || "-"}
                  </td>
                  <td className="py-3 text-neutral-400">{formatDate(tx.createTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pageNum <= 1}
            onClick={() => setPageNum((p) => p - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-neutral-500">
            {pageNum} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pageNum >= totalPages}
            onClick={() => setPageNum((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
