"use client";

/* ============================================================================
   AdminGuard — gates the /admin console to admins (role === 9).
   - No token        → ensureSession() redirects to /login.
   - Token, non-admin → show "需要管理员权限" briefly, then bounce to /.
   - Token, admin    → render the console.
   This prevents normal users from landing on the admin shell and seeing
   "admin privileges required" load failures from the (correctly) 403'd APIs.
   ========================================================================== */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/use-auth-store";

const ADMIN_ROLE = 9;

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");

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
      setState(u.role === ADMIN_ROLE ? "ok" : "denied");
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

  if (state === "ok") return <>{children}</>;

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
