"use client";

/* ============================================================================
   AdminDrawer — 右侧滑入详情抽屉(liuguang admin 语言,与 AdminModal 同套
   mask/过渡词汇)。用于「列表 → 详情」的只读检查场景(生成记录详情等),
   比居中弹窗更适合长内容滚动:媒体预览 + 参数网格 + 完整报文一屏看完。

   行为与 AdminModal 对齐:遮罩点击 / ✕ / Escape 关闭;`.show` 下一帧加上
   以跑进入过渡;open=false 不渲染。
   ============================================================================ */

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

export interface AdminDrawerProps {
  open: boolean;
  title: React.ReactNode;
  /** 标题右侧的附加内容(如状态 pill)。 */
  extra?: React.ReactNode;
  children: React.ReactNode;
  /** 抽屉宽度(default 560px)。 */
  width?: number;
  onClose: () => void;
}

export function AdminDrawer({ open, title, extra, children, width = 560, onClose }: AdminDrawerProps) {
  const [show, setShow] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setShow(true));
    return () => {
      cancelAnimationFrame(id);
      setShow(false);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`adm-mask adm-mask-drawer${show ? " show" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="adm-drawer"
        style={{ width: `min(${width}px, 100vw)` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="adm-mhead">
          <div>
            <h2 id={titleId}>{title}</h2>
          </div>
          {extra}
          <button type="button" className="x" aria-label="关闭" onClick={onClose}>
            <X aria-hidden size={16} />
          </button>
        </div>
        <div className="adm-drawer-body">{children}</div>
      </div>
    </div>
  );
}

export default AdminDrawer;
