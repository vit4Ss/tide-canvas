"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { History } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { GenerationHistoryDialog } from "./generation-history-dialog";
import "./generation-history-fab.css";

const WORKSPACE_PATHS = ["/studio", "/assets", "/projects", "/inspire", "/three-d", "/chat", "/tools"];

export function GenerationHistoryFab() {
  const pathname = usePathname() || "/";
  const { user, initialized } = useAuth();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;

  if (
    !initialized
    || !user
    || pathname.startsWith("/admin")
    || pathname.startsWith("/canvas")
    || pathname === "/generation-history"
  ) {
    return null;
  }

  const inWorkspace = WORKSPACE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  return (
    <>
      <button
        type="button"
        className={`generation-history-fab${inWorkspace ? " is-workspace" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="打开我的生成记录"
        title="我的生成记录"
        onClick={() => setOpenPath(pathname)}
      >
        <History aria-hidden size={17} strokeWidth={1.8} />
        <span>生成记录</span>
      </button>
      <GenerationHistoryDialog open={open} onClose={() => setOpenPath(null)} />
    </>
  );
}
