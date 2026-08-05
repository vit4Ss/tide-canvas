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

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, Plus, RefreshCw, Search, UserPlus } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FilterChips,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatusPill,
  type Column,
  TableSkeleton,
} from "@/components/admin";
import { ADMIN_MODULES } from "@/components/admin/admin-sidebar";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminUsersApi } from "@/lib/admin-users-api";
import { confirmDialog } from "@/components/shared/confirm";
import { defaultAvatar, isPlaceholderEmail } from "@/lib/default-avatar";
import type {
  AdminUserUpdateDTO,
  AdminUserVO,
  GeneratedUserVO,
  RoleVO,
} from "@/types/admin-users";

/** Status-pill tone keys (mirror the liuguang `.tag2.<tone>` classes). */
type PillTone = "green" | "gray" | "amber" | "red" | "blue";

/* role / status maps (User.Role 0 user / 1 vip / 9 admin; Status 0/1). */
const ROLE_LABEL: Record<number, string> = { 0: "普通用户", 1: "VIP", 9: "管理员" };
const ROLE_TONE: Record<number, PillTone> = { 0: "gray", 1: "blue", 9: "amber" };
function roleLabel(r: number) {
  return ROLE_LABEL[r] ?? `角色 ${r}`;
}

/* the filter-chip row: 全部 / 普通 / 订阅用户 / 管理员 / 已封禁.
   普通用户 = 免费档（role=0 且 vipLevel=0，即 FREE 用户）；
   订阅用户 = 付费买套餐的（vipLevel >= 1，购买结算时提升）——两者互斥。
   旧「VIP」标签筛 role=1，但支付链路从不写 role，永远筛不出人，已废弃。 */
type FilterKey = "all" | "user" | "subscribed" | "admin" | "banned";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "user", label: "普通用户" },
  { key: "subscribed", label: "订阅用户" },
  { key: "admin", label: "管理员" },
  { key: "banned", label: "已封禁" },
];

