import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";
export default function sitemap(): MetadataRoute.Sitemap { return ["", "/models", "/explore", "/developers", "/docs", "/pricing", "/about", "/help", "/privacy", "/terms"].map((route) => ({ url: `${BRAND.siteUrl}${route}`, changeFrequency: route === "/models" ? "daily" : "weekly", priority: route === "" ? 1 : .7 })); }
