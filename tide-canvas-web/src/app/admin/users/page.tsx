"use client";

/* ============================================================================
   /admin/users — 用户管理, wired to the REAL backend.

   Faithful to the liuguang admin.js V.users() skin, now driven by:
     GET    /api/admin/users (pageNum,pageSize,keyword,role?,status?)
              -> PageData<AdminUserVO>
     PUT    /api/admin/users/:id        (role/status/apiQuota/points/vipLevel/
                                         roleId/nickname) -> AdminUserVO
     POST   /api/admin/users/:id/points {amount,remark}  -> {points}
     GET    /api/admin/roles  POST/PUT/DELETE /api/admin/roles[/:id]

   These edits hit the REAL users / sys_role / point_record tables (linkage), so
   they are immediately visible on the user-facing app.

   Keeps the EXACT liuguang `.adm-*` markup/classes + the shared AdminTable /
   Panel / StatCardGrid / StatusPill / RowActions / AdminModal / Field / FormCard
   / FormGrid components. Loading + empty states included. No @/mock imports.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminModal,
  AdminTable,
  Field,
  FilterChips,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  type Column,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminUsersApi } from "@/lib/admin-users-api";
import type {
  AdminUserUpdateDTO,
  AdminUserVO,
  RoleVO,
} from "@/types/admin-users";

/** Status-pill tone keys (mirror the liuguang `.tag2.<tone>` classes). */
type PillTone = "green" | "gray" | "amber" | "red" | "blue";

/** Deterministic 2-tone avatar gradient from a name (local; no @/mock import). */
function avatarSwatch(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `linear-gradient(135deg,hsl(${h} 78% 60%),hsl(${(h + 50) % 360} 78% 50%))`;
}

/* role / status maps (User.Role 0 user / 1 vip / 9 admin; Status 0/1). */
const ROLE_LABEL: Record<number, string> = { 0: "普通用户", 1: "VIP", 9: "管理员" };
const ROLE_TONE: Record<number, PillTone> = { 0: "gray", 1: "blue", 9: "amber" };
function roleLabel(r: number) {
  return ROLE_LABEL[r] ?? `角色 ${r}`;
}

/* the filter-chip row: 全部 / 普通 / VIP / 管理员 / 已封禁. */
type FilterKey = "all" | "user" | "vip" | "admin" | "banned";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "user", label: "普通用户" },
  { key: "vip", label: "VIP" },
  { key: "admin", label: "管理员" },
  { key: "banned", label: "已封禁" },
];

/** Map a filter chip to the backend role/status query params. */
function filterToQuery(f: FilterKey): { role?: number; status?: number } {
  switch (f) {
    case "user":
      return { role: 0 };
    case "vip":
      return { role: 1 };
    case "admin":
      return { role: 9 };
    case "banned":
      return { status: 0 };
    default:
      return {};
  }
}

const fmtNum = (n: number) => n.toLocaleString("zh-Hans-CN");

