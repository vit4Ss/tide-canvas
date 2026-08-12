"use client";

/* ============================================================================
   AdminGuard — gates the /admin console.
   放行两类人:超管(role === 9,全模块)与「后台权限运营角色」(me.adminPerms
   非空,按模块细分;实际接口门禁在服务端 middleware.AdminAccess/AdminPerm)。
   - No token        → ensureSession() redirects to /login.
   - 无任何后台权限   → show "需要管理员权限" briefly, then bounce to /.
   - 有权限但当前路径的模块不在授权内 → 跳到其第一个可见模块(避免整页 403 报错)。
   This prevents normal users from landing on the admin shell and seeing
   "admin privileges required" load failures from the (correctly) 403'd APIs.
   ========================================================================== */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/use-auth-store";
import { hasAdminAccess } from "@/lib/admin-access";
import { ADMIN_NAV_ITEMS, canAccessAdminItem, findActive } from "./admin-sidebar";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/admin";
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");

  const ensureSession = useAuthStore((s) => s.ensureSession);
  // 订阅 user:角色权限在会话内被改动(重新拉 me)时守卫结果跟着变
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await ensureSession(); // redirects to /login when no token
      if (!mounted) return;
      const u = useAuthStore.getState().user;
      if (!ok || !u) {
        // ensureSession only self-redirects on the "no token at all" path; a
        // token that got 401'd and cleared (logout + back button, expiry)
        // resolves false with no navigation — without this redirect the guard
        // would sit on the spinner forever.
        const back = encodeURIComponent("/admin");
        window.location.href = `/login?redirect=${back}`;
        return;
      }
      const allowed = hasAdminAccess(u);
      setState(allowed ? "ok" : "denied");
    })();
    return () => {
      mounted = false;
    };
  }, [ensureSession]);

  useEffect(() => {
    if (state !== "denied") return;
    const t = setTimeout(() => router.replace("/"), 1600);
    return () => clearTimeout(t);
  }, [state, router]);

  // 模块级检查:运营角色访问未授权模块的路径时,改道到其第一个可见模块。
  // findActive 对未知路径回落到数据概览,与侧栏高亮同口径。
  const active = findActive(pathname);
  const moduleAllowed = state !== "ok" || canAccessAdminItem(user, active.perm);
  useEffect(() => {
    if (state !== "ok" || moduleAllowed) return;
    const first = ADMIN_NAV_ITEMS.find((it) => canAccessAdminItem(user, it.perm));
    router.replace(first ? first.href : "/");
  }, [state, moduleAllowed, user, router]);

  if (state === "ok" && moduleAllowed) return <>{children}</>;

  return (
    <div className="adm-guard" role="status" aria-live="polite">
      {state === "denied" ? (
        <div className="adm-guard-message">
          <strong>需要管理员权限</strong>
          <span>
            当前账号无权访问后台，正在返回首页…
          </span>
        </div>
      ) : (
        <div className="adm-guard-spinner" aria-label="正在验证管理员权限" />
      )}
    </div>
  );
}
