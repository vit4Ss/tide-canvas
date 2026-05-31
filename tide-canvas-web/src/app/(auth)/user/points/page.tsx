"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Coins, CalendarCheck, Loader2, ChevronRight, ArrowUpRight, ArrowDownLeft,
  CreditCard, History,
} from "lucide-react";
import { pointsApi, checkinApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PointsBalanceVO, PointsTransactionVO, CheckinStatusVO } from "@/types/points";
import { POINTS_TYPE_NAMES } from "@/types/points";

const PAGE_SIZE = 15;

export default function PointsDashboardPage() {
  const [balance, setBalance] = useState<PointsBalanceVO | null>(null);
  const [checkinStatus, setCheckinStatus] = useState<CheckinStatusVO | null>(null);
  const [transactions, setTransactions] = useState<PointsTransactionVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkedInToday, setCheckedInToday] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [balanceRes, checkinRes, txRes] = await Promise.all([
        pointsApi.balance(),
        checkinApi.status(),
        pointsApi.transactions({ pageNum, pageSize: PAGE_SIZE }),
      ]);
      if (balanceRes.success) {
        setBalance(balanceRes.data);
        setCheckedInToday(balanceRes.data.todayCheckedIn);
      }
      if (checkinRes.success) {
        setCheckinStatus(checkinRes.data);
        setCheckedInToday(checkinRes.data.checkedInToday);
      }
      if (txRes.success) {
        setTransactions(txRes.data.records);
        setTotal(txRes.data.total);
      }
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [pageNum]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCheckin = async () => {
    if (checkingIn || checkedInToday) return;
    setCheckingIn(true);
    try {
      const res = await checkinApi.checkin();
      if (res.success) {
        setCheckinStatus(res.data);
        setCheckedInToday(true);
        // Refresh balance
        const balanceRes = await pointsApi.balance();
        if (balanceRes.success) setBalance(balanceRes.data);
      } else {
        setError(res.message || "签到失败");
      }
    } catch {
      setError("签到失败，请稍后重试");
    } finally {
      setCheckingIn(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading && !balance) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-32 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-32 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
          </div>
          <div className="h-64 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">积分中心</h1>
      <p className="mt-1 text-sm text-neutral-500">管理你的积分余额与交易记录</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Balance + Check-in */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* Balance Card */}
        <div className="rounded-xl border border-neutral-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 dark:border-neutral-800 dark:from-blue-950/30 dark:to-indigo-950/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2.5 text-blue-600 dark:bg-blue-900 dark:text-blue-400">
              <Coins className="h-5 w-5" />
            </div>
            <p className="text-sm text-neutral-500">当前积分</p>
          </div>
          <p className="mt-3 text-4xl font-bold text-blue-700 dark:text-blue-400">
            {balance?.points ?? 0}
          </p>
        </div>

        {/* Check-in Card */}
        <div className="rounded-xl border border-neutral-200 bg-gradient-to-br from-amber-50 to-orange-50 p-6 dark:border-neutral-800 dark:from-amber-950/30 dark:to-orange-950/30">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-100 p-2.5 text-amber-600 dark:bg-amber-900 dark:text-amber-400">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <p className="text-sm text-neutral-500">每日签到</p>
          </div>
          {checkinStatus && (
            <p className="mt-1 text-sm text-neutral-500">
              已连续签到 <span className="font-semibold text-amber-600 dark:text-amber-400">{checkinStatus.streakDays}</span> 天
            </p>
          )}
          <Button
            className="mt-3"
            onClick={handleCheckin}
            disabled={checkedInToday || checkingIn}
            variant={checkedInToday ? "secondary" : "default"}
          >
            {checkingIn ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CalendarCheck className="mr-1 h-4 w-4" />
            )}
            {checkedInToday ? "今日已签到" : "立即签到"}
          </Button>
        </div>
      </div>

      {/* Quick Links */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link
          href="/user/recharge"
          className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
        >
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-green-500" />
            <span className="font-medium">充值积分</span>
          </div>
          <ChevronRight className="h-4 w-4 text-neutral-400" />
        </Link>
        <Link
          href="/user/orders"
          className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
        >
          <div className="flex items-center gap-3">
            <History className="h-5 w-5 text-purple-500" />
            <span className="font-medium">订单记录</span>
          </div>
          <ChevronRight className="h-4 w-4 text-neutral-400" />
        </Link>
      </div>

      {/* Transaction History */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold">交易记录</h2>
        {transactions.length === 0 && !loading ? (
          <div className="mt-6 flex flex-col items-center justify-center py-12 text-neutral-400">
            <History className="h-10 w-10" />
            <p className="mt-3">暂无交易记录</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="pb-3 pr-4 font-medium text-neutral-500">类型</th>
                  <th className="pb-3 pr-4 font-medium text-neutral-500">金额</th>
                  <th className="hidden pb-3 pr-4 font-medium text-neutral-500 sm:table-cell">余额</th>
                  <th className="hidden pb-3 pr-4 font-medium text-neutral-500 md:table-cell">备注</th>
                  <th className="pb-3 font-medium text-neutral-500">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
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
                    <td className="hidden py-3 pr-4 text-neutral-500 sm:table-cell">
                      {tx.balanceAfter}
                    </td>
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
          <div className="mt-6 flex items-center justify-center gap-2">
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
    </div>
  );
}
