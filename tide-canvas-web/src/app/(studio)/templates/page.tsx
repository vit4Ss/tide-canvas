import type { Metadata } from "next";
import { Suspense } from "react";
import TemplateGallery from "@/components/templates/template-gallery";

export const metadata: Metadata = { title: "灵感和模板 · FlowLight" };
export default function TemplatesPage() { return <Suspense fallback={<p role="status">正在加载模板…</p>}><TemplateGallery /></Suspense>; }
