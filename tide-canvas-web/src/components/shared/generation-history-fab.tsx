"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import "./generation-history-fab.css";

const WORKSPACE_PATHS = ["/canvas", "/studio", "/assets", "/projects", "/inspire", "/three-d", "/chat", "/tools"];

export function GenerationHistoryFab() {
  const pathname = usePathname() || "/";
  const { user, initialized } = useAuth();

  if (!initialized || !user || pathname.startsWith("/admin") || pathname === "/generation-history") {
    return null;
  }

  const inWorkspace = WORKSPACE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  return (
    <Link
      href="/generation-history"
      className={`generation-history-fab${inWorkspace ? " is-workspace" : ""}`}
      aria-label="查看我的生成记录"
      title="我的生成记录"
    >
      <History aria-hidden size={17} strokeWidth={1.8} />
      <span>生成记录</span>
    </Link>
  );
}
