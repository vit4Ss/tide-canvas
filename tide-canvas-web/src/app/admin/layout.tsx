import { AdminGuard } from "@/components/layout/admin-guard";
import { AdminAntdProvider } from "@/components/admin/antd-provider";
import { AdminShell } from "@/components/admin/admin-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGuard>
      <AdminAntdProvider>
        <AdminShell>{children}</AdminShell>
      </AdminAntdProvider>
    </AdminGuard>
  );
}
