"use client";

import { useEffect, useState } from "react";
import { Table, Input, Tag, Button, Modal, Select, InputNumber, Switch, Avatar, Space, Alert } from "antd";
import type { ColumnsType } from "antd/es/table";
import { UserOutlined, EditOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import { Coins } from "lucide-react";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { UserVO } from "@/types/user";
import type { RoleVO } from "@/types/role";
import type { AdminUserCreateDTO, VipLevelVO } from "@/types/admin";
import type { PageData } from "@/types/api";

const PAGE_SIZE = 15;

const ROLE_TAG: Record<number, { label: string; color: string }> = {
  0: { label: "普通用户", color: "default" },
  9: { label: "管理员", color: "red" },
};
const STATUS_TAG: Record<number, { label: string; color: string }> = {
  0: { label: "禁用", color: "red" },
  1: { label: "正常", color: "green" },
};

const createDefaultForm = () => ({
  username: "",
  email: "",
  password: "",
  nickname: "",
  phone: "",
  role: 0,
  vipLevel: 1,
  concurrencyUnlimited: 0,
  roleId: undefined as string | undefined,
  status: 1,
  apiQuota: 100,
  points: 100,
  storageQuotaMb: 1024,
});

export default function AdminUsersPage() {
  const can = useHasPerm();
  const [users, setUsers] = useState<UserVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roles, setRoles] = useState<RoleVO[]>([]);
  const [vipLevels, setVipLevels] = useState<VipLevelVO[]>([]);

  // 新建用户弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(createDefaultForm);
  const [createConfirm, setCreateConfirm] = useState("");
  const [creating, setCreating] = useState(false);

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<UserVO | null>(null);
  const [editForm, setEditForm] = useState<{ role: number; vipLevel: number; concurrencyUnlimited: number; status: number; apiQuota: number; roleId?: string }>({ role: 0, vipLevel: 1, concurrencyUnlimited: 0, status: 1, apiQuota: 0 });
  const [saving, setSaving] = useState(false);

  // 管理员手动重置密码。
  const [resetTarget, setResetTarget] = useState<UserVO | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetSaving, setResetSaving] = useState(false);

  // 积分调整（并入编辑弹窗）
  const [adjustAmount, setAdjustAmount] = useState<number | null>(null);
  const [adjustRemark, setAdjustRemark] = useState("");

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
  useEffect(() => { adminApi.roles.list().then((r) => { if (r.success) setRoles(r.data ?? []); }).catch(() => {}); }, []);
  useEffect(() => { adminApi.vipLevels.list().then((r) => { if (r.success) setVipLevels(r.data ?? []); }).catch(() => {}); }, []);

  const handleSearch = (v: string) => { setKeyword(v); setPageNum(1); loadUsers(1, v); };
  const handlePageChange = (p: number) => { setPageNum(p); loadUsers(p); };

  const openCreate = () => {
    setCreateForm(createDefaultForm());
    setCreateConfirm("");
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
    setCreateForm(createDefaultForm());
    setCreateConfirm("");
  };

  const handleCreate = async () => {
    const username = createForm.username.trim();
    const email = createForm.email.trim();
    const nickname = createForm.nickname.trim();
    const phone = createForm.phone.trim();
    if (!username) { toast.error("请输入用户名"); return; }
    if (!email) { toast.error("请输入邮箱"); return; }
    if (createForm.password.length < 6 || createForm.password.length > 32) {
      toast.error("初始密码长度需要在 6 到 32 位之间");
      return;
    }
    if (createForm.password !== createConfirm) {
      toast.error("两次输入的初始密码不一致");
      return;
    }
    if (!Number.isFinite(createForm.storageQuotaMb) || createForm.storageQuotaMb < 0) {
      toast.error("存储额度不能为负数");
      return;
    }
    const payload: AdminUserCreateDTO = {
      username,
      email,
      password: createForm.password,
      nickname: nickname || undefined,
      phone: phone || undefined,
      role: createForm.role,
      vipLevel: createForm.vipLevel,
      concurrencyUnlimited: createForm.concurrencyUnlimited,
      status: createForm.status,
      apiQuota: createForm.apiQuota,
      points: createForm.points,
      storageQuota: Math.round(createForm.storageQuotaMb * 1024 * 1024),
    };
    if (createForm.role === 9 && createForm.roleId) {
      payload.roleId = createForm.roleId;
    }
    setCreating(true);
    try {
      const res = await adminApi.users.create(payload);
      if (!res.success) {
        toast.error(res.message || "创建用户失败");
        return;
      }
      toast.success("用户已创建");
      setCreateOpen(false);
      setCreateForm(createDefaultForm());
      setCreateConfirm("");
      setPageNum(1);
      await loadUsers(1, keyword);
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (user: UserVO) => {
    setEditTarget(user);
    setEditForm({ role: user.role, vipLevel: user.vipLevel ?? 1, concurrencyUnlimited: user.concurrencyUnlimited ?? 0, status: user.status, apiQuota: user.apiQuota, roleId: user.roleId });
    setAdjustAmount(null);
    setAdjustRemark("");
  };

  const openResetPassword = (user: UserVO) => {
    setResetTarget(user);
    setResetPassword("");
    setResetConfirm("");
  };

  const closeResetPassword = () => {
    if (resetSaving) return;
    setResetTarget(null);
    setResetPassword("");
    setResetConfirm("");
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    if (resetPassword.length < 6 || resetPassword.length > 32) {
      toast.error("新密码长度需要在 6 到 32 位之间");
      return;
    }
    if (resetPassword !== resetConfirm) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setResetSaving(true);
    try {
      const res = await adminApi.users.resetPassword(resetTarget.id, { newPassword: resetPassword });
      if (!res.success) {
        toast.error(res.message || "重置密码失败");
        return;
      }
      toast.success("密码已重置");
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setResetSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editTarget) return;
    const amount = Number(adjustAmount);
    const wantAdjust = can("points:adjust") && Number.isFinite(amount) && amount !== 0;
    setSaving(true);
    try {
      // 1. 保存用户字段（有编辑权限时）
      if (can("user:edit")) {
        const res = await adminApi.users.update(editTarget.id, editForm);
        if (!res.success) { toast.error(res.message || "保存失败"); return; }
      }
      // 2. 调整积分（填了非零金额且有权限时）
      if (wantAdjust) {
        const res = await adminApi.points.adjust({ userId: editTarget.id, amount, remark: adjustRemark || undefined });
        if (!res.success) { toast.error(res.message || "积分调整失败"); return; }
      }
      toast.success(wantAdjust ? `已保存，积分 ${amount > 0 ? "+" : ""}${amount}` : "已保存");
      setEditTarget(null);
      loadUsers();
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<UserVO> = [
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
    { title: "邮箱", dataIndex: "email", key: "email", responsive: ["md"], render: (v) => <span style={{ color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v}</span> },
    { title: "角色", dataIndex: "role", key: "role", render: (r: number) => { const t = ROLE_TAG[r] ?? ROLE_TAG[0]; return <Tag color={t.color}>{t.label}</Tag>; } },
    { title: "会员等级", dataIndex: "vipLevel", key: "vipLevel", responsive: ["md"], render: (lv: number | undefined, u) => { if (u.role === 9) return <span style={{ color: "#bfbfbf" }}>-</span>; const level = lv ?? 1; const cfg = vipLevels.find((v) => v.level === level); return <Tag color="purple">{cfg?.name ?? `VIP${level}`}</Tag>; } },
    { title: "免并发限制", dataIndex: "concurrencyUnlimited", key: "concurrencyUnlimited", responsive: ["lg"], render: (v: number | undefined) => (v === 1 ? <Tag color="cyan">是</Tag> : <span style={{ color: "#bfbfbf" }}>否</span>) },
    {
      title: "管理角色", dataIndex: "roleId", key: "roleId", responsive: ["md"], render: (rid: string | undefined, u) => {
        if (u.role !== 9) return <span style={{ color: "#bfbfbf" }}>-</span>;
        const role = roles.find((r) => r.id === rid);
        return <Tag color="blue">{role?.name ?? "超级管理员"}</Tag>;
      },
    },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => { const t = STATUS_TAG[s] ?? STATUS_TAG[1]; return <Tag color={t.color}>{t.label}</Tag>; } },
    { title: "积分", dataIndex: "points", key: "points", render: (v) => <span style={{ fontWeight: 500 }}>{v ?? 0}</span> },
    { title: "签约作者", dataIndex: "isAuthor", key: "isAuthor", responsive: ["lg"], render: (v: number) => (v === 1 ? <Tag color="gold">是</Tag> : <span style={{ color: "#bfbfbf" }}>否</span>) },
    { title: "注册时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v: string) => (v ? formatDate(v) : "-") },
    {
      title: "操作", key: "action", render: (_, u) => (
        can("user:edit") || can("points:adjust") ? (
          <Space size={4}>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(u)}>编辑</Button>
            {can("user:edit") && (
              <Button size="small" type="text" danger icon={<LockOutlined />} onClick={() => openResetPassword(u)}>重置密码</Button>
            )}
          </Space>
        ) : <span style={{ color: "#bfbfbf" }}>-</span>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="用户管理" desc={`共 ${total} 个用户`} />
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Input.Search placeholder="搜索用户名、邮箱、昵称..." allowClear enterButton style={{ maxWidth: 360, flex: 1 }} onSearch={handleSearch} />
        {can("user:edit") && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建用户</Button>
        )}
      </div>

      <Table<UserVO>
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无用户数据" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: handlePageChange }}
      />

      {/* 新建用户 */}
      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={closeCreate}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="创建用户"
        cancelText="取消"
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <Alert type="info" showIcon message="创建后用户可立即使用初始密码登录" />
          <div>
            <div style={{ marginBottom: 6 }}>用户名</div>
            <Input value={createForm.username} maxLength={64} placeholder="请输入用户名" onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} />
          </div>
          <div>
            <div style={{ marginBottom: 6 }}>邮箱</div>
            <Input value={createForm.email} maxLength={128} placeholder="请输入邮箱" onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
          </div>
          <div>
            <div style={{ marginBottom: 6 }}>初始密码</div>
            <Input.Password value={createForm.password} minLength={6} maxLength={32} placeholder="请输入 6-32 位初始密码" onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
          </div>
          <div>
            <div style={{ marginBottom: 6 }}>确认密码</div>
            <Input.Password value={createConfirm} minLength={6} maxLength={32} placeholder="请再次输入初始密码" onChange={(e) => setCreateConfirm(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ marginBottom: 6 }}>昵称</div>
              <Input value={createForm.nickname} maxLength={64} placeholder="默认同用户名" onChange={(e) => setCreateForm({ ...createForm, nickname: e.target.value })} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>手机号</div>
              <Input value={createForm.phone} maxLength={20} placeholder="可选" onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ marginBottom: 6 }}>角色</div>
              <Select style={{ width: "100%" }} value={createForm.role} onChange={(v) => setCreateForm({ ...createForm, role: v, roleId: v === 9 ? createForm.roleId : undefined })} options={[{ value: 0, label: "普通用户" }, { value: 9, label: "管理员" }]} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>状态</div>
              <Select style={{ width: "100%" }} value={createForm.status} onChange={(v) => setCreateForm({ ...createForm, status: v })} options={[{ value: 1, label: "正常" }, { value: 0, label: "禁用" }]} />
            </div>
          </div>
          {createForm.role !== 9 ? (
            <div>
              <div style={{ marginBottom: 6 }}>会员等级</div>
              <Select
                style={{ width: "100%" }}
                value={createForm.vipLevel}
                onChange={(v) => setCreateForm({ ...createForm, vipLevel: v })}
                options={vipLevels.map((v) => ({ value: v.level, label: v.name + "（并发 " + (v.concurrency === 0 ? "不限" : v.concurrency) + "）" }))}
                notFoundContent="请先在「会员等级」页配置等级"
              />
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 6 }}>管理角色（决定后台操作权限）</div>
              <Select
                allowClear
                style={{ width: "100%" }}
                value={createForm.roleId}
                placeholder="选择角色（未选=超级管理员）"
                onChange={(v) => setCreateForm({ ...createForm, roleId: v })}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
              />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ marginBottom: 6 }}>API 额度</div>
              <InputNumber style={{ width: "100%" }} min={0} value={createForm.apiQuota} onChange={(v) => setCreateForm({ ...createForm, apiQuota: v ?? 0 })} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>初始积分</div>
              <InputNumber style={{ width: "100%" }} min={0} value={createForm.points} onChange={(v) => setCreateForm({ ...createForm, points: v ?? 0 })} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>存储额度（MB）</div>
              <InputNumber style={{ width: "100%" }} min={0} value={createForm.storageQuotaMb} onChange={(v) => setCreateForm({ ...createForm, storageQuotaMb: v ?? 0 })} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 500 }}>免 AI 并发限制</div>
              <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 2 }}>开启后该用户不受 AI 并发上限约束</div>
            </div>
            <Switch checked={createForm.concurrencyUnlimited === 1} onChange={(c) => setCreateForm({ ...createForm, concurrencyUnlimited: c ? 1 : 0 })} />
          </div>
        </div>
      </Modal>

      {/* 编辑用户 */}
      <Modal title="编辑用户" open={!!editTarget} onCancel={() => setEditTarget(null)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消">
        {editTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{editTarget.nickname || editTarget.username} <span style={{ color: "#bfbfbf" }}>@{editTarget.username}</span></div>
            <div>
              <div style={{ marginBottom: 6 }}>角色</div>
              <Select style={{ width: "100%" }} value={editForm.role} onChange={(v) => setEditForm({ ...editForm, role: v })}
                options={[{ value: 0, label: "普通用户" }, { value: 9, label: "管理员" }]} />
            </div>
            {editForm.role !== 9 && (
              <div>
                <div style={{ marginBottom: 6 }}>会员等级</div>
                <Select style={{ width: "100%" }} value={editForm.vipLevel} onChange={(v) => setEditForm({ ...editForm, vipLevel: v })}
                  options={vipLevels.map((v) => ({ value: v.level, label: `${v.name}（并发 ${v.concurrency === 0 ? "不限" : v.concurrency}）` }))}
                  notFoundContent="请先在「会员等级」页配置等级" />
              </div>
            )}
            {editForm.role === 9 && (
              <div>
                <div style={{ marginBottom: 6 }}>管理角色（决定后台操作权限）</div>
                <Select style={{ width: "100%" }} value={editForm.roleId} placeholder="选择角色（未选=超级管理员）"
                  onChange={(v) => setEditForm({ ...editForm, roleId: v })}
                  options={roles.map((r) => ({ value: r.id, label: r.name }))} />
              </div>
            )}
            <div>
              <div style={{ marginBottom: 6 }}>状态</div>
              <Select style={{ width: "100%" }} value={editForm.status} onChange={(v) => setEditForm({ ...editForm, status: v })}
                options={[{ value: 1, label: "正常" }, { value: 0, label: "禁用" }]} />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>API 额度</div>
              <InputNumber style={{ width: "100%" }} min={0} value={editForm.apiQuota} onChange={(v) => setEditForm({ ...editForm, apiQuota: v ?? 0 })} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <div>
                <div style={{ fontWeight: 500 }}>免 AI 并发限制</div>
                <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 2 }}>开启后该用户不受 AI 并发上限约束（管理员始终不受限）</div>
              </div>
              <Switch checked={editForm.concurrencyUnlimited === 1} onChange={(c) => setEditForm({ ...editForm, concurrencyUnlimited: c ? 1 : 0 })} />
            </div>
            {can("points:adjust") && (
              <div style={{ borderTop: "1px solid var(--ant-color-border-secondary, #f0f0f0)", paddingTop: 16 }}>
                <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <Coins size={14} color="#d97706" /> 积分调整
                  <span style={{ fontSize: 12, color: "#bfbfbf" }}>当前 {editTarget.points ?? 0}</span>
                </div>
                <InputNumber style={{ width: "100%" }} placeholder="正数增加，负数扣减，留空不变" value={adjustAmount} onChange={setAdjustAmount} />
                <Input style={{ marginTop: 8 }} placeholder="调整备注（可选）" value={adjustRemark} onChange={(e) => setAdjustRemark(e.target.value)} />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 管理员手动重置密码 */}
      <Modal
        title="重置密码"
        open={!!resetTarget}
        onCancel={closeResetPassword}
        onOk={handleResetPassword}
        confirmLoading={resetSaving}
        okText="确认重置"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        {resetTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <Alert
              type="warning"
              showIcon
              message="该操作会立即替换用户当前登录密码"
              description="完成后请把新密码通过安全渠道告知用户。"
            />
            <div style={{ color: "var(--ant-color-text-secondary, #8c8c8c)" }}>
              {resetTarget.nickname || resetTarget.username} <span style={{ color: "#bfbfbf" }}>@{resetTarget.username}</span>
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>新密码</div>
              <Input.Password
                value={resetPassword}
                minLength={6}
                maxLength={32}
                placeholder="请输入 6-32 位新密码"
                onChange={(e) => setResetPassword(e.target.value)}
              />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>确认新密码</div>
              <Input.Password
                value={resetConfirm}
                minLength={6}
                maxLength={32}
                placeholder="请再次输入新密码"
                onChange={(e) => setResetConfirm(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
