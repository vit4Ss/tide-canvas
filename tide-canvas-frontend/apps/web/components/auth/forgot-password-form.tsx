"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import { authApi } from "@/lib/api";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition duration-200 hover:border-white/20 focus:border-white/30 focus:bg-white/[0.06]";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSent(false);
    setLoading(true);
    try {
      const result = await authApi.requestPasswordReset({ email: email.trim() });
      if (!result.success) {
        setError(result.message || "发送失败，请稍后再试");
        return;
      }
      setSent(true);
    } catch {
      setError("发送失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="fixed inset-0 flex bg-black px-6 text-white">
      <Link
        href="/login"
        className="absolute left-6 top-6 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        返回登录
      </Link>

      <section className="m-auto w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/80 p-7 shadow-2xl">
        <div className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white">
          <Mail className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold">重置密码</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          输入注册邮箱。如果账号存在，我们会发送一封包含重置链接的邮件。
        </p>

        {sent ? (
          <div className="mt-6 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-sm leading-6 text-green-300">
            <div className="mb-1 flex items-center gap-2 font-medium text-green-200">
              <CheckCircle2 className="h-4 w-4" />
              邮件已发送
            </div>
            如果该邮箱已注册，重置链接已经发送。请在 30 分钟内完成操作。
          </div>
        ) : null}

        {error ? <div className="mt-6 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div> : null}

        <form onSubmit={handleSubmit} className="mt-6">
          <label htmlFor="reset-email" className="text-xs text-neutral-400">
            邮箱
          </label>
          <input
            id="reset-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            placeholder="name@example.com"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={loading}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            发送重置邮件
          </button>
        </form>
      </section>
    </main>
  );
}
