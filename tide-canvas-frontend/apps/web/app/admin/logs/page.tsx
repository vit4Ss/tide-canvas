"use client";

import { useEffect, useState } from "react";
import { Table, Input, Select, DatePicker, Space, Tag, Alert, Tooltip, Button, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, ClearOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { LogVO, LogQuery } from "@/types/admin";
import type { PageData } from "@/types/api";

const { RangePicker } = DatePicker;
const PAGE_SIZE = 20;

// 选项值需与后端 @OperateLog(action=...) 记录的中文完全一致（后端按 action 精确匹配筛选）
const ACTION_OPTIONS = [
  { value: "", label: "全部操作" },
  { value: "编辑用户", label: "编辑用户" },
  { value: "调整积分", label: "调整积分" },
  { value: "退还积分", label: "退还积分" },
  { value: "审核内容", label: "审核内容" },
  { value: "授予作者", label: "授予作者" },
  { value: "撤销作者", label: "撤销作者" },
  { value: "确认订单支付", label: "确认订单支付" },
  { value: "生成兑换码", label: "生成兑换码" },
  { value: "新增Banner", label: "新增Banner" },
  { value: "删除Banner", label: "删除Banner" },
  { value: "更新配置", label: "更新配置" },
];

export default function AdminLogsPage() {
  const can = useHasPerm();
  const [logs, setLogs] = useState<LogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [range, setRange] = useState<{ start?: string; end?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = async (page = pageNum, search = keyword, action = actionFilter, r = range) => {
    setLoading(true);
    setError("");
    try {
      const query: LogQuery = {
        pageNum: page, pageSize: PAGE_SIZE,
        keyword: search || undefined,
        action: action || undefined,
        startTime: r.start || undefined,
        endTime: r.end || undefined,
      };
      const res = await adminApi.logs.list(query);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<LogVO>;
        setLogs(data.records);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载日志列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLogs(1); }, []);

  const handleDelete = async (id: number) => {
    const res = await adminApi.logs.remove(id);
    if (res.success) {
      toast.success("已删除");
      loadLogs();
    } else {
      toast.error(res.message || "删除失败");
    }
  };

  const handleClear = async () => {
    const res = await adminApi.logs.clear();
    if (res.success) {
      toast.success("已清空日志");
      setPageNum(1);
      loadLogs(1);
    } else {
      toast.error(res.message || "清空失败");
    }
  };

  const columns: ColumnsType<LogVO> = [
    { title: "用户", dataIndex: "username", key: "username", render: (v) => <span style={{ fontWeight: 500 }}>{v || "-"}</span> },
    { title: "操作", dataIndex: "action", key: "action", render: (v: string) => <Tag>{v}</Tag> },
    { title: "目标", dataIndex: "target", key: "target", ellipsis: true, render: (v) => v || "-" },
    {
      title: "详情", dataIndex: "detail", key: "detail", responsive: ["md"], render: (v: string) =>
        v ? <Tooltip title={v}><span style={{ display: "inline-block", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v}</span></Tooltip> : <span style={{ color: "#bfbfbf" }}>-</span>,
    },
    { title: "IP", dataIndex: "ip", key: "ip", responsive: ["lg"], render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#bfbfbf" }}>{v || "-"}</span> },
    { title: "时间", dataIndex: "createTime", key: "createTime", render: (v: string) => v ? formatDate(v) : "-" },
    {
      title: "操作", key: "actions", fixed: "right", width: 70, render: (_, row) => (
        can("syslog:delete") && (
          <Popconfirm title="确定删除该日志？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(row.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        )
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="系统日志" desc={`共 ${total} 条记录`} />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Space wrap>
          <Input.Search placeholder="搜索操作详情..." allowClear enterButton style={{ width: 260 }}
            onSearch={(v) => { setKeyword(v); setPageNum(1); loadLogs(1, v, actionFilter, range); }} />
          <Select style={{ width: 150 }} value={actionFilter} options={ACTION_OPTIONS}
            onChange={(v) => { setActionFilter(v); setPageNum(1); loadLogs(1, keyword, v, range); }} />
          <RangePicker
            onChange={(_, ds) => {
              const r = { start: ds?.[0] ? `${ds[0]} 00:00:00` : undefined, end: ds?.[1] ? `${ds[1]} 23:59:59` : undefined };
              setRange(r); setPageNum(1); loadLogs(1, keyword, actionFilter, r);
            }}
          />
        </Space>
        {can("syslog:delete") && (
          <Popconfirm title="确定清空全部日志？此操作不可恢复" okText="清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={handleClear}>
            <Button danger icon={<ClearOutlined />} disabled={total === 0}>清空日志</Button>
          </Popconfirm>
        )}
      </div>

      <Table<LogVO>
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无日志记录" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: (p) => { setPageNum(p); loadLogs(p); } }}
      />
    </div>
  );
}
