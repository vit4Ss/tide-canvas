"use client";

import { GitHubIcon, GoogleIcon, WeChatIcon } from "./oauth-icons";

const GITHUB_CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const WECHAT_APP_ID = process.env.NEXT_PUBLIC_WECHAT_APP_ID || "";
const OAUTH_REDIRECT_BASE = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_BASE || "http://localhost:3000";

interface Props {
  onUnconfigured: (provider: string) => void;
}

export function OAuthButtons({ onUnconfigured }: Props) {
  const startOAuth = (
    provider: string,
    authUrl: string,
    clientId: string,
    scope: string,
    extraParams?: Record<string, string>,
  ) => {
    if (!clientId) {
      onUnconfigured(provider);
      return;
    }
    const state = crypto.randomUUID();
    sessionStorage.setItem("oauth_provider", provider);
    sessionStorage.setItem("oauth_state", state);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${OAUTH_REDIRECT_BASE}/login`,
      scope,
      state,
      response_type: "code",
      ...extraParams,
    });
    window.location.href = `${authUrl}?${params}`;
  };

  const handleGitHub = () =>
    startOAuth("github", "https://github.com/login/oauth/authorize", GITHUB_CLIENT_ID, "user:email");

  const handleGoogle = () =>
    startOAuth("google", "https://accounts.google.com/o/oauth2/v2/auth", GOOGLE_CLIENT_ID, "openid email profile", {
      access_type: "offline",
      prompt: "consent",
    });

  const handleWeChat = () => {
    if (!WECHAT_APP_ID) return onUnconfigured("微信");
    const state = crypto.randomUUID();
    sessionStorage.setItem("oauth_provider", "wechat");
    sessionStorage.setItem("oauth_state", state);
    const params = new URLSearchParams({
      appid: WECHAT_APP_ID,
      redirect_uri: `${OAUTH_REDIRECT_BASE}/login`,
      response_type: "code",
      scope: "snsapi_login",
      state,
    });
    window.location.href = `https://open.weixin.qq.com/connect/qrconnect?${params}#wechat_redirect`;
  };

  const btnClass = "flex items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800";

  return (
    <div className="grid grid-cols-3 gap-3">
      <button onClick={handleGitHub} className={btnClass}>
        <GitHubIcon />GitHub
      </button>
      <button onClick={handleGoogle} className={btnClass}>
        <GoogleIcon />Google
      </button>
      <button onClick={handleWeChat} className={btnClass}>
        <WeChatIcon />微信
      </button>
    </div>
  );
}
