"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Coins, CalendarCheck, Loader2, ChevronRight, ArrowUpRight, ArrowDownLeft,
  CreditCard, History, Ticket,
} from "lucide-react";
import { pointsApi, checkinApi, redeemApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { toast } from "@/components/shared/toast";
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
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

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
    // fetchData 内含加载态 setState（既有逻辑）
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const handleRedeem = async () => {
    const code = redeemCode.trim();
    if (!code || redeeming) return;
    setRedeeming(true);
    try {
      const res = await redeemApi.redeem(code);
      if (res.success) {
        toast.success(`兑换成功，获得 ${res.data.points} 积分`);
        setRedeemCode("");
        fetchData();
      } else {
        toast.error(res.message || "兑换失败");
      }
    } catch {
      toast.error("兑换失败，请稍后重试");
    } finally {
      setRedeeming(false);
    }
  };

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

  const txColumns: ColumnsType<PointsTransactionVO> = [
    { title: "类型", dataIndex: "type", key: "type", render: (t: number, tx) => <Tag>{tx.typeName || POINTS_TYPE_NAMES[t] || "未知"}</Tag> },
    {
      title: "金额", dataIndex: "amount", key: "amount", render: (v: number) => (
        <span className={`inline-flex items-center gap-0.5 font-semibold ${v >= 0 ? "text-green-600" : "text-red-500"}`}>
          {v >= 0 ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
          {v >= 0 ? `+${v}` : v}
        </span>
      ),
    },
    { title: "余额", dataIndex: "balanceAfter", key: "balanceAfter", responsive: ["sm"], render: (v: number) => <span className="text-neutral-500">{v}</span> },
    { title: "备注", dataIndex: "remark", key: "remark", responsive: ["md"], render: (v) => <span className="text-neutral-500">{v || "-"}</span> },
    { title: "时间", dataIndex: "createTime", key: "createTime", render: (v: string) => <span className="text-neutral-400">{formatDate(v)}</span> },
  ];

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

      {/* 兑换码 */}
      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5 text-pink-500" />
          <h2 className="font-semibold">兑换码</h2>
        </div>
        <p className="mt-1 text-sm text-neutral-500">输入兑换码，立即兑换积分</p>
        <div className="mt-3 flex gap-2">
          <input
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") handleRedeem(); }}
            placeholder="输入兑换码"
            className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <Button onClick={handleRedeem} disabled={redeeming || !redeemCode.trim()}>
            {redeeming ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Ticket className="mr-1 h-4 w-4" />}
            兑换
          </Button>
        </div>
      </div>

      {/* Transaction History */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold">交易记录</h2>
        <Table<PointsTransactionVO>
          rowKey="id"
          columns={txColumns}
          dataSource={transactions}
          loading={loading}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "暂无交易记录" }}
          className="mt-4"
          pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: setPageNum }}
        />
      </div>
    </div>
  );
}
