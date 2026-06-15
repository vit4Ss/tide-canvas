"use client";

import { useCallback, useEffect, useState } from "react";
import { Table, Button, Modal, Input, Tag, Popconfirm, Checkbox, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { RoleVO, PermissionGroup, RoleSaveDTO } from "@/types/role";

const EMPTY: RoleSaveDTO = { name: "", code: "", permissions: [], remark: "" };

export default function AdminRolesPage() {
  const can = useHasPerm();
  const [roles, setRoles] = useState<RoleVO[]>([]);
  const [catalog, setCatalog] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleVO | null>(null);
  const [form, setForm] = useState<RoleSaveDTO>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([adminApi.roles.list(), adminApi.roles.catalog()]);
      if (r.success) setRoles(r.data ?? []);
      if (c.success) setCatalog(c.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const allCodes = catalog.flatMap((g) => g.items.map((i) => i.code));
  const isSuper = editing?.code === "super";

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true); };
  const openEdit = (r: RoleVO) => {
    setEditing(r);
    setForm({ name: r.name, code: r.code, permissions: r.permissions.includes("*") ? allCodes : r.permissions, remark: r.remark ?? "" });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast.error("角色名和编码必填"); return; }
    setSaving(true);
    try {
      const res = editing ? await adminApi.roles.update(editing.id, form) : await adminApi.roles.create(form);
      if (res.success) { toast.success("已保存"); setModalOpen(false); load(); }
      else toast.error(res.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const del = async (r: RoleVO) => {
    const res = await adminApi.roles.remove(r.id);
    if (res.success) { toast.success("已删除"); load(); } else toast.error(res.message || "删除失败");
  };

  const toggleGroup = (codes: string[], checked: boolean) => {
    setForm((f) => ({
      ...f,
      permissions: checked
        ? Array.from(new Set([...f.permissions, ...codes]))
        : f.permissions.filter((c) => !codes.includes(c)),
    }));
  };
  const toggleOne = (code: string, checked: boolean) => {
    setForm((f) => ({ ...f, permissions: checked ? [...f.permissions, code] : f.permissions.filter((c) => c !== code) }));
  };

  const columns: ColumnsType<RoleVO> = [
    { title: "角色", dataIndex: "name", key: "name", render: (v: string, r) => <span style={{ fontWeight: 500 }}>{v}{r.builtin ? <Tag color="blue" style={{ marginLeft: 8 }}>内置</Tag> : null}</span> },
    { title: "编码", dataIndex: "code", key: "code", render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> },
    { title: "权限数", dataIndex: "permissions", key: "permissions", render: (p: string[]) => p.includes("*") ? <Tag color="gold">全部</Tag> : <span>{p.length}</span> },
    { title: "备注", dataIndex: "remark", key: "remark", responsive: ["md"], render: (v) => v || "-" },
    { title: "创建时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v) => v ? formatDate(v) : "-" },
    {
      title: "操作", key: "action", align: "right", render: (_, r) => (
        <Space size={0}>
          {can("role:manage") && (
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          )}
          {can("role:manage") && (
            <Popconfirm title="删除该角色？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => del(r)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={!!r.builtin} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="角色权限"
        desc="自定义角色并分配操作权限，再到「用户管理」为管理员指派角色"
        extra={can("role:manage") ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增角色</Button> : undefined}
      />

      <Table<RoleVO> rowKey="id" columns={columns} dataSource={roles} loading={loading} pagination={false} locale={{ emptyText: "暂无角色" }} />

      <Modal title={editing ? "编辑角色" : "新增角色"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={save} confirmLoading={saving} okText="保存" cancelText="取消" width={700}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}><div style={{ marginBottom: 6 }}>角色名</div><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：运营" /></div>
            <div style={{ flex: 1 }}><div style={{ marginBottom: 6 }}>编码</div><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="如：operator" disabled={!!editing?.builtin} /></div>
          </div>
          <div><div style={{ marginBottom: 6 }}>备注</div><Input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="可选" /></div>
          <div>
            <div style={{ marginBottom: 6 }}>权限{isSuper && <span style={{ color: "#faad14", marginLeft: 8 }}>(超级管理员拥有全部权限，不可更改)</span>}</div>
            <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid var(--ant-color-border-secondary, #f0f0f0)", borderRadius: 8, padding: 12 }}>
              {catalog.map((g) => {
                const codes = g.items.map((i) => i.code);
                const allChecked = codes.every((c) => form.permissions.includes(c));
                const some = codes.some((c) => form.permissions.includes(c));
                return (
                  <div key={g.group} style={{ marginBottom: 12 }}>
                    <Checkbox indeterminate={some && !allChecked} checked={allChecked} disabled={isSuper} onChange={(e) => toggleGroup(codes, e.target.checked)} style={{ fontWeight: 600 }}>{g.group}</Checkbox>
                    <div style={{ paddingLeft: 24, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {g.items.map((it) => (
                        <Checkbox key={it.code} disabled={isSuper} checked={form.permissions.includes(it.code)} onChange={(e) => toggleOne(it.code, e.target.checked)} style={{ width: 156, marginInlineStart: 0 }}>{it.label}</Checkbox>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
