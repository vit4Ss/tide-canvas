import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { AuthProvider } from "@/components/auth-provider";
import { getServerConfig } from "@/lib/server-config";
import { RuntimeConfigProvider } from "@/components/runtime-config";
import { SkipLink } from "@/components/skip-link";
import { ConsumerProvider } from "@/components/consumer-info";
import { getPublicConsumer } from "@/lib/public-info.server";
import "./globals.css";
import "./studio.css";
import "./pages.css";
import "./developers.css";
import "./consumer.css";
import "./modals.css";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  const { publicConfig: brand, environment } = getServerConfig();
  return { metadataBase: new URL(brand.siteUrl), title: { default: `${brand.name} — Make room for imagination`, template: `%s · ${brand.name}` }, description: "Create images, video, audio and 3D with a collection of AI models. One thoughtful workspace for your next idea.", icons: { icon: "/icon.svg" }, ...(environment === "test" ? { robots: { index: false, follow: false } } : {}) };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { publicConfig } = getServerConfig();
  const consumer = await getPublicConsumer();
  return <html lang="en"><body className={GeistSans.className}><SkipLink /><RuntimeConfigProvider config={publicConfig}><AuthProvider><ConsumerProvider initialInfo={consumer}><div id="main-content">{children}</div></ConsumerProvider></AuthProvider></RuntimeConfigProvider></body></html>;
}
