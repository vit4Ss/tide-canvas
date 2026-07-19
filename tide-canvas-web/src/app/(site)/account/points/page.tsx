"use client";

/* ============================================================================
   积分明细 · /account/points — 个人中心「积分明细」的完整流水页。个人中心卡片
   只展示最新 5 条，「更多」跳到这里分页查看全部。复用 account.css 的 .acc-page
   语言与共享的 PointsPanel（full 模式：加载更多分页 + 返回入口，保留每日签到）。
   Auth gate 与个人中心一致：ensureSession() 未登录跳 /login。
   ========================================================================== */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/use-auth-store";
import { PointsPanel } from "../ledger-panels";
import "../account.css";

export default function AccountPointsPage() {
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
              个人中心 · 积分明细
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
            <PointsPanel full />
          )}
        </div>
      </section>
    </div>
  );
}
