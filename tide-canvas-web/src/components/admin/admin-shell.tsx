"use client";

/* ============================================================================
   AdminShell — client chrome for sidebar open state (mobile drawer).
   ============================================================================ */

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import { useFocusTrap } from "@/hooks/use-focus-trap";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const drawerRef = useFocusTrap<HTMLElement>(navOpen);

  // close drawer on route change
  useEffect(() => {
    const id = requestAnimationFrame(() => setNavOpen(false));
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem("flowinglight_admin_sidebar_collapsed") === "1";
    } catch {
      // Storage may be unavailable in strict privacy modes; expanded is the safe default.
    }
    const id = requestAnimationFrame(() => setCollapsed(saved));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  const close = useCallback(() => setNavOpen(false), []);
  const toggle = useCallback(() => setNavOpen((v) => !v), []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem("flowinglight_admin_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // Keep the in-memory preference for this session.
      }
      return next;
    });
  }, []);

  return (
    <div className={`adm${navOpen ? " nav-open" : ""}${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="adm-backdrop"
        onClick={close}
        aria-label="关闭导航"
        tabIndex={navOpen ? 0 : -1}
      />
      <AdminSidebar onNavigate={close} sidebarRef={drawerRef} />
      <main className="adm-main">
        <AdminTopbar
          onMenuClick={toggle}
          navOpen={navOpen}
          collapsed={collapsed}
          onCollapseClick={toggleCollapsed}
        />
        <div className="adm-content" aria-hidden={navOpen ? true : undefined}>{children}</div>
      </main>
    </div>
  );
}

export default AdminShell;
