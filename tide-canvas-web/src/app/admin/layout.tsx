import { AdminGuard } from "@/components/layout/admin-guard";
import { AdminAntdProvider } from "@/components/admin/antd-provider";
import { AdminShell } from "@/components/admin/admin-shell";
import { ThemeModeProvider } from "@/components/shared/theme-mode";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGuard>
      <ThemeModeProvider>
        <AdminAntdProvider>
          <AdminShell>{children}</AdminShell>
        </AdminAntdProvider>
      </ThemeModeProvider>
    </AdminGuard>
  );
}
