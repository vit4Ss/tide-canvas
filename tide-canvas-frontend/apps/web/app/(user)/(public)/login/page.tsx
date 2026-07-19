"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { OAuthCallbackHandler } from "@/components/auth/oauth-callback-handler";
import { useAuthStore } from "@/stores/use-auth-store";

const copy = {
  close: "关闭",
  title: "TideCanvas",
  subtitle: "无限画布创作空间",
  intro:
    "新一代由 AI 驱动的多模态创作工作流。从单次生成到连续推演，让创意在无限画布上自由生长。",
  phoneLogin: "手机登录",
  emailLogin: "邮箱账户",
  phoneSoon:
    "手机验证码登录即将开放，请先使用邮箱账户登录。",
  formTitle: "邮箱密码登录",
  registered: "注册成功，请登录",
  accountLabel: "邮箱 / 用户名",
  accountPlaceholder: "请输入邮箱或用户名",
  passwordLabel: "密码",
  passwordPlaceholder: "请输入登录密码",
  forgot: "忘记密码？重置密码 ->",
  register: "暂无账号？快速注册 ->",
  submit: "进入空间",
  fallbackError: "登录失败，请重试",
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loading } = useAuthStore();
  const [tab, setTab] = useState<"phone" | "email">("email");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const oauthCode = searchParams.get("code");
  const oauthState = searchParams.get("state") || "";
  const registered = searchParams.get("registered");

  if (oauthCode) {
    return <OAuthCallbackHandler code={oauthCode} state={oauthState} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login({ account: account.trim(), password, rememberMe: true });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.fallbackError);
    }
  };

  const tabBtn = (active: boolean) =>
    "flex-1 rounded-lg py-2 text-sm font-medium transition-colors " +
    (active ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white");
  const inputCls =
    "mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition duration-200 hover:border-white/20 focus:bg-white/[0.06]";

  return (
    <div className="fixed inset-0 z-[100] flex bg-black text-white">
      <button
        onClick={() => router.push("/")}
        title={copy.close}
        className="absolute right-6 top-6 z-10 rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="hidden flex-1 flex-col justify-center px-10 xl:px-24 lg:flex">
        <h1 className="text-5xl font-bold leading-[1.1] xl:text-6xl">
          {copy.title}
          <br />
          <span className="text-4xl xl:text-5xl">{copy.subtitle}</span>
        </h1>
        <p className="mt-8 max-w-md text-sm leading-relaxed text-neutral-400">{copy.intro}</p>
      </div>

      <div className="flex w-full items-center justify-center px-6 lg:w-[560px] lg:justify-end lg:pr-24">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/80 p-7 shadow-2xl">
          <div className="flex gap-1 rounded-xl bg-white/5 p-1">
            <button type="button" onClick={() => setTab("phone")} className={tabBtn(tab === "phone")}>
              {copy.phoneLogin}
            </button>
            <button type="button" onClick={() => setTab("email")} className={tabBtn(tab === "email")}>
              {copy.emailLogin}
            </button>
          </div>

          {tab === "phone" ? (
            <div className="py-12 text-center text-sm leading-6 text-neutral-500">{copy.phoneSoon}</div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6">
              <div className="mb-5 flex items-center gap-2 text-base font-semibold">
                <Mail className="h-4 w-4" />
                {copy.formTitle}
              </div>

              {registered && (
                <div className="mb-4 rounded-lg bg-green-500/15 px-3 py-2 text-xs text-green-400">
                  {copy.registered}
                </div>
              )}
              {error && <div className="mb-4 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-400">{error}</div>}

              <label className="text-xs text-neutral-400">{copy.accountLabel}</label>
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                required
                autoComplete="username"
                placeholder={copy.accountPlaceholder}
                className={inputCls}
              />

              <label className="mt-4 block text-xs text-neutral-400">{copy.passwordLabel}</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                autoComplete="current-password"
                placeholder={copy.passwordPlaceholder}
                className={inputCls}
              />

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
                <Link href="/forgot-password" className="transition-colors hover:text-white">
                  {copy.forgot}
                </Link>
                <Link href="/register" className="transition-colors hover:text-white">
                  {copy.register}
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {copy.submit}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
