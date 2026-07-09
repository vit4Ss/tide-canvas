/* ============================================================================
   /admin layout — dense ops console shell.
   ============================================================================ */

import "@/styles/liuguang/admin.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminGuard } from "@/components/admin/admin-guard";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminGuard>
      {/* Geist 变量只挂在后台域：拉丁字母/数字走 Geist，中文回落 PingFang/Noto（admin.css --ui/--mono） */}
      <div className={`admin-body ${GeistSans.variable} ${GeistMono.variable}`}>
        <AdminShell>{children}</AdminShell>
      </div>
    </AdminGuard>
  );
}
