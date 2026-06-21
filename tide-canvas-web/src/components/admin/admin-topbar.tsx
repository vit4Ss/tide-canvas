"use client";

/* ============================================================================
   AdminTopbar — liuguang `.adm-top` header (title / breadcrumb / search / 通知).

   Faithful to 后台管理.html <header class="adm-top">:
     <div><h1 id="admTitle">…</h1><div class="crumb" id="admCrumb">控制台 / …</div></div>
     <label class="adm-search"><span class="muted">⌕</span><input …></label>
     <button class="tbtn">通知 ⌃</button>

   The title + breadcrumb derive from the active route (findActive) instead of
   the prototype's manual updates. Search placeholder matches the spec
   ("搜索用户、作品、订单…"); both search and 通知 surface the app toast (the
   real handlers are wired later).
   ============================================================================ */

import { usePathname } from "next/navigation";
import { toast } from "@/components/shared/toast";
import { findActive } from "./admin-sidebar";

export function AdminTopbar() {
  const pathname = usePathname() || "/admin";
  const active = findActive(pathname);

  return (
    <header className="adm-top">
      <div>
        <h1>{active.label}</h1>
        <div className="crumb">控制台 / {active.label}</div>
      </div>

      <label className="adm-search">
        <span className="muted">⌕</span>
        <input
          type="text"
          placeholder="搜索用户、作品、订单…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const q = (e.target as HTMLInputElement).value.trim();
              toast.info(q ? `搜索「${q}」· 高保真原型` : "搜索 · 高保真原型");
            }
          }}
        />
      </label>

      <button type="button" className="tbtn" onClick={() => toast.info("通知 · 高保真原型")}>
        通知 ⌃
      </button>
    </header>
  );
}

export default AdminTopbar;
