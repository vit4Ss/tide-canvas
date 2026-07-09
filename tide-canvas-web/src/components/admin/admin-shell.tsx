"use client";

/* ============================================================================
   AdminShell — client chrome for sidebar open state (mobile drawer).
   ============================================================================ */

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // close drawer on route change
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const close = useCallback(() => setNavOpen(false), []);
  const toggle = useCallback(() => setNavOpen((v) => !v), []);

  return (
    <div className={`adm${navOpen ? " nav-open" : ""}`}>
      <div className="adm-backdrop" onClick={close} aria-hidden={!navOpen} />
      <AdminSidebar onNavigate={close} />
      <main className="adm-main">
        <AdminTopbar onMenuClick={toggle} />
        <div className="adm-content">{children}</div>
      </main>
    </div>
  );
}

export default AdminShell;
