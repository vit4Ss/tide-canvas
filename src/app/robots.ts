import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: ["/", "/models", "/explore", "/developers", "/docs", "/pricing", "/about", "/help"], disallow: ["/api/", "/account", "/library", "/history", "/usage", "/billing", "/playground"] }, sitemap: `${BRAND.siteUrl}/sitemap.xml` }; }
