"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { Layers } from "lucide-react";
import { PasswordLoginForm } from "@/components/auth/password-login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { OAuthCallbackHandler } from "@/components/auth/oauth-callback-handler";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [toast, setToast] = useState("");

  const oauthCode = searchParams.get("code");
  const registered = searchParams.get("registered");

  if (oauthCode) {
    return <OAuthCallbackHandler code={oauthCode} />;
  }

  const handleOAuthUnconfigured = (provider: string) => {
    setToast(`${provider} 登录尚未配置，请联系管理员`);
    setTimeout(() => setToast(""), 4000);
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
          <h1 className="mt-6 text-2xl font-bold">登录到 TideCanvas</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            还没有账号？
            <Link href="/register" className="ml-1 font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-700 dark:text-white dark:hover:text-neutral-300">
              立即注册
            </Link>
          </p>
        </div>

        {toast && (
          <div className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            {toast}
          </div>
        )}
        {registered && (
          <div className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-center text-sm text-green-600 dark:bg-green-950/30 dark:text-green-400">
            注册成功，请登录
          </div>
        )}

        <div className="mt-8">
          <PasswordLoginForm onSuccess={() => router.push("/")} />
        </div>

        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-200 dark:border-neutral-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-4 text-neutral-400 dark:bg-neutral-950">或通过第三方登录</span>
          </div>
        </div>

        <OAuthButtons onUnconfigured={handleOAuthUnconfigured} />
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
