/* ============================================================================
   /admin route-group layout — the 流光 FlowingLight 后台管理控制台 shell.

   Nested under the app's root layout (which owns <html>/<body> + global fonts),
   so this renders ONLY the console chrome. Faithful to design-ref/后台管理.html:
     .admin-body (light-theme token scope) > .adm (sidebar 260px | main grid)
       <AdminSidebar/>  — all 15 sections, active via usePathname
       <main class="adm-main">
         <AdminTopbar/> — title / breadcrumb / 搜索 / 通知
         <div class="adm-content">{page}</div>

   - imports the already-copied liuguang admin stylesheet (light Apple theme;
     intentionally distinct from the dark site/studio).
   - The original prototype set these classes on <body>; here .admin-body wraps
     the console and .adm is position:fixed inset:0 so it fills the viewport.
   - This is the admin console's OWN top-level route group (NOT site/studio).
   ============================================================================ */

import "@/styles/liuguang/admin.css";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { AdminGuard } from "@/components/admin/admin-guard";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminGuard>
      <div className="admin-body">
        <div className="adm">
          <AdminSidebar />
          <main className="adm-main">
            <AdminTopbar />
            <div className="adm-content">{children}</div>
          </main>
        </div>
      </div>
    </AdminGuard>
  );
}
