"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker, Table, Input, Tag, Button, Alert, Select, Space, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { formatDate } from "@/lib/utils";
import { AdminPageHead } from "@/components/admin/page-head";
import type { RechargeOrderVO } from "@/types/order";
import { OrderStatus, PAY_TYPE_NAMES } from "@/types/order";

const PAGE_SIZE = 20;
const { RangePicker } = DatePicker;

const STATUS_TAG: Record<number, { color: string; text: string }> = {
  [OrderStatus.PENDING]: { color: "gold", text: "待支付" },
  [OrderStatus.PAID]: { color: "green", text: "已支付" },
  [OrderStatus.CANCELLED]: { color: "default", text: "已取消" },
  [OrderStatus.REFUNDED]: { color: "red", text: "已退款" },
  [OrderStatus.TIMEOUT]: { color: "default", text: "已超时" },
};

function payMethodLabel(m?: string) {
  if (m === "wechat") return "微信支付";
  return (m && PAY_TYPE_NAMES[m]) || m || "-";
}

function MetricItem({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <div style={{ minWidth: 128, padding: "10px 12px", border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, background: "#fff" }}>
      <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {hint && <div style={{ marginTop: 2, color: "var(--ant-color-text-tertiary, #bfbfbf)", fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

export default function AdminOrdersPage() {
  const can = useHasPerm();
  const [orders, setOrders] = useState<RechargeOrderVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.orders.list({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        status: statusFilter,
        startTime: dateRange?.[0],
        endTime: dateRange?.[1],
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
  }, [pageNum, keyword, statusFilter, dateRange]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const pagePaidAmount = useMemo(
    () => orders.filter((order) => order.status === OrderStatus.PAID).reduce((sum, order) => sum + Number(order.amount || 0), 0),
    [orders],
  );
  const pagePaidPoints = useMemo(
    () => orders.filter((order) => order.status === OrderStatus.PAID).reduce((sum, order) => sum + Number(order.pointsAmount || 0), 0),
    [orders],
  );
  const pagePending = useMemo(() => orders.filter((order) => order.status === OrderStatus.PENDING || order.status === OrderStatus.TIMEOUT).length, [orders]);

  const handleConfirmPay = async (id: string) => {
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
    {
      title: "订单号",
      dataIndex: "orderNo",
      key: "orderNo",
      render: (v: string, order) => (
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</div>
          <div style={{ marginTop: 2, color: "#8c8c8c", fontSize: 12 }}>{order.id}</div>
        </div>
      ),
    },
    { title: "用户", dataIndex: "userName", key: "userName", responsive: ["sm"], render: (v) => v || <span style={{ color: "#bfbfbf" }}>-</span> },
    {
      title: "金额 / 积分",
      key: "amount",
      render: (_, order) => (
        <div>
          <div style={{ fontWeight: 600 }}>{Number(order.amount || 0).toFixed(2)} 元</div>
          <div style={{ marginTop: 2, color: "#1677ff", fontSize: 12 }}>+{order.pointsAmount} 积分</div>
        </div>
      ),
    },
    {
      title: "支付信息",
      key: "payment",
      responsive: ["md"],
      render: (_, order) => (
        <div>
          <Tag>{payMethodLabel(order.paymentMethod)}</Tag>
          <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 12, color: "#8c8c8c", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {order.paymentNo ? <Tooltip title={order.paymentNo}>{order.paymentNo}</Tooltip> : "无支付流水"}
          </div>
        </div>
      ),
    },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => { const t = STATUS_TAG[s] ?? { color: "default", text: "未知" }; return <Tag color={t.color}>{t.text}</Tag>; } },
    { title: "创建时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v: string) => <span style={{ whiteSpace: "nowrap" }}>{formatDate(v)}</span> },
    { title: "支付时间", dataIndex: "paidTime", key: "paidTime", responsive: ["lg"], render: (v: string) => v ? <span style={{ whiteSpace: "nowrap" }}>{formatDate(v)}</span> : <span style={{ color: "#bfbfbf" }}>-</span> },
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

      <Space wrap>
        <MetricItem label="订单总数" value={total} hint="当前筛选" />
        <MetricItem label="本页已收" value={`${pagePaidAmount.toFixed(2)} 元`} color="#16a34a" />
        <MetricItem label="本页发放积分" value={pagePaidPoints} color="#1677ff" />
        <MetricItem label="待处理订单" value={pagePending} color={pagePending > 0 ? "#d97706" : undefined} />
      </Space>

      <Space wrap>
        <Input.Search
          placeholder="搜索订单号或用户"
          allowClear
          enterButton
          style={{ width: 300 }}
          onSearch={(v) => { setKeyword(v); setPageNum(1); }}
        />
        <Select
          style={{ width: 130 }}
          placeholder="订单状态"
          allowClear
          value={statusFilter}
          onChange={(value) => { setStatusFilter(value); setPageNum(1); }}
          options={[
            { value: OrderStatus.PENDING, label: "待支付" },
            { value: OrderStatus.PAID, label: "已支付" },
            { value: OrderStatus.CANCELLED, label: "已取消" },
            { value: OrderStatus.REFUNDED, label: "已退款" },
            { value: OrderStatus.TIMEOUT, label: "已超时" },
          ]}
        />
        <RangePicker
          showTime
          format="YYYY-MM-DD HH:mm:ss"
          onChange={(_, values) => {
            setDateRange(values[0] && values[1] ? [values[0], values[1]] : null);
            setPageNum(1);
          }}
        />
      </Space>

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
