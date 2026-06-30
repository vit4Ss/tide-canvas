"use client";

import { useCallback, useEffect, useState } from "react";
import { teamApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import type { TeamVO } from "@/types/team";
import {
  Users, UserPlus, Crown, Copy, Check, LogOut, Trash2, Loader2, Zap, X,
} from "lucide-react";

export default function TeamPage() {
  const [team, setTeam] = useState<TeamVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const fetchUser = useAuthStore((s) => s.fetchUser);

  const load = useCallback(async () => {
    const res = await teamApi.me();
    setTeam(res.success ? res.data : null);
    setLoading(false);
  }, []);

  // 挂载即拉取（内联，避免在 effect 内同步调用含 setState 的回调触发 lint）
  useEffect(() => {
    let active = true;
    teamApi.me().then((res) => {
      if (!active) return;
      setTeam(res.success ? res.data : null);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  // 团队状态变化后刷新本页 + 全局 user（inTeam/teamPriceFactor 影响价格显示与共享）
  const refreshAll = useCallback(async () => {
    await load();
    await fetchUser();
  }, [load, fetchUser]);

  const handleCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await teamApi.create({ name: name.trim() });
      if (res.success) { toast.success("团队已创建"); setName(""); await refreshAll(); }
      else toast.error(res.message || "创建失败");
    } finally { setBusy(false); }
  };

  const handleJoin = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const res = await teamApi.join({ inviteCode: code.trim() });
      if (res.success) { toast.success("已加入团队"); setCode(""); await refreshAll(); }
      else toast.error(res.message || "加入失败");
    } finally { setBusy(false); }
  };

  const handleLeave = async () => {
    if (busy || !confirm("确定退出该团队吗？退出后将无法再访问团队共享的素材与项目。")) return;
    setBusy(true);
    try {
      const res = await teamApi.leave();
      if (res.success) { toast.success("已退出团队"); await refreshAll(); }
      else toast.error(res.message || "退出失败");
    } finally { setBusy(false); }
  };

  const handleDisband = async () => {
    if (busy || !confirm("确定解散团队吗？所有成员将被移出，资源恢复为各自私有。此操作不可撤销。")) return;
    setBusy(true);
    try {
      const res = await teamApi.disband();
      if (res.success) { toast.success("团队已解散"); await refreshAll(); }
      else toast.error(res.message || "解散失败");
    } finally { setBusy(false); }
  };

  const handleRemove = async (userId: number, who: string) => {
    if (busy || !confirm(`确定将「${who}」移出团队吗？`)) return;
    setBusy(true);
    try {
      const res = await teamApi.removeMember(userId);
      if (res.success) { toast.success("已移除成员"); await refreshAll(); }
      else toast.error(res.message || "移除失败");
    } finally { setBusy(false); }
  };

  const copyCode = () => {
    if (!team) return;
    navigator.clipboard?.writeText(team.inviteCode).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => toast.error("复制失败"),
    );
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">我的团队</h1>
          <p className="text-sm text-neutral-500">创建或加入团队，与成员共享素材、项目与生成历史</p>
        </div>
      </div>

      {!team ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 创建团队 */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mb-3 flex items-center gap-2 font-semibold"><Users className="h-4 w-4" /> 创建团队</div>
            <p className="mb-4 text-sm text-neutral-500">你将成为团队管理员，可邀请成员、移除成员、解散团队。</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              placeholder="输入团队名称"
              maxLength={64}
              className="mb-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              onClick={handleCreate}
              disabled={!name.trim() || busy}
              className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {busy ? "处理中..." : "创建团队"}
            </button>
          </div>

          {/* 加入团队 */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mb-3 flex items-center gap-2 font-semibold"><UserPlus className="h-4 w-4" /> 加入团队</div>
            <p className="mb-4 text-sm text-neutral-500">向团队管理员索取邀请码，输入即可加入。</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") handleJoin(); }}
              placeholder="输入邀请码"
              className="mb-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              onClick={handleJoin}
              disabled={!code.trim() || busy}
              className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {busy ? "处理中..." : "加入团队"}
            </button>
          </div>

          <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
            <Zap className="mr-1 inline h-3.5 w-3.5" />
            团队模式下，AI 生成消耗会按平台设定的系数加价；团队成员之间的素材、画布项目、生成历史互相共享。
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 团队概览 */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold">{team.name}</h2>
                  {team.iAmOwner && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      <Crown className="h-3 w-3" /> 管理员
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-neutral-500">{team.memberCount} 名成员</p>
              </div>
              {team.iAmOwner ? (
                <button onClick={handleDisband} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:hover:bg-red-950/30">
                  <Trash2 className="h-4 w-4" /> 解散团队
                </button>
              ) : (
                <button onClick={handleLeave} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900">
                  <LogOut className="h-4 w-4" /> 退出团队
                </button>
              )}
            </div>

            <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
              <Zap className="h-4 w-4" />
              团队价：AI 生成消耗 ×{team.priceFactor}
            </div>
          </div>

          {/* 邀请码 */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
            <p className="mb-2 text-sm font-medium text-neutral-500">邀请码</p>
            <div className="flex items-center gap-3">
              <code className="flex-1 rounded-lg bg-neutral-100 px-4 py-3 text-lg font-bold tracking-[0.3em] dark:bg-neutral-800">{team.inviteCode}</code>
              <button onClick={copyCode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2.5 text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-400">把邀请码发给同事，对方在「加入团队」处输入即可加入。</p>
          </div>

          {/* 成员列表 */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-950">
            {team.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  {m.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Users className="h-4 w-4 text-neutral-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.nickname || m.username}</p>
                  <p className="truncate text-xs text-neutral-400">@{m.username}</p>
                </div>
                {m.isOwner ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    <Crown className="h-3 w-3" /> 管理员
                  </span>
                ) : (
                  team.iAmOwner && (
                    <button onClick={() => handleRemove(m.userId, m.nickname || m.username)} disabled={busy}
                      title="移除成员"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30">
                      <X className="h-4 w-4" />
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
