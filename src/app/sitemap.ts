import type { MetadataRoute } from "next";
import { getServerConfig } from "@/lib/server-config";
export const dynamic = "force-dynamic";
export default function sitemap(): MetadataRoute.Sitemap {
  const { environment, publicConfig } = getServerConfig();
  if (environment === "test") return [];
  return ["", "/models", "/explore", "/developers", "/docs", "/pricing", "/about", "/help", "/privacy", "/terms", "/refunds", "/aup"].map((route) => ({ url: `${publicConfig.siteUrl}${route}`, changeFrequency: route === "/models" ? "daily" : "weekly", priority: route === "" ? 1 : .7 }));
}
