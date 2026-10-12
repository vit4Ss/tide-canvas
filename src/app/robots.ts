import type { MetadataRoute } from "next";
import { getServerConfig } from "@/lib/server-config";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  const { environment, publicConfig } = getServerConfig();
  if (environment === "test") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: ["/", "/models", "/explore", "/developers", "/docs", "/pricing", "/about", "/help"], disallow: ["/api/", "/account", "/library", "/history", "/usage", "/billing", "/playground", "/runtime-config", "/healthz"] }, sitemap: `${publicConfig.siteUrl}/sitemap.xml` };
}
