"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { authApi } from "@/lib/api";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition duration-200 hover:border-white/20 focus:border-white/30 focus:bg-white/[0.06]";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("重置链接无效或已过期");
      return;
    }
    if (password.length < 6 || password.length > 32) {
      setError("新密码长度需要在 6 到 32 位之间");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setLoading(true);
    try {
      const result = await authApi.confirmPasswordReset({ token, newPassword: password });
      if (!result.success) {
        setError(result.message || "重置失败，请重新申请链接");
        return;
      }
      setDone(true);
    } catch {
      setError("重置失败，请重新申请链接");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="fixed inset-0 flex bg-black px-6 text-white">
      <section className="m-auto w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/80 p-7 shadow-2xl">
        <div className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white">
          <KeyRound className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold">设置新密码</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          新密码会立即替换旧密码。完成后请使用新密码重新登录。
        </p>

        {done ? (
          <div className="mt-6 space-y-4 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-sm leading-6 text-green-300">
            <div className="flex items-center gap-2 font-medium text-green-200">
              <CheckCircle2 className="h-4 w-4" />
              密码已重置
            </div>
            <Link
              href="/login"
              className="inline-flex rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200"
            >
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {!token ? <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">重置链接无效或已过期</div> : null}
            {error ? <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div> : null}

            <div>
              <label htmlFor="new-password" className="text-xs text-neutral-400">
                新密码
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={6}
                  maxLength={32}
                  autoComplete="new-password"
                  placeholder="6-32 位新密码"
                  className={inputClass + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 transition-colors hover:text-white"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="text-xs text-neutral-400">
                确认新密码
              </label>
              <input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={6}
                maxLength={32}
                autoComplete="new-password"
                placeholder="再次输入新密码"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              确认重置
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
