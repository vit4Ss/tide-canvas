"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { http, setTokens } from "@/lib/http";
import { useAuthStore } from "@/stores/use-auth-store";
import type { LoginVO } from "@/types/user";

const OAUTH_REDIRECT_BASE = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE || "http://localhost:3000";

const PROVIDER_NAMES: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  wechat: "微信",
};

interface Props {
  code: string;
}

export function OAuthCallbackHandler({ code }: Props) {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const p = sessionStorage.getItem("oauth_provider");
    if (!p) return;
    setProvider(p);
    sessionStorage.removeItem("oauth_provider");
    sessionStorage.removeItem("oauth_state");

    http.post<LoginVO>(`/api/auth/oauth/${p}`, { code, redirectUri: `${OAUTH_REDIRECT_BASE}/login` })
      .then((res) => {
        if (res.success) {
          setTokens(res.data.accessToken, res.data.refreshToken);
          setUser(res.data.userInfo);
          router.push("/");
        } else {
          setError(res.message);
        }
      })
      .catch(() => setError(`${PROVIDER_NAMES[p] || p} 登录失败，请重试`));
  }, [code, router, setUser]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-neutral-400" />
        <p className="mt-4 text-sm text-neutral-500">正在通过 {PROVIDER_NAMES[provider] || provider} 登录...</p>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
