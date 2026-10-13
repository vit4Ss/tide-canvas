import { readFileSync } from "node:fs";

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.WAFFO_ENV || "test";
  if (mode !== "test" && mode !== "prod") throw new Error("WAFFO_ENV must be test or prod");
  const merchantId = env.WAFFO_MERCHANT_ID?.trim() || "";
  const storeId = env.WAFFO_STORE_ID?.trim() || "";
  const productId = env.WAFFO_PRODUCT_ID?.trim() || "";
  const token = env.PAYMENTS_INTERNAL_TOKEN?.trim() || "";
  if (token.length < 32) throw new Error("PAYMENTS_INTERNAL_TOKEN must contain at least 32 characters");
  const privateKey = env.WAFFO_PRIVATE_KEY_FILE
    ? readFileSync(env.WAFFO_PRIVATE_KEY_FILE, "utf8") : env.WAFFO_PRIVATE_KEY || "";
  const ready = Boolean(privateKey && merchantId && storeId && productId);
  if (ready && (!/^MER_[a-zA-Z0-9]+$/.test(merchantId) || !/^STO_[a-zA-Z0-9]+$/.test(storeId) || !/^PROD_[a-zA-Z0-9]+$/.test(productId))) throw new Error("Invalid Waffo identifiers");
  const site = new URL(env.WAFFO_SITE_URL || "http://localhost:3100");
  if (site.username || site.password || site.search || site.hash || site.pathname !== "/" ||
      (site.protocol !== "https:" && !(mode === "test" && site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname)))) throw new Error("Invalid WAFFO_SITE_URL");
  const host = env.PAYMENTS_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new Error("Payments adapter must listen on loopback");
  const port = Number(env.PAYMENTS_PORT || "8083");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PAYMENTS_PORT");
  return { mode: mode as "test" | "prod", merchantId, storeId, productId, token, privateKey, ready, site: site.origin, host, port };
}
export type Config = ReturnType<typeof readConfig>;
