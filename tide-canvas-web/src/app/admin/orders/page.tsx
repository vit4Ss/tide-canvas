"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ShoppingCart, CheckCircle, Loader2, Search,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RechargeOrderVO } from "@/types/order";
import { ORDER_STATUS_NAMES, OrderStatus } from "@/types/order";

const PAGE_SIZE = 20;

const statusColorMap: Record<number, string> = {
  [OrderStatus.PENDING]: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  [OrderStatus.PAID]: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  [OrderStatus.CANCELLED]: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  [OrderStatus.REFUNDED]: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400",
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<RechargeOrderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [payingId, setPayingId] = useState<number | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.orders.list({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
      });
      if (res.success) {
        setOrders(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [pageNum, keyword]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleSearch = () => {
    setKeyword(searchInput);
    setPageNum(1);
  };

  const handleConfirmPay = async (id: number) => {
    if (payingId) return;
    setPayingId(id);
    setError("");
    try {
      const res = await adminApi.orders.pay(id);
      if (res.success) {
        fetchOrders();
      } else {
        setError(res.message || "确认支付失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setPayingId(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">订单管理</h2>
        <p className="mt-1 text-sm text-neutral-500">查看和管理所有充值订单</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <Input
          placeholder="搜索订单号或用户..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={handleSearch}>
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {/* Orders Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-neutral-400">
          <ShoppingCart className="h-12 w-12" />
          <p className="mt-3 text-lg">暂无订单</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="pb-3 pr-4 font-medium text-neutral-500">订单号</th>
                <th className="hidden pb-3 pr-4 font-medium text-neutral-500 sm:table-cell">用户ID</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">金额</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">积分</th>
                <th className="hidden pb-3 pr-4 font-medium text-neutral-500 md:table-cell">支付方式</th>
                <th className="pb-3 pr-4 font-medium text-neutral-500">状态</th>
                <th className="hidden pb-3 pr-4 font-medium text-neutral-500 lg:table-cell">时间</th>
                <th className="pb-3 font-medium text-neutral-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="py-3 pr-4">
                    <span className="font-mono text-xs">{order.orderNo}</span>
                  </td>
                  <td className="hidden py-3 pr-4 sm:table-cell">
                    <span className="font-mono text-xs text-neutral-500">
                      {(order as unknown as Record<string, unknown>).userId as string ?? "-"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-medium">{order.amount} 元</td>
                  <td className="py-3 pr-4 text-blue-600 dark:text-blue-400">
                    {order.pointsAmount}
                  </td>
                  <td className="hidden py-3 pr-4 text-neutral-500 md:table-cell">
                    {order.paymentMethod === "alipay"
                      ? "支付宝"
                      : order.paymentMethod === "wechat"
                        ? "微信支付"
                        : order.paymentMethod || "-"}
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
                  <td className="hidden py-3 pr-4 text-neutral-400 lg:table-cell">
                    {formatDate(order.createTime)}
                  </td>
                  <td className="py-3">
                    {order.status === OrderStatus.PENDING && (
                      <Button
                        size="xs"
                        onClick={() => handleConfirmPay(order.id)}
                        disabled={payingId === order.id}
                      >
                        {payingId === order.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1 h-3 w-3" />
                        )}
                        确认支付
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
