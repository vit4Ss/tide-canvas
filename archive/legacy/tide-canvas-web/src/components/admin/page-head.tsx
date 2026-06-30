import type { ReactNode } from "react";

/** 管理页统一标题区：左标题+副标题，右侧可放操作按钮 */
export function AdminPageHead({ title, desc, extra }: { title: string; desc?: string; extra?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{title}</h2>
        {desc && <p style={{ marginTop: 4, marginBottom: 0, color: "#8c8c8c", fontSize: 14 }}>{desc}</p>}
      </div>
      {extra}
    </div>
  );
}
