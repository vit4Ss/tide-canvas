"use client";

import { useEffect, useState } from "react";
import { Table, Input, Select, Button, Tag, Space, Alert, Image as AntdImage } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckOutlined, StopOutlined, FileImageOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { ContentVO, ContentQuery } from "@/types/admin";
import type { PageData } from "@/types/api";

const PAGE_SIZE = 15;
const STATUS_TAG: Record<number, { label: string; color: string }> = {
  0: { label: "草稿", color: "default" },
  1: { label: "已发布", color: "green" },
  2: { label: "已下架", color: "red" },
};

export default function AdminContentsPage() {
  const [contents, setContents] = useState<ContentVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadContents = async (page = pageNum, search = keyword, status = statusFilter) => {
    setLoading(true);
    setError("");
    try {
      const query: ContentQuery = { pageNum: page, pageSize: PAGE_SIZE, keyword: search || undefined, status };
      const res = await adminApi.contents.list(query);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<ContentVO>;
        setContents(data.records);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载内容列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadContents(1); }, []);

  const handleAudit = async (id: number, status: number) => {
    setAuditing(id);
    try {
      const res = await adminApi.contents.audit(id, { status });
      if (res.success) loadContents();
    } finally {
      setAuditing(null);
    }
  };

  const columns: ColumnsType<ContentVO> = [
    { title: "ID", dataIndex: "id", key: "id", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#bfbfbf" }}>{String(v).slice(-6)}</span> },
    {
      title: "缩略图", dataIndex: "thumbnail", key: "thumbnail", render: (v: string, r) =>
        v ? <AntdImage src={v} alt={r.name} width={64} height={40} style={{ objectFit: "cover", borderRadius: 4 }} />
          : <div style={{ width: 64, height: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5", borderRadius: 4 }}><FileImageOutlined style={{ color: "#bfbfbf" }} /></div>,
    },
    { title: "作品名称", dataIndex: "name", key: "name", ellipsis: true, render: (v) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: "创建者", dataIndex: "ownerName", key: "ownerName", responsive: ["md"], render: (v) => <span style={{ color: "#8c8c8c" }}>{v}</span> },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => { const t = STATUS_TAG[s] ?? STATUS_TAG[0]; return <Tag color={t.color}>{t.label}</Tag>; } },
    { title: "创建时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v: string) => v ? formatDate(v) : "-" },
    {
      title: "操作", key: "action", render: (_, item) => (
        <Space size={4}>
          {item.status !== 1 && <Button type="text" size="small" icon={<CheckOutlined />} style={{ color: "#16a34a" }} loading={auditing === item.id} onClick={() => handleAudit(item.id, 1)}>通过</Button>}
          {item.status !== 2 && <Button type="text" size="small" danger icon={<StopOutlined />} loading={auditing === item.id} onClick={() => handleAudit(item.id, 2)}>下架</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="作品审核" desc={`共 ${total} 个作品`} />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <Space wrap>
        <Input.Search placeholder="搜索作品名称..." allowClear enterButton style={{ width: 260 }}
          onSearch={(v) => { setKeyword(v); setPageNum(1); loadContents(1, v, statusFilter); }} />
        <Select style={{ width: 140 }} value={statusFilter ?? ""} onChange={(v) => { const s = v === "" ? undefined : Number(v); setStatusFilter(s); setPageNum(1); loadContents(1, keyword, s); }}
          options={[{ value: "", label: "全部状态" }, { value: 0, label: "草稿" }, { value: 1, label: "已发布" }, { value: 2, label: "已下架" }]} />
      </Space>

      <Table<ContentVO>
        rowKey="id"
        columns={columns}
        dataSource={contents}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无作品数据" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: (p) => { setPageNum(p); loadContents(p); } }}
      />
    </div>
  );
}
