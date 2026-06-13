"use client";

import { useEffect, useState } from "react";
import { Table, Input, Select, DatePicker, Space, Tag, Alert, Tooltip, Button, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, ClearOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { LoginLogVO, LoginLogQuery } from "@/types/admin";
import type { PageData } from "@/types/api";

const { RangePicker } = DatePicker;
const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "", label: "全部结果" },
  { value: "1", label: "成功" },
  { value: "0", label: "失败" },
];

export default function AdminLoginLogsPage() {
  const [logs, setLogs] = useState<LoginLogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [range, setRange] = useState<{ start?: string; end?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = async (page = pageNum, kw = keyword, status = statusFilter, r = range) => {
    setLoading(true);
    setError("");
    try {
      const query: LoginLogQuery = {
        pageNum: page, pageSize: PAGE_SIZE,
        keyword: kw || undefined,
        status: status === "" ? undefined : Number(status),
        startTime: r.start || undefined,
        endTime: r.end || undefined,
      };
      const res = await adminApi.loginLogs.list(query);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<LoginLogVO>;
        setLogs(data.records);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载登录日志失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLogs(1); }, []);

  const handleDelete = async (id: number) => {
    const res = await adminApi.loginLogs.remove(id);
    if (res.success) { toast.success("已删除"); loadLogs(); }
    else toast.error(res.message || "删除失败");
  };

  const handleClear = async () => {
    const res = await adminApi.loginLogs.clear();
    if (res.success) { toast.success("已清空登录日志"); setPageNum(1); loadLogs(1); }
    else toast.error(res.message || "清空失败");
  };

  const columns: ColumnsType<LoginLogVO> = [
    { title: "账号", dataIndex: "username", key: "username", render: (v) => <span style={{ fontWeight: 500 }}>{v || "-"}</span> },
    {
      title: "结果", dataIndex: "status", key: "status", width: 90, render: (v: number) =>
        v === 1
          ? <Tag color="green" icon={<CheckCircleOutlined />}>成功</Tag>
          : <Tag color="red" icon={<CloseCircleOutlined />}>失败</Tag>,
    },
    { title: "失败原因", dataIndex: "failReason", key: "failReason", render: (v) => v || <span style={{ color: "#bfbfbf" }}>-</span> },
    { title: "IP", dataIndex: "ip", key: "ip", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v || "-"}</span> },
    {
      title: "UA", dataIndex: "userAgent", key: "userAgent", responsive: ["lg"], render: (v: string) =>
        v ? <Tooltip title={v}><span style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v}</span></Tooltip> : <span style={{ color: "#bfbfbf" }}>-</span>,
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
      <AdminPageHead title="登录日志" desc={`共 ${total} 条记录`} />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Space wrap>
          <Input.Search placeholder="搜索账号 / IP..." allowClear enterButton style={{ width: 240 }}
            onSearch={(v) => { setKeyword(v); setPageNum(1); loadLogs(1, v, statusFilter, range); }} />
          <Select style={{ width: 130 }} value={statusFilter} options={STATUS_OPTIONS}
            onChange={(v) => { setStatusFilter(v); setPageNum(1); loadLogs(1, keyword, v, range); }} />
          <RangePicker
            onChange={(_, ds) => {
              const r = { start: ds?.[0] ? `${ds[0]} 00:00:00` : undefined, end: ds?.[1] ? `${ds[1]} 23:59:59` : undefined };
              setRange(r); setPageNum(1); loadLogs(1, keyword, statusFilter, r);
            }}
          />
        </Space>
        <Popconfirm title="确定清空全部登录日志？此操作不可恢复" okText="清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={handleClear}>
          <Button danger icon={<ClearOutlined />} disabled={total === 0}>清空日志</Button>
        </Popconfirm>
      </div>

      <Table<LoginLogVO>
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无登录记录" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: (p) => { setPageNum(p); loadLogs(p); } }}
      />
    </div>
  );
}
