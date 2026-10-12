import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { AuthProvider } from "@/components/auth-provider";
import { BRAND } from "@/lib/brand";
import "./globals.css";
import "./studio.css";
import "./pages.css";
import "./developers.css";

export const metadata: Metadata = { title: { default: `${BRAND.name} — Make room for imagination`, template: `%s · ${BRAND.name}` }, description: "Create images, video, audio and 3D with a collection of AI models. One thoughtful workspace for your next idea.", icons: { icon: "/icon.svg" } };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body className={GeistSans.className}><a className="skip-link" href="#main-content">Skip to content</a><AuthProvider><div id="main-content">{children}</div></AuthProvider></body></html>; }
