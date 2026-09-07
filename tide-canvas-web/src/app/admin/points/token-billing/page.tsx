"use client";

/* ============================================================================
   /admin/points/token-billing — AI 聊天的 Token 调用账单。

   与「积分管理」的按次流水分开：LobeHub 网关按每百万 Token 单价结算，一次调用
   的输入/输出/缓存用量、计价快照和待核对状态都在这里查。表格与核对表单由
   TokenBillingPanel 提供；用户侧只在统一「积分明细」中查看结算结果。

   页标题由 AdminTopbar 按路由给出（归到「积分管理」），本页不再重复一级标题。
   ============================================================================ */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import TokenBillingPanel from "@/components/shared/token-billing-panel";

export default function TokenBillingAdminPage() {
  return (
    <div className="adm-page">
      <div>
        <Link className="adm-btn ghost" href="/admin/points">
          <ArrowLeft aria-hidden size={14} />
          返回积分管理
        </Link>
      </div>
      <TokenBillingPanel admin />
    </div>
  );
}
