"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { http } from "@/lib/http";
import { GitHubIcon, GoogleIcon, WeChatIcon } from "./oauth-icons";

const OAUTH_REDIRECT_BASE = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE || "";

const PROVIDER_NAMES: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  wechat: "微信",
};

interface AuthorizeVO {
  authorizeUrl: string;
  state: string;
}

interface Props {
  onUnconfigured: (provider: string) => void;
}

function loginRedirectUri(): string {
  const base = OAUTH_REDIRECT_BASE || window.location.origin;
  return `${base.replace(/\/$/, "")}/login`;
}

export function OAuthButtons({ onUnconfigured }: Props) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const startOAuth = async (provider: "github" | "google" | "wechat") => {
    if (loadingProvider) return;
    setLoadingProvider(provider);
    try {
      const res = await http.get<AuthorizeVO>(`/api/auth/oauth/${provider}/authorize`, {
        redirectUri: loginRedirectUri(),
      });
      if (!res.success || !res.data?.authorizeUrl || !res.data?.state) {
        onUnconfigured(PROVIDER_NAMES[provider]);
        return;
      }
      sessionStorage.setItem("oauth_provider", provider);
      sessionStorage.setItem("oauth_state", res.data.state);
      window.location.href = res.data.authorizeUrl;
    } catch {
      onUnconfigured(PROVIDER_NAMES[provider]);
    } finally {
      setLoadingProvider(null);
    }
  };

  const btnClass = "flex items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800";

  const iconOrSpinner = (provider: string, icon: ReactNode) =>
    loadingProvider === provider ? <Loader2 className="h-4 w-4 animate-spin" /> : icon;

  return (
    <div className="grid grid-cols-3 gap-3">
      <button type="button" onClick={() => startOAuth("github")} disabled={!!loadingProvider} className={btnClass}>
        {iconOrSpinner("github", <GitHubIcon />)}GitHub
      </button>
      <button type="button" onClick={() => startOAuth("google")} disabled={!!loadingProvider} className={btnClass}>
        {iconOrSpinner("google", <GoogleIcon />)}Google
      </button>
      <button type="button" onClick={() => startOAuth("wechat")} disabled={!!loadingProvider} className={btnClass}>
        {iconOrSpinner("wechat", <WeChatIcon />)}微信
      </button>
    </div>
  );
}