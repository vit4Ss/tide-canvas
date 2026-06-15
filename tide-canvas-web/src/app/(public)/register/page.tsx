"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { X, Mail, Loader2 } from "lucide-react";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [tab, setTab] = useState<"phone" | "email">("email");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSendCode = async () => {
    if (!EMAIL_RE.test(email)) { setError("请输入有效的邮箱地址"); return; }
    if (cooldown > 0 || sending) return;
    setError("");
    setSending(true);
    try {
      const res = await authApi.emailCode({ email });
      if (res.success) {
        toast.success("验证码已发送，请查收邮箱");
        setCooldown(60);
      } else {
        toast.error(res.message || "验证码发送失败");
      }
    } catch {
      toast.error("验证码发送失败，请稍后重试");
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (username.trim().length < 3) { setError("用户名至少 3 位"); return; }
    if (password.length < 8) { setError("密码至少 8 位"); return; }
    setSubmitting(true);
    try {
      const res = await authApi.register({ username: username.trim(), email, code, password, nickname: nickname.trim() || undefined });
      if (!res.success) {
        setError(res.message || "注册失败");
        return;
      }
      // 完成注册并进入：自动登录
      await login({ account: email, password, rememberMe: true });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const tabBtn = (active: boolean) =>
    `flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${active ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white"}`;
  const inputCls =
    "mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition duration-200 hover:border-white/20 focus:bg-white/[0.06]";

  return (
    <div className="fixed inset-0 z-[100] flex bg-black text-white">
      <button
        onClick={() => router.push("/")}
        title="关闭"
        className="absolute right-6 top-6 z-10 rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X className="h-5 w-5" />
      </button>

      {/* 左：品牌区 */}
      <div className="hidden flex-1 flex-col justify-center px-10 xl:px-24 lg:flex">
        <h1 className="text-5xl font-bold leading-[1.1] xl:text-6xl">
          TideCanvas
          <br />
          <span className="text-4xl xl:text-5xl">无限画布创作空间</span>
        </h1>
        <p className="mt-8 max-w-md text-sm leading-relaxed text-neutral-400">
          新一代由 AI 驱动的多模态创作工作流。从单次生成到连续推演，让创意在无限画布上自由生长。
        </p>
      </div>

      {/* 右：注册卡 */}
      <div className="flex w-full items-center justify-center px-6 lg:w-[560px] lg:justify-end lg:pr-24">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/80 p-7 shadow-2xl">
          <div className="flex gap-1 rounded-xl bg-white/5 p-1">
            <button onClick={() => setTab("phone")} className={tabBtn(tab === "phone")}>手机登录</button>
            <button onClick={() => setTab("email")} className={tabBtn(tab === "email")}>邮箱账户</button>
          </div>

          {tab === "phone" ? (
            <div className="py-12 text-center text-sm text-neutral-500">
              手机验证码登录即将开放，<br />请先使用邮箱注册
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6">
              <div className="mb-5 flex items-center gap-2 text-base font-semibold">
                <Mail className="h-4 w-4" /> 新邮箱注册
              </div>

              {error && (
                <div className="mb-4 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-400">{error}</div>
              )}

              <label className="text-xs text-neutral-400">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="3-64 位，全站唯一"
                className={inputCls}
              />

              <label className="mt-4 block text-xs text-neutral-400">邮箱</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                placeholder="您的企业或个人邮箱"
                className={inputCls}
              />

              <label className="mt-4 block text-xs text-neutral-400">验证码</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  placeholder="邮件验证码"
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm tracking-widest text-white placeholder-neutral-500 outline-none transition duration-200 hover:border-white/20 focus:bg-white/[0.06]"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sending || cooldown > 0}
                  className="flex w-28 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-neutral-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : cooldown > 0 ? `${cooldown}s` : "获取验证码"}
                </button>
              </div>

              <label className="mt-4 block text-xs text-neutral-400">创建密码</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                placeholder="至少 8 位密码"
                className={inputCls}
              />

              <label className="mt-4 block text-xs text-neutral-400">配置昵称（可选）</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="您的称呼"
                className={inputCls}
              />

              <div className="mt-3 text-right text-xs text-neutral-400">
                <Link href="/login" className="transition-colors hover:text-white">← 已有账号? 返回登录</Link>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                完成注册并进入
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
