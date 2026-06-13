"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import type { UserVO } from "@/types/user";
import type { PageData } from "@/types/api";
import { User, Ban, Save, Coins, Loader2, X } from "lucide-react";
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
  // 调整积分弹窗：自动带入目标用户，免手输 ID
  const [adjustTarget, setAdjustTarget] = useState<UserVO | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustRemark, setAdjustRemark] = useState("");
  const [adjusting, setAdjusting] = useState(false);
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

  const openAdjust = (user: UserVO) => {
    setAdjustTarget(user);
    setAdjustAmount("");
    setAdjustRemark("");
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
      // 走积分调整接口（生成积分流水，可在积分管理中审计），而非直接改 points 字段
      const res = await adminApi.points.adjust({
        userId: adjustTarget.id,
        amount,
        remark: adjustRemark || undefined,
      });
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
                          <div className="flex items-center gap-1">
                            <button onClick={() => openAdjust(user)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30">
                              <Coins className="h-3.5 w-3.5" /> 调积分
                            </button>
                            <button onClick={() => startEdit(user)}
                              className="rounded-lg px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
                              编辑
                            </button>
                          </div>
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

      {/* 调整积分弹窗 */}
      {adjustTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !adjusting && setAdjustTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Coins className="h-5 w-5 text-amber-500" /> 调整积分
              </h3>
              <button onClick={() => setAdjustTarget(null)} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-3 text-sm text-neutral-500">
              用户：<span className="font-medium text-neutral-800 dark:text-neutral-200">{adjustTarget.nickname || adjustTarget.username}</span>
              <span className="text-neutral-400"> @{adjustTarget.username}</span>
              　当前积分 <span className="font-medium text-amber-600">{adjustTarget.points ?? 0}</span>
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">金额（+/-）</label>
                <input
                  type="number"
                  autoFocus
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdjust(); }}
                  placeholder="正数增加，负数扣减"
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">备注</label>
                <input
                  value={adjustRemark}
                  onChange={(e) => setAdjustRemark(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdjust(); }}
                  placeholder="调整原因（可选）"
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setAdjustTarget(null)}
                className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                onClick={handleAdjust}
                disabled={adjusting || !adjustAmount}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {adjusting && <Loader2 className="h-4 w-4 animate-spin" />}
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
