"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker, Table, Tag, Alert, Input, Segmented, Space, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { AdminPageHead } from "@/components/admin/page-head";
import type { PointsTransactionVO } from "@/types/points";
import { POINTS_TYPE_NAMES } from "@/types/points";

const PAGE_SIZE = 20;
const { RangePicker } = DatePicker;

function MetricItem({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <div style={{ minWidth: 128, padding: "10px 12px", border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, background: "#fff" }}>
      <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)", fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {hint && <div style={{ marginTop: 2, color: "var(--ant-color-text-tertiary, #bfbfbf)", fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

function typeColor(type: number) {
  if (type === 1 || type === 2 || type === 6 || type === 8) return "green";
  if (type === 3 || type === 4 || type === 5) return "red";
  if (type === 7) return "blue";
  return "default";
}

export default function AdminPointsPage() {
  const [transactions, setTransactions] = useState<PointsTransactionVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState<number | undefined>();
  const [filterUserKeyword, setFilterUserKeyword] = useState("");
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.points.transactions({
        pageNum,
        pageSize: PAGE_SIZE,
        type: filterType,
        userKeyword: filterUserKeyword || undefined,
        startTime: dateRange?.[0],
        endTime: dateRange?.[1],
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
  }, [pageNum, filterType, filterUserKeyword, dateRange]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const pageIncome = useMemo(() => transactions.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0), [transactions]);
  const pageExpense = useMemo(() => transactions.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0), [transactions]);
  const pageNet = pageIncome + pageExpense;

  const typeOptions = [
    { label: "全部", value: "" },
    ...Object.entries(POINTS_TYPE_NAMES).map(([id, name]) => ({ label: name, value: id })),
  ];

  const columns: ColumnsType<PointsTransactionVO> = [
    {
      title: "用户 / 流水",
      key: "user",
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.userName || <span style={{ color: "#bfbfbf" }}>-</span>}</div>
          <div style={{ marginTop: 2, fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{row.id}</div>
        </div>
      ),
    },
    { title: "类型", dataIndex: "type", key: "type", render: (t: number, row) => <Tag color={typeColor(t)}>{row.typeName || POINTS_TYPE_NAMES[t] || "未知"}</Tag> },
    {
      title: "金额", dataIndex: "amount", key: "amount", render: (v: number) => (
        <span style={{ fontWeight: 600, color: v >= 0 ? "#16a34a" : "#ef4444", display: "inline-flex", alignItems: "center", gap: 2 }}>
          {v >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{v >= 0 ? `+${v}` : v}
        </span>
      ),
    },
    { title: "变动后余额", dataIndex: "balanceAfter", key: "balanceAfter", render: (v) => <span style={{ color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v}</span> },
    {
      title: "关联业务",
      dataIndex: "bizId",
      key: "bizId",
      responsive: ["md"],
      render: (v) => v ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> : <span style={{ color: "#bfbfbf" }}>-</span>,
    },
    {
      title: "备注",
      dataIndex: "remark",
      key: "remark",
      responsive: ["md"],
      ellipsis: true,
      render: (v) => v ? <Tooltip title={v}><span>{v}</span></Tooltip> : "-",
    },
    { title: "交易时间", dataIndex: "createTime", key: "createTime", render: (v: string) => <span style={{ whiteSpace: "nowrap" }}>{formatDate(v)}</span> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="积分管理" desc="查看积分交易记录" />

      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <Space wrap>
        <MetricItem label="交易总数" value={total} hint="当前筛选" />
        <MetricItem label="本页收入" value={`+${pageIncome}`} color="#16a34a" />
        <MetricItem label="本页支出" value={pageExpense} color="#ef4444" />
        <MetricItem label="本页净变动" value={pageNet >= 0 ? `+${pageNet}` : pageNet} color={pageNet >= 0 ? "#16a34a" : "#ef4444"} />
      </Space>

      <Space wrap>
        <Input
          placeholder="按昵称或账号筛选"
          allowClear
          style={{ width: 180 }}
          value={filterUserKeyword}
          onChange={(e) => { setFilterUserKeyword(e.target.value); setPageNum(1); }}
        />
        <RangePicker
          showTime
          format="YYYY-MM-DD HH:mm:ss"
          onChange={(_, values) => {
            setDateRange(values[0] && values[1] ? [values[0], values[1]] : null);
            setPageNum(1);
          }}
        />
        <Segmented
          options={typeOptions}
          value={filterType === undefined ? "" : String(filterType)}
          onChange={(v) => { setFilterType(v === "" ? undefined : Number(v)); setPageNum(1); }}
        />
      </Space>

      <Table<PointsTransactionVO>
        rowKey="id"
        columns={columns}
        dataSource={transactions}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无交易记录" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: setPageNum }}
      />
    </div>
  );
}
