"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { UserVO } from "@/types/user";
import type { PageData } from "@/types/api";
import { User, Ban, Save } from "lucide-react";
import {
  PageHeader,
  SearchBar,
  Pagination,
  StatusBadge,
  TableSkeleton,
} from "@/components/shared";

const ROLE_VARIANTS: Record<number, { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  0: { label: "普通用户", variant: "neutral" },
  1: { label: "VIP", variant: "warning" },
  9: { label: "管理员", variant: "danger" },
};

const STATUS_VARIANTS: Record<number, { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  0: { label: "禁用", variant: "danger" },
  1: { label: "正常", variant: "success" },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ role: 0, status: 1, points: 0, apiQuota: 0 });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pageSize = 15;

  const loadUsers = async (page = pageNum, search = keyword) => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.users.list({ pageNum: page, pageSize, keyword: search || undefined });
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

  const handleSearch = () => {
    setPageNum(1);
    loadUsers(1, keyword);
  };

  const handlePageChange = (newPage: number) => {
    setPageNum(newPage);
    loadUsers(newPage);
  };

  const startEdit = (user: UserVO) => {
    setEditingId(user.id);
    setEditForm({ role: user.role, status: user.status, points: user.points ?? 0, apiQuota: user.apiQuota });
  };

  const handleSave = async (userId: number) => {
    setSaving(true);
    try {
      const res = await adminApi.users.update(userId, {
        role: editForm.role,
        status: editForm.status,
        apiQuota: editForm.apiQuota,
      });
      if (res.success) {
        setEditingId(null);
        loadUsers();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="用户管理" description={`共 ${total} 个用户`} />

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 搜索栏 */}
      <div className="flex gap-3">
        <SearchBar
          value={keyword}
          onChange={setKeyword}
          onSearch={handleSearch}
          placeholder="搜索用户名、邮箱..."
        />
        <button onClick={handleSearch} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900">
          搜索
        </button>
      </div>

      {/* 用户表格 */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">积分</th>
                <th className="px-4 py-3 font-medium">签约作者</th>
                <th className="px-4 py-3 font-medium">注册时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={5} columns={9} />
              ) : users.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-neutral-400">暂无用户数据</td></tr>
              ) : (
                users.map((user) => {
                  const isEditing = editingId === user.id;
                  const role = ROLE_VARIANTS[user.role] ?? ROLE_VARIANTS[0];
                  const status = STATUS_VARIANTS[user.status] ?? STATUS_VARIANTS[1];
                  return (
                    <tr key={user.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50 dark:border-neutral-900 dark:hover:bg-neutral-900/30">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-400">{String(user.id).slice(-6)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                            {user.avatar ? (
                              <img src={user.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                            ) : (
                              <User className="h-4 w-4 text-neutral-400" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{user.nickname || user.username}</p>
                            <p className="text-xs text-neutral-400">@{user.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{user.email}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: Number(e.target.value) })}
                            className="rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
                            <option value={0}>普通用户</option>
                            <option value={1}>VIP</option>
                            <option value={9}>管理员</option>
                          </select>
                        ) : (
                          <StatusBadge label={role.label} variant={role.variant} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: Number(e.target.value) })}
                            className="rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
                            <option value={1}>正常</option>
                            <option value={0}>禁用</option>
                          </select>
                        ) : (
                          <StatusBadge label={status.label} variant={status.variant} />
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{user.points ?? 0}</td>
                      <td className="px-4 py-3">
                        {user.isAuthor === 1 ? (
                          <StatusBadge label="是" variant="warning" />
                        ) : (
                          <span className="text-xs text-neutral-400">否</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-400">
                        {user.createTime ? new Date(user.createTime).toLocaleDateString("zh-CN") : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button onClick={() => handleSave(user.id)} disabled={saving}
                              className="rounded-lg bg-green-500 p-1.5 text-white hover:bg-green-600 disabled:opacity-50">
                              <Save className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="rounded-lg bg-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-300">
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(user)}
                            className="rounded-lg px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
                            编辑
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination pageNum={pageNum} pageSize={pageSize} total={total} onChange={handlePageChange} />
      </div>
    </div>
  );
}