/** "YYYY-MM-DDTHH:MM:SS±..." or "" -> "YYYY-MM-DD HH:MM" (or "—"). */
function fmtTime(s: string): string {
  if (!s) return "—";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PAGE_SIZE = 20;

/** Edit-form local state (controlled inputs for the user edit modal). */
interface EditForm {
  nickname: string;
  role: number;
  status: number;
  vipLevel: number;
  apiQuota: number;
  points: number;
}

/** Role-form local state (controlled inputs for the role create/edit modal). */
interface RoleForm {
  name: string;
  code: string;
  description: string;
  permissions: string;
  status: number;
}

const EMPTY_ROLE_FORM: RoleForm = {
  name: "",
  code: "",
  description: "",
  permissions: "",
  status: 1,
};

export default function AdminUsersPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  // list state
  const [rows, setRows] = useState<AdminUserVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // roles state
  const [roles, setRoles] = useState<RoleVO[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  // user edit modal
  const [editUser, setEditUser] = useState<AdminUserVO | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  // points adjust modal
  const [pointsUser, setPointsUser] = useState<AdminUserVO | null>(null);
  const [pointsAmount, setPointsAmount] = useState("");
  const [pointsRemark, setPointsRemark] = useState("");
  const [savingPoints, setSavingPoints] = useState(false);

  // role modal (create or edit)
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleVO | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE_FORM);
  const [savingRole, setSavingRole] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const { role, status } = filterToQuery(filter);
      const res = await adminUsersApi.list({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        role,
        status,
      });
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载用户失败");
        setRows([]);
        setTotal(0);
      }
    } catch {
      setError("加载用户失败，请稍后重试");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [ensureSession, filter, pageNum, keyword]);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      await ensureSession();
      const res = await adminUsersApi.listRoles();
      if (res.success && res.data) setRoles(res.data);
      else setRoles([]);
    } catch {
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);
  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  // reset to page 1 when filter/keyword changes
  useEffect(() => {
    setPageNum(1);
  }, [filter, keyword]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // KPI cards derived from the current page metadata.
  const kpis = useMemo(
    () => [
      { k: "用户总数", v: fmtNum(total), dir: "up" as const },
      { k: "当前页", v: `${pageNum} / ${pageCount}`, dir: "up" as const },
      { k: "本页用户", v: fmtNum(rows.length), dir: "up" as const },
      { k: "角色数", v: fmtNum(roles.length), dir: "up" as const },
    ],
    [total, pageNum, pageCount, rows.length, roles.length],
  );

  /* ---- user actions -------------------------------------------------------- */

  function openEdit(u: AdminUserVO) {
    setEditUser(u);
    setEditForm({
      nickname: u.nickname,
      role: u.role,
      status: u.status,
      vipLevel: u.vipLevel,
      apiQuota: u.apiQuota,
      points: u.points,
    });
  }

  async function saveEdit() {
    if (!editUser || !editForm) return;
    setSavingUser(true);
    try {
      const dto: AdminUserUpdateDTO = {
        nickname: editForm.nickname,
        role: editForm.role,
        status: editForm.status,
        vipLevel: editForm.vipLevel,
        apiQuota: editForm.apiQuota,
        points: editForm.points,
      };
      const res = await adminUsersApi.update(editUser.id, dto);
      if (res.success) {
        setEditUser(null);
        setEditForm(null);
        await loadUsers();
      } else {
        setError(res.message || "保存失败");
      }
    } finally {
      setSavingUser(false);
    }
  }

  async function toggleBan(u: AdminUserVO) {
    const next = u.status === 1 ? 0 : 1;
    const res = await adminUsersApi.update(u.id, { status: next });
    if (res.success) await loadUsers();
    else setError(res.message || "操作失败");
  }

  function openPoints(u: AdminUserVO) {
    setPointsUser(u);
    setPointsAmount("");
    setPointsRemark("");
  }

  async function savePoints() {
    if (!pointsUser) return;
    const amount = Number(pointsAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setError("请输入非零的积分变动值");
      return;
    }
    setSavingPoints(true);
    try {
      const res = await adminUsersApi.adjustPoints(pointsUser.id, {
        amount,
        remark: pointsRemark || undefined,
      });
      if (res.success) {
        setPointsUser(null);
        await loadUsers();
      } else {
        setError(res.message || "积分调整失败");
      }
    } finally {
      setSavingPoints(false);
    }
  }

  /* ---- role actions -------------------------------------------------------- */

  function openCreateRole() {
    setEditingRole(null);
    setRoleForm(EMPTY_ROLE_FORM);
    setRoleModalOpen(true);
  }

  function openEditRole(r: RoleVO) {
    setEditingRole(r);
    setRoleForm({
      name: r.name,
      code: r.code,
      description: r.description,
      permissions: r.permissions,
      status: r.status,
    });
    setRoleModalOpen(true);
  }

  async function saveRole() {
    if (!roleForm.name.trim()) {
      setError("角色名称不能为空");
      return;
    }
    setSavingRole(true);
    try {
      const dto = {
        name: roleForm.name.trim(),
        code: roleForm.code.trim() || undefined,
        description: roleForm.description.trim() || undefined,
        permissions: roleForm.permissions.trim() || undefined,
        status: roleForm.status,
      };
      const res = editingRole
        ? await adminUsersApi.updateRole(editingRole.id, dto)
        : await adminUsersApi.createRole(dto);
      if (res.success) {
        setRoleModalOpen(false);
        await loadRoles();
      } else {
        setError(res.message || "保存角色失败");
      }
    } finally {
      setSavingRole(false);
    }
  }

  async function deleteRole(r: RoleVO) {
    const res = await adminUsersApi.deleteRole(r.id);
    if (res.success) await loadRoles();
    else setError(res.message || "删除角色失败");
  }

  /* ---- columns ------------------------------------------------------------- */

  const userColumns: Column<AdminUserVO>[] = [
    {
      header: "用户",
      cell: (u) => (
        <div className="cellflex">
          <span
            className="av"
            style={{ background: u.avatar ? `center / cover no-repeat url("${u.avatar}")` : avatarSwatch(u.nickname || u.username || u.id) }}
          />
          <div>
            <div className="strong">{u.nickname || u.username || `用户 ${u.id}`}</div>
            <div className="muted mono" style={{ fontSize: 11.5 }}>
              {u.email || u.phone || u.id}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: "角色",
      cell: (u) => <StatusPill tone={ROLE_TONE[u.role] ?? "gray"}>{roleLabel(u.role)}</StatusPill>,
    },
    {
      header: "积分余额",
      align: "right",
      className: "mono",
      cell: (u) => fmtNum(u.points),
    },
    {
      header: "API 额度",
      align: "right",
      className: "mono",
      cell: (u) => fmtNum(u.apiQuota),
    },
    { header: "作品 / 项目", className: "mono", cell: (u) => `${fmtNum(u.postCount)} / ${fmtNum(u.projectCount)}` },
    { header: "最近登录", className: "muted", cell: (u) => fmtTime(u.lastLoginTime) },
    {
      header: "状态",
      cell: (u) => (
        <StatusPill tone={u.status === 1 ? "green" : "red"}>
          {u.status === 1 ? "正常" : "已封禁"}
        </StatusPill>
      ),
    },
    {
      header: "操作",
      align: "right",
      cell: (u) => (
        <RowActions
          actions={[
            { label: "编辑", onClick: () => openEdit(u) },
            { label: "积分", onClick: () => openPoints(u) },
            { label: u.status === 1 ? "封禁" : "解封", danger: u.status === 1, onClick: () => toggleBan(u) },
          ]}
        />
      ),
    },
  ];

  const roleColumns: Column<RoleVO>[] = [
    {
      header: "角色",
      cell: (r) => (
        <span className="strong">
          {r.name}
          {r.code ? (
            <>
              {" "}
              <span className="muted mono" style={{ fontSize: 11.5 }}>
                {r.code}
              </span>
            </>
          ) : null}
        </span>
      ),
    },
    { header: "描述", className: "muted", cell: (r) => r.description || "—" },
    {
      header: "状态",
      cell: (r) => (
        <StatusPill tone={r.status === 1 ? "green" : "gray"}>{r.status === 1 ? "启用" : "停用"}</StatusPill>
      ),
    },
    {
      header: "操作",
      align: "right",
      cell: (r) => (
        <RowActions
          actions={[
            { label: "编辑", onClick: () => openEditRole(r) },
            { label: "删除", onClick: () => deleteRole(r) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <StatCardGrid items={kpis} />

      {error ? (
        <div className="adm-panel" style={{ marginBottom: 16 }}>
          <p style={{ padding: "12px 18px", color: "#ff375f", margin: 0 }}>{error}</p>
        </div>
      ) : null}

      <Panel
        title="用户列表"
        sub="管理账号、角色、积分与封禁状态（直接作用于真实用户表）"
        tools={
          <>
            <div className="adm-search" style={{ margin: 0 }}>
              <span className="muted">⌕</span>
              <input
                placeholder="搜索用户 / 邮箱 / 手机"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setKeyword(query.trim());
                }}
              />
            </div>
            <button type="button" className="adm-btn ghost" onClick={() => setKeyword(query.trim())}>
              搜索
            </button>
          </>
        }
      >
        <div className="adm-tools" style={{ padding: "12px 18px 0" }}>
          <FilterChips
            options={FILTERS.map((f) => f.label)}
            value={FILTERS.find((f) => f.key === filter)?.label}
            onChange={(_, i) => setFilter(FILTERS[i].key)}
          />
        </div>

        {loading ? (
          <p style={{ padding: 24, color: "var(--text-faint)" }}>加载中…</p>
        ) : rows.length === 0 ? (
          <p style={{ padding: 24, color: "var(--text-faint)" }}>没有符合条件的用户</p>
        ) : (
          <>
            <AdminTable<AdminUserVO> rows={rows} rowKey={(u) => u.id} columns={userColumns} />
            <div className="adm-pager">
              <span className="total">共 {total.toLocaleString()} 条</span>
              <div className="pgs">
                <button
                  type="button"
                  className="pg nav"
                  onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                  aria-label="上一页"
                >
                  ‹
                </button>
                <button type="button" className="pg on">
                  {pageNum}
                </button>
                <span className="gap">/ {pageCount}</span>
                <button
                  type="button"
                  className="pg nav"
                  onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))}
                  aria-label="下一页"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="角色管理"
        sub="后台权限角色（sys_role）"
        tools={
          <button type="button" className="adm-btn" onClick={openCreateRole}>
            + 新建角色
          </button>
        }
      >
        {rolesLoading ? (
          <p style={{ padding: 24, color: "var(--text-faint)" }}>加载中…</p>
        ) : roles.length === 0 ? (
          <p style={{ padding: 24, color: "var(--text-faint)" }}>暂无角色，点击「新建角色」创建。</p>
        ) : (
          <AdminTable<RoleVO> rows={roles} rowKey={(r) => r.id} columns={roleColumns} />
        )}
      </Panel>

      {/* 用户编辑 */}
      <AdminModal
        open={editUser != null && editForm != null}
        title="编辑用户"
        subtitle={editUser ? editUser.email || editUser.username : ""}
        onClose={() => {
          setEditUser(null);
          setEditForm(null);
        }}
        saveLabel={savingUser ? "保存中…" : "保存"}
        onSave={saveEdit}
      >
        {editForm ? (
          <FormCard title="账号与会员">
            <FormGrid>
              <Field label="昵称" span={2}>
                <input
                  value={editForm.nickname}
                  onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })}
                />
              </Field>
              <Field label="角色" span={2}>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: Number(e.target.value) })}
                >
                  <option value={0}>普通用户</option>
                  <option value={1}>VIP</option>
                  <option value={9}>管理员</option>
                </select>
              </Field>
              <Field label="VIP 等级" span={2}>
                <input
                  type="number"
                  value={editForm.vipLevel}
                  onChange={(e) => setEditForm({ ...editForm, vipLevel: Number(e.target.value) })}
                />
              </Field>
              <Field label="API 额度" span={2}>
                <input
                  type="number"
                  value={editForm.apiQuota}
                  onChange={(e) => setEditForm({ ...editForm, apiQuota: Number(e.target.value) })}
                />
              </Field>
              <Field label="积分余额" span={2} hint="直接覆盖余额；增减请用「积分」操作以记录流水">
                <input
                  type="number"
                  value={editForm.points}
                  onChange={(e) => setEditForm({ ...editForm, points: Number(e.target.value) })}
                />
              </Field>
              <Field label="账号状态" span={2}>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: Number(e.target.value) })}
                >
                  <option value={1}>正常</option>
                  <option value={0}>已封禁</option>
                </select>
              </Field>
            </FormGrid>
          </FormCard>
        ) : null}
      </AdminModal>

      {/* 积分调整 */}
      <AdminModal
        open={pointsUser != null}
        title="积分调整"
        subtitle={pointsUser ? `${pointsUser.nickname || pointsUser.username} · 当前 ${fmtNum(pointsUser.points)}` : ""}
        onClose={() => setPointsUser(null)}
        saveLabel={savingPoints ? "提交中…" : "提交"}
        onSave={savePoints}
      >
        <FormCard title="变动信息">
          <FormGrid>
            <Field label="变动值" span={2} required hint="正数赠送，负数扣减；余额最低为 0">
              <input
                type="number"
                placeholder="如 100 或 -50"
                value={pointsAmount}
                onChange={(e) => setPointsAmount(e.target.value)}
              />
            </Field>
            <Field label="备注" span={2} placeholder="管理员调整">
              <input value={pointsRemark} onChange={(e) => setPointsRemark(e.target.value)} placeholder="管理员调整" />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>

      {/* 角色 新建 / 编辑 */}
      <AdminModal
        open={roleModalOpen}
        title={editingRole ? "编辑角色" : "新建角色"}
        subtitle={editingRole ? editingRole.name : "定义一组后台权限"}
        onClose={() => setRoleModalOpen(false)}
        saveLabel={savingRole ? "保存中…" : "保存"}
        onSave={saveRole}
      >
        <FormCard title="角色信息">
          <FormGrid>
            <Field label="角色名称" span={2} required>
              <input
                placeholder="如：内容运营"
                value={roleForm.name}
                onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
              />
            </Field>
            <Field label="标识码" span={2}>
              <input
                placeholder="如：content_ops"
                value={roleForm.code}
                onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value })}
              />
            </Field>
            <Field label="状态" span={2}>
              <select
                value={roleForm.status}
                onChange={(e) => setRoleForm({ ...roleForm, status: Number(e.target.value) })}
              >
                <option value={1}>启用</option>
                <option value={0}>停用</option>
              </select>
            </Field>
            <Field label="描述" span={2}>
              <input
                placeholder="角色说明"
                value={roleForm.description}
                onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
              />
            </Field>
            <Field label="权限 (JSON 数组)" span={4} hint='如 ["user:read","user:write"]'>
              <input
                placeholder='["user:read"]'
                value={roleForm.permissions}
                onChange={(e) => setRoleForm({ ...roleForm, permissions: e.target.value })}
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}
