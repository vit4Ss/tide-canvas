"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { http, setTokens } from "@/lib/http";
import { useAuthStore } from "@/stores/use-auth-store";
import type { LoginVO } from "@/types/user";

const OAUTH_REDIRECT_BASE = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE || "";

const PROVIDER_NAMES: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  wechat: "微信",
};

interface Props {
  code: string;
  state: string;
}

function loginRedirectUri(): string {
  const base = OAUTH_REDIRECT_BASE || window.location.origin;
  return `${base.replace(/\/$/, "")}/login`;
}

function clearOAuthSession() {
  sessionStorage.removeItem("oauth_provider");
  sessionStorage.removeItem("oauth_state");
}

export function OAuthCallbackHandler({ code, state }: Props) {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const p = sessionStorage.getItem("oauth_provider") || "";
    const expectedState = sessionStorage.getItem("oauth_state") || "";
    setProvider(p);

    if (!p || !state || !expectedState || expectedState !== state) {
      clearOAuthSession();
      setError("OAuth state无效或已过期，请重新登录");
      return;
    }

    clearOAuthSession();
    http.post<LoginVO>(`/api/auth/oauth/${p}`, { code, state, redirectUri: loginRedirectUri() })
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
  }, [code, state, router, setUser]);

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