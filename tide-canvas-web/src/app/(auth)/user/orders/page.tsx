"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ShoppingCart, Loader2, XCircle,
} from "lucide-react";
import { orderApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RechargeOrderVO } from "@/types/order";
import { ORDER_STATUS_NAMES, OrderStatus } from "@/types/order";

const PAGE_SIZE = 15;

const statusColorMap: Record<number, string> = {
  [OrderStatus.PENDING]: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  [OrderStatus.PAID]: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  [OrderStatus.CANCELLED]: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  [OrderStatus.REFUNDED]: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400",
};

export default function MyOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<RechargeOrderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await orderApi.list({ pageNum, pageSize: PAGE_SIZE });
      if (res.success) {
        setOrders(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [pageNum]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleCancel = async (id: number) => {
    if (cancellingId) return;
    setCancellingId(id);
    try {
      const res = await orderApi.cancel(id);
      if (res.success) {
        await fetchOrders();
      } else {
        setError(res.message || "取消失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setCancellingId(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回
      </Button>

      <h1 className="mt-4 text-2xl font-bold">我的订单</h1>
      <p className="mt-1 text-sm text-neutral-500">查看和管理你的充值订单</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-16 flex flex-col items-center justify-center text-neutral-400">
          <ShoppingCart className="h-12 w-12" />
          <p className="mt-3 text-lg">暂无订单</p>
          <p className="mt-1 text-sm">前往积分中心充值</p>
          <Button className="mt-4" onClick={() => router.push("/user/recharge")}>
            去充值
          </Button>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="pb-3 pr-4 font-medium text-neutral-500">订单号</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">金额</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">积分</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">状态</th>
                <th className="hidden pb-3 pr-4 font-medium text-neutral-500 sm:table-cell">时间</th>
                <th className="pb-3 font-medium text-neutral-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="py-3 pr-4">
                    <span className="font-mono text-xs">{order.orderNo}</span>
                  </td>
                  <td className="py-3 pr-4 font-medium">{order.amount} 元</td>
                  <td className="py-3 pr-4 text-blue-600 dark:text-blue-400">
                    {order.pointsAmount}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        statusColorMap[order.status] || "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {order.statusName || ORDER_STATUS_NAMES[order.status] || "未知"}
                    </span>
                  </td>
                  <td className="hidden py-3 pr-4 text-neutral-400 sm:table-cell">
                    {formatDate(order.createTime)}
                  </td>
                  <td className="py-3">
                    {order.status === OrderStatus.PENDING && (
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => handleCancel(order.id)}
                        disabled={cancellingId === order.id}
                      >
                        {cancellingId === order.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <XCircle className="mr-1 h-3 w-3" />
                        )}
                        取消
                      </Button>
                    )}
                  </td>
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
  );
}
