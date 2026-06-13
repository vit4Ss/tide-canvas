"use client";

import { useEffect, useState, useCallback } from "react";
import { Table, Tag, Alert, Input, Segmented, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { AdminPageHead } from "@/components/admin/page-head";
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

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const typeOptions = [
    { label: "全部", value: "" },
    ...Object.entries(POINTS_TYPE_NAMES).map(([id, name]) => ({ label: name, value: id })),
  ];

  const columns: ColumnsType<PointsTransactionVO> = [
    { title: "ID", dataIndex: "id", key: "id", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> },
    { title: "用户ID", dataIndex: "userId", key: "userId", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> },
    { title: "类型", dataIndex: "type", key: "type", render: (t: number, row) => <Tag>{row.typeName || POINTS_TYPE_NAMES[t] || "未知"}</Tag> },
    {
      title: "金额", dataIndex: "amount", key: "amount", render: (v: number) => (
        <span style={{ fontWeight: 600, color: v >= 0 ? "#16a34a" : "#ef4444", display: "inline-flex", alignItems: "center", gap: 2 }}>
          {v >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{v >= 0 ? `+${v}` : v}
        </span>
      ),
    },
    { title: "余额", dataIndex: "balanceAfter", key: "balanceAfter", render: (v) => <span style={{ color: "#8c8c8c" }}>{v}</span> },
    { title: "备注", dataIndex: "remark", key: "remark", responsive: ["md"], render: (v) => v || "-" },
    { title: "时间", dataIndex: "createTime", key: "createTime", render: (v: string) => formatDate(v) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="积分管理" desc="查看积分交易记录" />

      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      {/* 筛选 */}
      <Space wrap>
        <Input
          placeholder="按用户ID筛选"
          allowClear
          type="number"
          style={{ width: 160 }}
          value={filterUserId}
          onChange={(e) => { setFilterUserId(e.target.value); setPageNum(1); }}
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
