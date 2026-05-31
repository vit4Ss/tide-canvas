"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuthStore } from "@/stores/use-auth-store";
import { Layers, Eye, EyeOff, Check, X } from "lucide-react";

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "至少 6 个字符", ok: password.length >= 6 },
    { label: "包含数字", ok: /\d/.test(password) },
    { label: "包含字母", ok: /[a-zA-Z]/.test(password) },
  ];
  if (!password) return null;

  return (
    <div className="mt-2 space-y-1">
      {checks.map((check) => (
        <div key={check.label} className="flex items-center gap-1.5 text-xs">
          {check.ok ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <X className="h-3 w-3 text-neutral-400" />
          )}
          <span className={check.ok ? "text-green-600 dark:text-green-400" : "text-neutral-500"}>
            {check.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const { register, loading } = useAuthStore();
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    nickname: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (form.password.length < 6) {
      setError("密码至少 6 个字符");
      return;
    }
    if (!agreed) {
      setError("请同意服务协议");
      return;
    }

    try {
      await register({
        username: form.username,
        email: form.email,
        password: form.password,
        nickname: form.nickname || undefined,
      });
      router.push("/login?registered=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败，请重试");
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 dark:bg-white">
              <Layers className="h-5 w-5 text-white dark:text-neutral-900" />
            </div>
          </Link>
          <h1 className="mt-6 text-2xl font-bold">创建 TideCanvas 账号</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            已有账号？
            <Link href="/login" className="ml-1 font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-700 dark:text-white dark:hover:text-neutral-300">
              立即登录
            </Link>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="username" className="block text-sm font-medium">
                用户名 <span className="text-red-500">*</span>
              </label>
              <input
                id="username"
                type="text"
                required
                value={form.username}
                onChange={(e) => updateField("username", e.target.value)}
                placeholder="用户名"
                className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
              />
            </div>
            <div>
              <label htmlFor="nickname" className="block text-sm font-medium">
                昵称
              </label>
              <input
                id="nickname"
                type="text"
                value={form.nickname}
                onChange={(e) => updateField("nickname", e.target.value)}
                placeholder="显示名称（可选）"
                className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              邮箱 <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="your@email.com"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              密码 <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1.5">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
                placeholder="至少 6 个字符"
                className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 pr-10 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <PasswordStrength password={form.password} />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium">
              确认密码 <span className="text-red-500">*</span>
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={form.confirmPassword}
              onChange={(e) => updateField("confirmPassword", e.target.value)}
              placeholder="再次输入密码"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white"
            />
            {form.confirmPassword && form.password !== form.confirmPassword && (
              <p className="mt-1 text-xs text-red-500">两次输入的密码不一致</p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
            />
            <span className="text-neutral-600 dark:text-neutral-400">
              我已阅读并同意
              <Link href="#" className="font-medium text-neutral-900 underline underline-offset-2 dark:text-white">
                服务协议
              </Link>
              和
              <Link href="#" className="font-medium text-neutral-900 underline underline-offset-2 dark:text-white">
                隐私政策
              </Link>
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !agreed}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {loading ? "注册中..." : "创建账号"}
          </button>
        </form>
      </div>
    </div>
  );
}
