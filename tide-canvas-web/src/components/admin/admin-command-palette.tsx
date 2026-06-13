"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input, theme } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { ALL_PAGES } from "./admin-menu";

/** 全局页面搜索（Ctrl/Cmd+K）：输入关键字，回车或点击跳转到对应后台页 */
export function AdminCommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { token } = theme.useToken();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) { setQ(""); setActive(0); }
  }, [open]);

  const results = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return ALL_PAGES.filter((p) =>
      !kw || p.label.toLowerCase().includes(kw) || p.group.toLowerCase().includes(kw));
  }, [q]);

  const go = (key: string) => { onClose(); router.push(key); };

  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={520}
      styles={{ body: { padding: 0 } }} destroyOnHidden>
      <div style={{ padding: 12, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Input
          autoFocus size="large" variant="borderless" prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="搜索后台页面…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && results[active]) go(results[active].key);
          }}
        />
      </div>
      <div style={{ maxHeight: 360, overflow: "auto", padding: 8 }}>
        {results.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: token.colorTextTertiary }}>无匹配页面</div>
        ) : results.map((r, i) => (
          <div key={r.key}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(r.key)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", borderRadius: 8, cursor: "pointer",
              background: i === active ? token.colorPrimaryBg : "transparent",
              color: i === active ? token.colorPrimary : token.colorText,
            }}>
            <span style={{ fontWeight: 500 }}>{r.label}</span>
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{r.group}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
