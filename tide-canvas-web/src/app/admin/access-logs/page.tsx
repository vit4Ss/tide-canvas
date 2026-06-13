"use client";

import { useEffect, useState } from "react";
import { Table, Input, DatePicker, Space, Tag, Alert, Tooltip, Button, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, ClearOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { AccessLogVO, AccessLogQuery } from "@/types/admin";
import type { PageData } from "@/types/api";

const { RangePicker } = DatePicker;
const PAGE_SIZE = 20;

const METHOD_COLORS: Record<string, string> = {
  GET: "blue", POST: "green", PUT: "orange", DELETE: "red", PATCH: "purple",
};

function statusColor(status: number): string {
  if (status >= 500) return "red";
  if (status >= 400) return "orange";
  if (status >= 300) return "gold";
  return "green";
}

export default function AdminAccessLogsPage() {
  const [logs, setLogs] = useState<AccessLogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [pathKw, setPathKw] = useState("");
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<{ start?: string; end?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = async (page = pageNum, path = pathKw, kw = keyword, r = range) => {
    setLoading(true);
    setError("");
    try {
      const query: AccessLogQuery = {
        pageNum: page, pageSize: PAGE_SIZE,
        path: path || undefined,
        keyword: kw || undefined,
        startTime: r.start || undefined,
        endTime: r.end || undefined,
      };
      const res = await adminApi.accessLogs.list(query);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<AccessLogVO>;
        setLogs(data.records);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载访问日志失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLogs(1); }, []);

  const handleDelete = async (id: number) => {
    const res = await adminApi.accessLogs.remove(id);
    if (res.success) { toast.success("已删除"); loadLogs(); }
    else toast.error(res.message || "删除失败");
  };

  const handleClear = async () => {
    const res = await adminApi.accessLogs.clear();
    if (res.success) { toast.success("已清空访问日志"); setPageNum(1); loadLogs(1); }
    else toast.error(res.message || "清空失败");
  };

  const columns: ColumnsType<AccessLogVO> = [
    { title: "用户", dataIndex: "username", key: "username", render: (v) => v || <span style={{ color: "#bfbfbf" }}>游客</span> },
    { title: "方法", dataIndex: "method", key: "method", width: 80, render: (v: string) => <Tag color={METHOD_COLORS[v] || "default"}>{v}</Tag> },
    {
      title: "路径", dataIndex: "path", key: "path", ellipsis: true, render: (v: string) =>
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span>,
    },
    { title: "状态", dataIndex: "status", key: "status", width: 80, render: (v: number) => <Tag color={statusColor(v)}>{v}</Tag> },
    { title: "耗时", dataIndex: "durationMs", key: "durationMs", width: 90, render: (v: number) => <span style={{ color: v > 1000 ? "#ef4444" : "var(--ant-color-text-secondary, #8c8c8c)" }}>{v}ms</span> },
    { title: "IP", dataIndex: "ip", key: "ip", responsive: ["lg"], render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#bfbfbf" }}>{v || "-"}</span> },
    {
      title: "UA", dataIndex: "userAgent", key: "userAgent", responsive: ["xl"], render: (v: string) =>
        v ? <Tooltip title={v}><span style={{ display: "inline-block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v}</span></Tooltip> : <span style={{ color: "#bfbfbf" }}>-</span>,
    },
    { title: "时间", dataIndex: "createTime", key: "createTime", render: (v: string) => v ? formatDate(v) : "-" },
    {
      title: "操作", key: "actions", fixed: "right", width: 70, render: (_, row) => (
        <Popconfirm title="确定删除该条记录？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(row.id)}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="访问日志" desc={`共 ${total} 条记录`} />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Space wrap>
          <Input.Search placeholder="按路径筛选..." allowClear style={{ width: 220 }}
            onSearch={(v) => { setPathKw(v); setPageNum(1); loadLogs(1, v, keyword, range); }} />
          <Input.Search placeholder="搜索用户名 / IP..." allowClear style={{ width: 200 }}
            onSearch={(v) => { setKeyword(v); setPageNum(1); loadLogs(1, pathKw, v, range); }} />
          <RangePicker
            onChange={(_, ds) => {
              const r = { start: ds?.[0] ? `${ds[0]} 00:00:00` : undefined, end: ds?.[1] ? `${ds[1]} 23:59:59` : undefined };
              setRange(r); setPageNum(1); loadLogs(1, pathKw, keyword, r);
            }}
          />
        </Space>
        <Popconfirm title="确定清空全部访问日志？此操作不可恢复" okText="清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={handleClear}>
          <Button danger icon={<ClearOutlined />} disabled={total === 0}>清空日志</Button>
        </Popconfirm>
      </div>

      <Table<AccessLogVO>
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无访问记录" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: (p) => { setPageNum(p); loadLogs(p); } }}
      />
    </div>
  );
}
