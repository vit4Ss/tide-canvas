import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminGuard } from "@/components/layout/admin-guard";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGuard>
      <div className="flex h-screen overflow-hidden">
        <AdminSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-950">
            <h1 className="text-lg font-semibold">管理后台</h1>
          </header>
          <main className="flex-1 overflow-y-auto bg-neutral-50 p-6 dark:bg-neutral-900">
            {children}
          </main>
        </div>
      </div>
    </AdminGuard>
  );
}
