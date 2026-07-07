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
      if (!ok || !mounted) return;
      const u = useAuthStore.getState().user;
      if (!u) {
        // token was invalid / cleared → go log in
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
    <div
      style={{
        /* 此屏渲染在 .admin-body 之外，用字面量对齐 admin.css 定稿色板 */
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#F6F8FB",
        color: "#111827",
        fontFamily: "var(--ui, system-ui, sans-serif)",
      }}
    >
      {state === "denied" ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>需要管理员权限</div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#64748B" }}>
            当前账号无权访问后台，正在返回首页…
          </div>
        </div>
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "3px solid #E2E8F0",
            borderTopColor: "#2563EB",
            animation: "adminGuardSpin .7s linear infinite",
          }}
        />
      )}
      <style>{`@keyframes adminGuardSpin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
