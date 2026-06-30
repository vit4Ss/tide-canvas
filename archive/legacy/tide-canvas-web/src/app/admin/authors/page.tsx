"use client";

import { useEffect, useState, useCallback } from "react";
import { Table, Input, Button, Modal, Tag, Avatar, Space, Alert, InputNumber, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { UserAddOutlined, UserOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { AdminPageHead } from "@/components/admin/page-head";
import type { AdminUserVO } from "@/types/admin";

const PAGE_SIZE = 20;

export default function AdminAuthorsPage() {
  const can = useHasPerm();
  const [authors, setAuthors] = useState<AdminUserVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUserId, setGrantUserId] = useState<number | null>(null);
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const fetchAuthors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.authors.list({ pageNum, pageSize: PAGE_SIZE, keyword: keyword || undefined });
      if (res.success) { setAuthors(res.data.records); setTotal(res.data.total); }
      else setError(res.message || "加载失败");
    } catch {
      setError("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [pageNum, keyword]);

  useEffect(() => { fetchAuthors(); }, [fetchAuthors]);

  const handleGrant = async () => {
    if (!grantUserId) return;
    setGranting(true);
    setError("");
    try {
      const res = await adminApi.authors.grant(grantUserId);
      if (res.success) { setGrantOpen(false); setGrantUserId(null); fetchAuthors(); }
      else setError(res.message || "授权失败");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (userId: number) => {
    setRevokingId(userId);
    setError("");
    try {
      const res = await adminApi.authors.revoke(userId);
      if (res.success) fetchAuthors();
      else setError(res.message || "撤销失败");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setRevokingId(null);
    }
  };

  const columns: ColumnsType<AdminUserVO> = [
    {
      title: "作者", key: "user", render: (_, a) => (
        <Space>
          <Avatar src={a.avatar || undefined} icon={<UserOutlined />} size="small" />
          <div>
            <Space size={6}>
              <span style={{ fontWeight: 500 }}>{a.nickname || a.username}</span>
              <Tag color="green" icon={<CheckCircleOutlined />}>签约作者</Tag>
            </Space>
            <div style={{ fontSize: 12, color: "#bfbfbf" }}>@{a.username} · ID: {a.id}</div>
          </div>
        </Space>
      ),
    },
    { title: "邮箱", dataIndex: "email", key: "email", responsive: ["md"], render: (v) => <span style={{ color: "#8c8c8c" }}>{v}</span> },
    {
      title: "操作", key: "action", align: "right", render: (_, a) => (
        can("author:manage") && (
          <Popconfirm title="撤销该作者的签约权限？" okText="撤销" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleRevoke(a.id)}>
            <Button danger size="small" loading={revokingId === a.id}>撤销</Button>
          </Popconfirm>
        )
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="作者管理"
        desc="管理签约作者的权限"
        extra={can("author:manage") && <Button type="primary" icon={<UserAddOutlined />} onClick={() => setGrantOpen(true)}>授权作者</Button>}
      />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <Input.Search placeholder="搜索用户名或昵称..." allowClear enterButton style={{ maxWidth: 360 }} onSearch={(v) => { setKeyword(v); setPageNum(1); }} />

      <Table<AdminUserVO>
        rowKey="id"
        columns={columns}
        dataSource={authors}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无签约作者，点击右上角授权" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: setPageNum }}
      />

      <Modal title="授权作者" open={grantOpen} onCancel={() => setGrantOpen(false)} onOk={handleGrant} confirmLoading={granting} okText="确认授权" cancelText="取消" okButtonProps={{ disabled: !grantUserId }}>
        <div style={{ paddingTop: 8 }}>
          <div style={{ marginBottom: 6 }}>用户 ID</div>
          <InputNumber style={{ width: "100%" }} placeholder="输入用户ID" min={1} value={grantUserId} onChange={setGrantUserId} onPressEnter={handleGrant} />
        </div>
      </Modal>
    </div>
  );
}