/** Map a filter chip to the backend role/status/subscribed query params. */
function filterToQuery(f: FilterKey): { role?: number; status?: number; subscribed?: string } {
  switch (f) {
    case "user":
      // 普通用户 = 非管理员且未订阅（FREE 档）
      return { role: 0, subscribed: "0" };
    case "subscribed":
      return { subscribed: "1" };
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
  remark: string;
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

/** 前台侧栏菜单键，与后端 model.FrontMenuKeys / studio-rail.tsx 一一对应。
    角色的 permissions 存 JSON 数组：勾选的菜单键 + 可选的 admin.access。 */
const MENU_OPTIONS: { key: string; label: string }[] = [
  { key: "discover", label: "发现" },
  { key: "studio", label: "创作" },
  { key: "chat", label: "生成" },
  { key: "canvas", label: "画布" },
  { key: "explore", label: "作品广场" },
  { key: "inspire", label: "灵感" },
  { key: "assets", label: "资产" },
];
const PERM_ADMIN = "admin.access";

/** permissions JSON 字符串 → 键数组（解析失败按空处理，未知键保留）。 */
function parsePerms(raw: string): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function togglePerm(raw: string, key: string): string {
  const list = parsePerms(raw);
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  return JSON.stringify(next);
}

const EMPTY_ROLE_FORM: RoleForm = {
  name: "",
  code: "",
  description: "",
  // 新角色默认勾满前台菜单（再按需取消），与「配置了才展示」的语义一致
  permissions: JSON.stringify(MENU_OPTIONS.map((m) => m.key)),
  status: 1,
};

function AdminUsersPageInner() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  // 角色 CRUD 与账号角色变更为超管专属(服务端 requireSuper 同口径),
  // 运营视角直接收掉入口,避免点了必 403 的假按钮
  const isSuper = useAuthStore((s) => s.user?.role === 9);
  const searchParams = useSearchParams();
  const urlKeyword = searchParams.get("keyword") ?? "";

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

  // 快速生成用户:结果弹窗内密码明文仅此一次展示,关闭即不可再查
  const [genLoading, setGenLoading] = useState(false);
  const [genUser, setGenUser] = useState<GeneratedUserVO | null>(null);
  const [genCopied, setGenCopied] = useState<"" | "username" | "password" | "both">("");

  // role modal (create or edit)
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleVO | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE_FORM);
  const [savingRole, setSavingRole] = useState(false);

  // 顶栏全局搜索跳转 /admin/users?keyword=xxx 时应用该关键词；依赖 urlKeyword 使其
  // 在已停留本页时再次搜索(router.push 改变 query)也能实时生效。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(urlKeyword);
      setKeyword(urlKeyword);
      setPageNum(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [urlKeyword]);

  // reqId 守卫:切筛选会触发「旧 pageNum」+「setPageNum(1)」两次请求,只让最新一次生效,
  // 避免先发的旧页请求后到、把错误页码的数据渲染上去。
  const reqIdRef = useRef(0);
  const loadUsers = useCallback(async () => {
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const { role, status, subscribed } = filterToQuery(filter);
      const res = await adminUsersApi.list({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        role,
        status,
        subscribed,
      });
      if (id !== reqIdRef.current) return; // 过期响应丢弃
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载用户失败");
        setRows([]);
        setTotal(0);
      }
    } catch {
      if (id !== reqIdRef.current) return;
      setError("加载用户失败，请稍后重试");
      setRows([]);
      setTotal(0);
    } finally {
      if (id === reqIdRef.current) setLoading(false);
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
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadRoles(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRoles]);

  // reset to page 1 when filter/keyword changes
  useEffect(() => {
    const timer = window.setTimeout(() => setPageNum(1), 0);
    return () => window.clearTimeout(timer);
  }, [filter, keyword]);

  /* ---- user actions -------------------------------------------------------- */

  function openEdit(u: AdminUserVO) {
    setError(null);
    setEditUser(u);
    setEditForm({
      nickname: u.nickname,
      remark: u.remark || "",
      role: u.role,
      status: u.status,
      vipLevel: u.vipLevel,
      apiQuota: u.apiQuota,
      points: u.points,
    });
  }

  async function saveEdit() {
    if (!editUser || !editForm) return false;
    setSavingUser(true);
    try {
      const dto: AdminUserUpdateDTO = {
        nickname: editForm.nickname,
        remark: editForm.remark.trim(),
        // 角色字段仅超管可变更(服务端 requireSuper 同口径),运营不发该字段
        ...(isSuper ? { role: editForm.role } : {}),
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
        return false;
      }
    } catch {
      setError("保存失败，请稍后重试");
      return false;
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

  async function deleteUser(u: AdminUserVO) {
    if (
      !(await confirmDialog({
        title: "删除用户",
        message: `确定删除用户「${u.nickname || u.username || u.email}」？删除后该账号将无法登录并从列表消失，其邮箱可重新注册；作品与订单流水保留用于审计。此操作不可恢复。`,
        confirmText: "删除",
      }))
    )
      return;
    const res = await adminUsersApi.delete(u.id);
    if (res.success) {
      // 删除的是本页最后一行且不在第 1 页时退回上一页，避免落在空页。
      if (rows.length === 1 && pageNum > 1) setPageNum(pageNum - 1);
      else await loadUsers();
    } else {
      setError(res.message || "删除用户失败");
    }
  }

  // 快速生成用户:服务端随机凭据 + 与自助用户名注册同口径创建,结果弹窗展示明文密码
  async function generateUser() {
    if (genLoading) return;
    setGenLoading(true);
    setError(null);
    try {
      const res = await adminUsersApi.generateUser();
      if (res.success && res.data) {
        setGenCopied("");
        setGenUser(res.data);
        await loadUsers();
      } else {
        setError(res.message || "生成用户失败");
      }
    } catch {
      setError("生成用户失败，请稍后重试");
    } finally {
      setGenLoading(false);
    }
  }

  // 关闭结果弹窗:密码仅此一次展示,后台没有改密功能——一次都没复制就要关,
  // 先二次确认(丢了只能删号重新生成)。onSave 路径返回 false 可保持弹窗打开。
  async function closeGenModal(): Promise<boolean> {
    if (genUser && genCopied === "") {
      const ok = await confirmDialog({
        title: "尚未复制凭据",
        message: "密码关闭后将无法再次查看；若丢失只能删除该账号重新生成。确定已经保存好了吗？",
        confirmText: "已保存，关闭",
      });
      if (!ok) return false;
    }
    setGenUser(null);
    return true;
  }

  // 复制生成的凭据;哪个复制成功就在按钮上回显「已复制」
  async function copyGenCred(kind: "username" | "password" | "both") {
    if (!genUser) return;
    const text =
      kind === "username" ? genUser.username
      : kind === "password" ? genUser.password
      : `用户名：${genUser.username}\n密码：${genUser.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setGenCopied(kind);
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  }

  function openPoints(u: AdminUserVO) {
    setError(null);
    setPointsUser(u);
    setPointsAmount("");
    setPointsRemark("");
  }

  async function savePoints() {
    if (!pointsUser) return false;
    const amount = Number(pointsAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setError("请输入非零的积分变动值");
      return false;
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
        return false;
      }
    } catch {
      setError("积分调整失败，请稍后重试");
      return false;
    } finally {
      setSavingPoints(false);
    }
  }

  /* ---- role actions -------------------------------------------------------- */

  function openCreateRole() {
    setError(null);
    setEditingRole(null);
    setRoleForm(EMPTY_ROLE_FORM);
    setRoleModalOpen(true);
  }

  function openEditRole(r: RoleVO) {
    setError(null);
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
      return false;
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
        return false;
      }
    } catch {
      setError("保存角色失败，请稍后重试");
      return false;
    } finally {
      setSavingRole(false);
    }
  }

  async function deleteRole(r: RoleVO) {
    if (
      !(await confirmDialog({
        title: "删除角色",
        message: `确定删除角色「${r.name}」？拥有该角色的用户将失去对应权限。`,
        confirmText: "删除",
      }))
    )
      return;
    const res = await adminUsersApi.deleteRole(r.id);
    if (res.success) await loadRoles();
    else setError(res.message || "删除角色失败");
  }

  /* ---- columns ------------------------------------------------------------- */

  // 列宽百分比均摊整行（table-layout:fixed 下不给宽度会均分，
  // 用户列装不下「头像+名称+邮箱」）
  const userColumns: Column<AdminUserVO>[] = [
    {
      header: "用户",
      width: "22%",
      cell: (u) => {
        // 身份格层级：运营认人靠备注，备注提升为主显示；占位邮箱（noemail.internal）
        // 不是信息不展示；昵称==用户名（本地账号默认同值）时第二行不再重复。
        const name = u.nickname || u.username || `用户 ${u.id}`;
        const realEmail = isPlaceholderEmail(u.email) ? "" : u.email || "";
        const sub = u.remark
          ? [name, realEmail || u.phone || ""].filter(Boolean).join(" · ")
          : realEmail || u.phone || (u.nickname && u.nickname !== u.username ? `账号 ${u.username}` : "");
        return (
          <div className="cellflex">
            <span
              className="av"
              style={{
                background: `center / cover no-repeat url("${u.avatar || defaultAvatar(u.id)}")`,
              }}
            />
            <div>
              <div className="strong">{u.remark || name}</div>
              {sub ? (
                <div className="muted mono" style={{ fontSize: 11.5 }} title={sub}>
                  {sub}
                </div>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      header: "角色",
      width: "7%",
      cell: (u) => <StatusPill tone={ROLE_TONE[u.role] ?? "gray"}>{roleLabel(u.role)}</StatusPill>,
    },
    {
      // 当前套餐：vip_level 对照真实 plan 表派生，新用户 = 免费档（FREE）
      header: "套餐",
      width: "8%",
      cell: (u) => (
        <StatusPill tone={u.vipLevel >= 1 ? "blue" : "gray"}>
          {u.planName || (u.vipLevel >= 1 ? `VIP ${u.vipLevel}` : "免费")}
        </StatusPill>
      ),
    },
    {
      header: "积分余额",
      width: "7%",
      align: "right",
      className: "mono",
      cell: (u) => fmtNum(u.points),
    },
    {
      header: "作品 / 项目",
      width: "10%",
      align: "right",
      className: "mono",
      cell: (u) => (
        <span>
          {fmtNum(u.postCount)} <span className="muted">作品</span>
          <span className="muted"> / </span>
          {fmtNum(u.projectCount)} <span className="muted">项目</span>
        </span>
      ),
    },
    {
      // 最近登录单行呈现，保持整行节奏一致；注册时间收进 hover 提示，需要再看
      header: "最近登录",
      width: "13%",
      className: "muted",
      cell: (u) => <span title={`注册于 ${fmtTime(u.createTime)}`}>{fmtTime(u.lastLoginTime)}</span>,
    },
    {
      header: "状态",
      width: "7%",
      cell: (u) => (
        <StatusPill tone={u.status === 1 ? "green" : "red"}>
          {u.status === 1 ? "正常" : "已封禁"}
        </StatusPill>
      ),
    },
    {
      header: "操作",
      width: "17%",
      align: "right",
      cell: (u) => (
        <RowActions
          actions={[
            { label: "编辑", onClick: () => openEdit(u) },
            { label: "积分", onClick: () => openPoints(u) },
            { label: u.status === 1 ? "封禁" : "解封", danger: u.status === 1, onClick: () => toggleBan(u) },
            { label: "删除", danger: true, onClick: () => deleteUser(u) },
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
      cell: (r) =>
        isSuper ? (
          <RowActions
            actions={[
              { label: "编辑", onClick: () => openEditRole(r) },
              { label: "删除", onClick: () => deleteRole(r) },
            ]}
          />
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            仅超管可改
          </span>
        ),
    },
  ];

  return (
    <div className="adm-page">
      {error ? (
        <AdminAlert
          tone="error"
          title="操作未完成"
          action={
            <button type="button" className="adm-btn ghost" onClick={loadUsers}>
              <RefreshCw aria-hidden size={15} />
              重新加载用户
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      <Panel
        title="用户列表"
        sub={`共 ${fmtNum(total)} 人`}
        tools={
          <>
            <div className="adm-search" role="search">
              <Search aria-hidden size={15} />
              <input
                aria-label="搜索用户"
                placeholder="邮箱 / 昵称 / 手机"
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
            <button type="button" className="adm-btn" disabled={genLoading} onClick={generateUser}>
              <UserPlus aria-hidden size={15} />
              {genLoading ? "生成中…" : "生成用户"}
            </button>
          </>
        }
      >
        <div className="adm-filter-row">
          <FilterChips
            label="用户类型"
            options={FILTERS.map((f) => f.label)}
            value={FILTERS.find((f) => f.key === filter)?.label}
            onChange={(_, i) => setFilter(FILTERS[i].key)}
          />
        </div>

        {loading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <AdminEmptyState
            title="没有符合条件的用户"
            description="尝试更换用户类型，或清除搜索关键词后重新查询。"
            action={filter !== "all" || keyword ? (
              <button
                type="button"
                className="adm-btn ghost"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                  setKeyword("");
                }}
              >
                清除筛选
              </button>
            ) : undefined}
          />
        ) : (
          <AdminTable<AdminUserVO>
            rows={rows}
            rowKey={(u) => u.id}
            columns={userColumns}
            label="用户列表"
            // 9 列 + 4 个行操作:窄容器下宁可面板内横向滚动,也不让「删除」被裁掉
            className="adm-users-table"
            server={{ page: pageNum, pageSize: PAGE_SIZE, total, onPage: setPageNum }}
          />
        )}
      </Panel>

      <Panel
        title="角色管理"
        sub="配置前台菜单可见性与后台模块权限"
        tools={
          isSuper ? (
            <button type="button" className="adm-btn" onClick={openCreateRole}>
              <Plus aria-hidden size={15} />
              新建角色
            </button>
          ) : undefined
        }
      >
        {rolesLoading ? (
          <TableSkeleton />
        ) : roles.length === 0 ? (
          <AdminEmptyState
            title="尚未创建自定义角色"
            description="创建角色后，可为后台运营人员配置清晰的权限边界。"
            action={
              isSuper ? (
                <button type="button" className="adm-btn" onClick={openCreateRole}>
                  <Plus aria-hidden size={15} />
                  新建角色
                </button>
              ) : undefined
            }
          />
        ) : (
          <AdminTable<RoleVO> rows={roles} rowKey={(r) => r.id} columns={roleColumns} label="角色列表" />
        )}
      </Panel>

      {/* 用户编辑 */}
      <AdminModal
        open={editUser != null && editForm != null}
        size="lg"
        title="编辑用户"
        subtitle={editUser ? editUser.email || editUser.username : ""}
        footNote={error ? <span role="alert">{error}</span> : "谨慎修改角色、余额与账号状态"}
        onClose={() => {
          setError(null);
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
              <Field label="备注" span={4} hint="仅后台可见的运营备注,不下发给用户">
                <input
                  value={editForm.remark}
                  maxLength={255}
                  placeholder="如:渠道来源、对接人、风险标记…"
                  onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })}
                />
              </Field>
              <Field label="角色" span={2} hint={isSuper ? undefined : "仅超级管理员可变更"}>
                <select
                  value={editForm.role}
                  disabled={!isSuper}
                  onChange={(e) => setEditForm({ ...editForm, role: Number(e.target.value) })}
                >
                  {/* role=1(VIP) 死档已移除：会员身份走 vipLevel，由购买结算提升 */}
                  <option value={0}>普通用户</option>
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
        size="sm"
        title="积分调整"
        subtitle={pointsUser ? `${pointsUser.nickname || pointsUser.username} · 当前 ${fmtNum(pointsUser.points)}` : ""}
        footNote={error ? <span role="alert">{error}</span> : "提交后将写入积分流水"}
        onClose={() => {
          setError(null);
          setPointsUser(null);
        }}
        saveLabel={savingPoints ? "提交中…" : "提交"}
        onSave={savePoints}
      >
        <FormCard title="变动信息">
          <FormGrid>
            <Field
              label="变动值"
              span={2}
              required
              hint="正数赠送，负数扣减；余额最低为 0"
              error={error === "请输入非零的积分变动值" ? error : undefined}
            >
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

      {/* 快速生成用户结果:密码明文仅此一次展示,关闭即不可再查 */}
      <AdminModal
        open={genUser != null}
        size="sm"
        title="用户已生成"
        subtitle="已按用户名注册口径创建，并关联默认「用户」角色"
        footNote="密码仅此一次展示，关闭后无法再次查看；该账号未绑定邮箱，忘记密码无法自助找回。"
        onClose={() => {
          void closeGenModal();
        }}
        saveLabel="我已保存好"
        onSave={closeGenModal}
      >
        {genUser ? (
          <FormCard title="账号凭据">
            <FormGrid>
              <Field label="用户名" span={4}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    readOnly
                    value={genUser.username}
                    style={{ fontFamily: "var(--mono)", flex: 1 }}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="生成的用户名"
                  />
                  <button type="button" className="adm-btn ghost" onClick={() => copyGenCred("username")}>
                    <Copy aria-hidden size={14} />
                    {genCopied === "username" ? "已复制" : "复制"}
                  </button>
                </div>
              </Field>
              <Field label="密码" span={4}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    readOnly
                    value={genUser.password}
                    style={{ fontFamily: "var(--mono)", flex: 1 }}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="生成的密码"
                  />
                  <button type="button" className="adm-btn ghost" onClick={() => copyGenCred("password")}>
                    <Copy aria-hidden size={14} />
                    {genCopied === "password" ? "已复制" : "复制"}
                  </button>
                </div>
              </Field>
              <Field label="一键转交" span={4} hint="复制「用户名 + 密码」两行文本，可直接发给使用者">
                <button type="button" className="adm-btn" onClick={() => copyGenCred("both")}>
                  <Copy aria-hidden size={14} />
                  {genCopied === "both" ? "已复制账号密码" : "复制账号密码"}
                </button>
              </Field>
            </FormGrid>
          </FormCard>
        ) : null}
      </AdminModal>

      {/* 角色 新建 / 编辑 */}
      <AdminModal
        open={roleModalOpen}
        size="md"
        title={editingRole ? "编辑角色" : "新建角色"}
        subtitle={editingRole ? editingRole.name : "定义一组后台权限"}
        footNote={error ? <span role="alert">{error}</span> : "权限变更将在保存后生效"}
        onClose={() => {
          setError(null);
          setRoleModalOpen(false);
        }}
        saveLabel={savingRole ? "保存中…" : "保存"}
        onSave={saveRole}
      >
        <FormCard title="角色信息">
          <FormGrid>
            <Field
              label="角色名称"
              span={2}
              required
              error={error === "角色名称不能为空" ? error : undefined}
            >
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
            <Field label="前台菜单" span={4} hint="勾选后该角色的用户侧栏才会显示对应菜单（保存即生效）">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", padding: "4px 0" }}>
                {MENU_OPTIONS.map((m) => {
                  const checked = parsePerms(roleForm.permissions).includes(m.key);
                  return (
                    <label
                      key={m.key}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setRoleForm({ ...roleForm, permissions: togglePerm(roleForm.permissions, m.key) })
                        }
                      />
                      {m.label}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Field
              label="后台权限"
              span={4}
              hint="「全部后台」授予所有模块；或不勾它、按模块勾选明细。拥有任一后台权限的账号即可进入后台，仅能看到/调用已授权模块（保存即生效）"
            >
              {(() => {
                const perms = parsePerms(roleForm.permissions);
                const allAdmin = perms.includes(PERM_ADMIN);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={allAdmin}
                        onChange={() =>
                          setRoleForm({ ...roleForm, permissions: togglePerm(roleForm.permissions, PERM_ADMIN) })
                        }
                      />
                      全部后台
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
                      {ADMIN_MODULES.map((m) => {
                        const key = `admin.${m.perm}`;
                        const checked = allAdmin || perms.includes(key);
                        return (
                          <label
                            key={m.perm}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              cursor: allAdmin ? "default" : "pointer",
                              fontSize: 13,
                              opacity: allAdmin ? 0.55 : 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={allAdmin}
                              onChange={() =>
                                setRoleForm({ ...roleForm, permissions: togglePerm(roleForm.permissions, key) })
                              }
                            />
                            {m.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </div>
  );
}

// useSearchParams 需要 Suspense 边界（Next App Router 要求）。
export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="adm-page"><TableSkeleton /></div>}>
      <AdminUsersPageInner />
    </Suspense>
  );
}
