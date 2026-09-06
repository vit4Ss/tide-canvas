import { http } from "./http";

export interface LobeHubConfig {
  enabled: boolean;
  url?: string;
  gateway?: string;
  maxConcurrent?: number;
  dailyLimit?: number;
  historyMessages?: number;
}

export const lobeHubApi = {
  config: () => http.get<LobeHubConfig>("/api/lobehub/config"),
  launch: (accountId: string) => http.post<{ url: string }>("/api/lobehub/launch", { accountId }),
  approve: (request: string) => http.post<{ url: string }>("/api/lobehub/oidc/approve", { request }),
};

export function allowedLobeRedirect(value: string, origin: string): boolean {
  try {
    const target = new URL(value);
    const expected = new URL(origin);
    return target.origin === expected.origin && !target.username && !target.password
      && ["/flowinglight/connect", "/api/auth/callback/generic-oidc", "/api/auth/oauth2/callback/generic-oidc"].includes(target.pathname);
  } catch { return false; }
}
