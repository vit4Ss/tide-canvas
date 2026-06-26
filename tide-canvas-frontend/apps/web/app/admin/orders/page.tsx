"use client";

import { useEffect, useState, useCallback } from "react";
import { Table, Input, Tag, Button, Alert } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { formatDate } from "@/lib/utils";
import { AdminPageHead } from "@/components/admin/page-head";
import type { RechargeOrderVO } from "@/types/order";
import { OrderStatus } from "@/types/order";

const PAGE_SIZE = 20;

const STATUS_TAG: Record<number, { color: string; text: string }> = {
  [OrderStatus.PENDING]: { color: "gold", text: "待支付" },
  [OrderStatus.PAID]: { color: "green", text: "已支付" },
  [OrderStatus.CANCELLED]: { color: "default", text: "已取消" },
  [OrderStatus.REFUNDED]: { color: "red", text: "已退款" },
  [OrderStatus.TIMEOUT]: { color: "default", text: "已超时" },
};

function payMethodLabel(m?: string) {
  if (m === "alipay") return "支付宝";
  if (m === "wechat") return "微信支付";
  return m || "-";
}

export default function AdminOrdersPage() {
  const can = useHasPerm();
  const [orders, setOrders] = useState<RechargeOrderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [payingId, setPayingId] = useState<number | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.orders.list({ pageNum, pageSize: PAGE_SIZE, keyword: keyword || undefined });
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

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleConfirmPay = async (id: number) => {
    if (payingId) return;
    setPayingId(id);
    setError("");
    try {
      const res = await adminApi.orders.pay(id);
      if (res.success) fetchOrders();
      else setError(res.message || "确认支付失败");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setPayingId(null);
    }
  };

  const columns: ColumnsType<RechargeOrderVO> = [
    { title: "订单号", dataIndex: "orderNo", key: "orderNo", render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> },
    { title: "用户ID", dataIndex: "userId", key: "userId", responsive: ["sm"], render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v ?? "-"}</span> },
    { title: "金额", dataIndex: "amount", key: "amount", render: (v: number) => `${v} 元` },
    { title: "积分", dataIndex: "pointsAmount", key: "pointsAmount", render: (v: number) => <span style={{ color: "#1677ff" }}>{v}</span> },
    { title: "支付方式", dataIndex: "paymentMethod", key: "paymentMethod", responsive: ["md"], render: payMethodLabel },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => { const t = STATUS_TAG[s] ?? { color: "default", text: "未知" }; return <Tag color={t.color}>{t.text}</Tag>; } },
    { title: "时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v: string) => formatDate(v) },
    {
      title: "操作", key: "action", render: (_, o) =>
        // 待支付可确认；已超时也允许手动确认(用户实际已付时管理员可补入账)
        can("order:pay") && (o.status === OrderStatus.PENDING || o.status === OrderStatus.TIMEOUT) ? (
          <Button type="primary" size="small" icon={<CheckCircleOutlined />} loading={payingId === o.id} onClick={() => handleConfirmPay(o.id)}>
            确认支付
          </Button>
        ) : null,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="订单管理" desc="查看和管理所有充值订单" />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}
      <Input.Search
        placeholder="搜索订单号或用户..."
        allowClear
        enterButton
        style={{ maxWidth: 360 }}
        onSearch={(v) => { setKeyword(v); setPageNum(1); }}
      />
      <Table<RechargeOrderVO>
        rowKey="id"
        columns={columns}
        dataSource={orders}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无订单" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: setPageNum }}
      />
    </div>
  );
}
