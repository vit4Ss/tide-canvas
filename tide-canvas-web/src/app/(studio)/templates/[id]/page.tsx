import type { Metadata } from "next";
import TemplateWorkshop from "@/components/templates/template-workshop";
import { templateReturnURL } from "@/lib/template-navigation";

export const metadata: Metadata = { title: "做同款 · 灵感和模板 · FlowLight" };
export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  return <TemplateWorkshop templateId={id} returnTo={templateReturnURL(query.returnTo)} />;
}
