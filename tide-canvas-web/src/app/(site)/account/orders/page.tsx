"use client";

/* ============================================================================
   订单记录 · /account/orders — 个人中心「订单记录」的完整列表页。个人中心卡片
   只展示最新 5 条，「更多」跳到这里分页查看全部。复用 account.css 的 .acc-page
   语言与共享的 OrdersPanel（full 模式：加载更多分页 + 返回入口）。
   Auth gate 与个人中心一致：ensureSession() 未登录跳 /login。
   ========================================================================== */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/use-auth-store";
import { OrdersPanel } from "../ledger-panels";
import "../account.css";

export default function AccountOrdersPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await ensureSession();
      if (alive && ok) setChecking(false);
      // if !ok, ensureSession already navigated to /login — leave the placeholder up
    })();
    return () => {
      alive = false;
    };
  }, [ensureSession]);

  return (
    <div className="acc-page">
      <header className="page-hero" style={{ minHeight: 240 }}>
        <div className="ph-scrim" />
        <div className="wrap">
          <div className="page-head">
            <span className="eyebrow reveal in">
              <span className="d" />
              个人中心 · 订单记录
            </span>
          </div>
        </div>
      </header>
      <section className="block" style={{ paddingTop: 0 }}>
        <div className="acc-wrap">
          {checking ? (
            <div className="panel reveal in">
              <div className="empty-note">正在载入…</div>
            </div>
          ) : (
            <OrdersPanel full />
          )}
        </div>
      </section>
    </div>
  );
}
