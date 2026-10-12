export interface PublicRuntimeConfig {
  name: string;
  description: string;
  siteUrl: string;
  currency: string;
  supportEmail: string;
  googleClientId: string;
}

type Environment = Record<string, string | undefined>;
function value(env: Environment, key: string, legacy?: string): string {
  // Dynamic lookup keeps legacy local settings out of the compiled JS bundle.
  return (env[key] ?? (legacy ? env[legacy] : "") ?? "").trim();
}
function origin(raw: string, field: string): string {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${field} must be an absolute HTTP(S) origin.`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error(`${field} must be an HTTP(S) origin without credentials, a path, query or fragment.`);
  return parsed.origin;
}

export function resolveRuntimeConfig(env: Environment) {
  const environment = value(env, "APP_ENV") || "test";
  if (environment !== "prod" && environment !== "test") throw new Error("APP_ENV must be prod or test.");
  const currency = value(env, "BILLING_CURRENCY", "NEXT_PUBLIC_BILLING_CURRENCY") || "CNY";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("BILLING_CURRENCY must be a three-letter currency code.");
  const port = value(env, "PORT") || "3100";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("PORT must be between 1 and 65535.");
  const publicConfig: PublicRuntimeConfig = {
    name: value(env, "BRAND_NAME", "NEXT_PUBLIC_BRAND_NAME") || "Framelyn",
    description: "A little imagination. An entirely new world.",
    siteUrl: origin(value(env, "SITE_URL", "NEXT_PUBLIC_SITE_URL") || `http://localhost:${port}`, "SITE_URL"),
    currency,
    supportEmail: value(env, "SUPPORT_EMAIL", "NEXT_PUBLIC_SUPPORT_EMAIL"),
    googleClientId: value(env, "GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
  };
  return { environment, backendUrl: origin(value(env, "BACKEND_URL") || "http://127.0.0.1:8081", "BACKEND_URL"), publicConfig };
}
