"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "@/stores/use-auth-store";

interface Props {
  onSuccess: () => void;
}

export function PasswordLoginForm({ onSuccess }: Props) {
  const { login, loading } = useAuthStore();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login({ account, password, rememberMe });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
    }
  };

  const inputClass = "w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white dark:focus:ring-white";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="account" className="block text-sm font-medium">账号</label>
        <input
          id="account" type="text" required value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="用户名 / 邮箱 / 手机号"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">密码</label>
        <div className="relative mt-1.5">
          <input
            id="password" type={showPassword ? "text" : "password"} required value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入密码"
            className={`pr-10 ${inputClass}`}
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 accent-neutral-900" />
          记住我
        </label>
        <Link href="/forgot-password" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
          忘记密码？
        </Link>
      </div>
      <button type="submit" disabled={loading}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
        {loading ? "登录中..." : "登录"}
      </button>
    </form>
  );
}
