"use client";

import { useEffect, useState } from "react";
import { Table, Input, Tag, Button, Modal, Select, InputNumber, Avatar, Space, Alert } from "antd";
import type { ColumnsType } from "antd/es/table";
import { UserOutlined, EditOutlined } from "@ant-design/icons";
import { Coins } from "lucide-react";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import type { UserVO } from "@/types/user";
import type { PageData } from "@/types/api";

const PAGE_SIZE = 15;

const ROLE_TAG: Record<number, { label: string; color: string }> = {
  0: { label: "普通用户", color: "default" },
  1: { label: "VIP", color: "gold" },
  9: { label: "管理员", color: "red" },
};
const STATUS_TAG: Record<number, { label: string; color: string }> = {
  0: { label: "禁用", color: "red" },
  1: { label: "正常", color: "green" },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<UserVO | null>(null);
  const [editForm, setEditForm] = useState({ role: 0, status: 1, apiQuota: 0 });
  const [saving, setSaving] = useState(false);

  // 调积分弹窗
  const [adjustTarget, setAdjustTarget] = useState<UserVO | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<number | null>(null);
  const [adjustRemark, setAdjustRemark] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const loadUsers = async (page = pageNum, search = keyword) => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.users.list({ pageNum: page, pageSize: PAGE_SIZE, keyword: search || undefined });
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<UserVO>;
        setUsers(data.records);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(1); }, []);

  const handleSearch = (v: string) => { setKeyword(v); setPageNum(1); loadUsers(1, v); };
  const handlePageChange = (p: number) => { setPageNum(p); loadUsers(p); };

  const openEdit = (user: UserVO) => {
    setEditTarget(user);
    setEditForm({ role: user.role, status: user.status, apiQuota: user.apiQuota });
  };

  const handleSave = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const res = await adminApi.users.update(editTarget.id, editForm);
      if (res.success) {
        toast.success("已保存");
        setEditTarget(null);
        loadUsers();
      } else {
        toast.error(res.message || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAdjust = async () => {
    if (!adjustTarget) return;
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("请输入有效金额（正数增加，负数扣减）");
      return;
    }
    setAdjusting(true);
    try {
      const res = await adminApi.points.adjust({ userId: adjustTarget.id, amount, remark: adjustRemark || undefined });
      if (res.success) {
        toast.success(`已为 ${adjustTarget.nickname || adjustTarget.username} 调整 ${amount > 0 ? "+" : ""}${amount} 积分`);
        setAdjustTarget(null);
        loadUsers();
      } else {
        toast.error(res.message || "调整失败");
      }
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setAdjusting(false);
    }
  };

  const columns: ColumnsType<UserVO> = [
    { title: "ID", dataIndex: "id", key: "id", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{String(v).slice(-6)}</span> },
    {
      title: "用户", key: "user", render: (_, u) => (
        <Space>
          <Avatar src={u.avatar || undefined} icon={<UserOutlined />} size="small" />
          <div>
            <div style={{ fontWeight: 500 }}>{u.nickname || u.username}</div>
            <div style={{ fontSize: 12, color: "#bfbfbf" }}>@{u.username}</div>
          </div>
        </Space>
      ),
    },
    { title: "邮箱", dataIndex: "email", key: "email", responsive: ["md"], render: (v) => <span style={{ color: "#8c8c8c" }}>{v}</span> },
    { title: "角色", dataIndex: "role", key: "role", render: (r: number) => { const t = ROLE_TAG[r] ?? ROLE_TAG[0]; return <Tag color={t.color}>{t.label}</Tag>; } },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => { const t = STATUS_TAG[s] ?? STATUS_TAG[1]; return <Tag color={t.color}>{t.label}</Tag>; } },
    { title: "积分", dataIndex: "points", key: "points", render: (v) => <span style={{ fontWeight: 500 }}>{v ?? 0}</span> },
    { title: "签约作者", dataIndex: "isAuthor", key: "isAuthor", responsive: ["lg"], render: (v: number) => (v === 1 ? <Tag color="gold">是</Tag> : <span style={{ color: "#bfbfbf" }}>否</span>) },
    { title: "注册时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v: string) => (v ? new Date(v).toLocaleDateString("zh-CN") : "-") },
    {
      title: "操作", key: "action", render: (_, u) => (
        <Space size={4}>
          <Button size="small" type="text" icon={<Coins size={14} />} style={{ color: "#d97706" }} onClick={() => { setAdjustTarget(u); setAdjustAmount(null); setAdjustRemark(""); }}>调积分</Button>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(u)}>编辑</Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="用户管理" desc={`共 ${total} 个用户`} />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <Input.Search placeholder="搜索用户名、邮箱、昵称..." allowClear enterButton style={{ maxWidth: 360 }} onSearch={handleSearch} />

      <Table<UserVO>
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无用户数据" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: handlePageChange }}
      />

      {/* 编辑用户 */}
      <Modal title="编辑用户" open={!!editTarget} onCancel={() => setEditTarget(null)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消">
        {editTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <div style={{ color: "#8c8c8c" }}>{editTarget.nickname || editTarget.username} <span style={{ color: "#bfbfbf" }}>@{editTarget.username}</span></div>
            <div>
              <div style={{ marginBottom: 6 }}>角色</div>
              <Select style={{ width: "100%" }} value={editForm.role} onChange={(v) => setEditForm({ ...editForm, role: v })}
                options={[{ value: 0, label: "普通用户" }, { value: 1, label: "VIP" }, { value: 9, label: "管理员" }]} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>状态</div>
              <Select style={{ width: "100%" }} value={editForm.status} onChange={(v) => setEditForm({ ...editForm, status: v })}
                options={[{ value: 1, label: "正常" }, { value: 0, label: "禁用" }]} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>API 额度</div>
              <InputNumber style={{ width: "100%" }} min={0} value={editForm.apiQuota} onChange={(v) => setEditForm({ ...editForm, apiQuota: v ?? 0 })} />
            </div>
          </div>
        )}
      </Modal>

      {/* 调整积分 */}
      <Modal
        title={<Space><Coins size={18} color="#d97706" /> 调整积分</Space>}
        open={!!adjustTarget}
        onCancel={() => setAdjustTarget(null)}
        onOk={handleAdjust}
        confirmLoading={adjusting}
        okText="提交"
        cancelText="取消"
        okButtonProps={{ disabled: !adjustAmount }}
      >
        {adjustTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <div style={{ color: "#8c8c8c" }}>
              用户：<b style={{ color: "#262626" }}>{adjustTarget.nickname || adjustTarget.username}</b>
              <span style={{ color: "#bfbfbf" }}> @{adjustTarget.username}</span>
              　当前积分 <b style={{ color: "#d97706" }}>{adjustTarget.points ?? 0}</b>
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>金额（+/-）</div>
              <InputNumber style={{ width: "100%" }} placeholder="正数增加，负数扣减" autoFocus value={adjustAmount} onChange={setAdjustAmount} onPressEnter={handleAdjust} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>备注</div>
              <Input placeholder="调整原因（可选）" value={adjustRemark} onChange={(e) => setAdjustRemark(e.target.value)} onPressEnter={handleAdjust} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
