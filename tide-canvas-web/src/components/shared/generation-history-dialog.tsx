"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { GenerationHistory } from "./generation-history";
import "@/styles/liuguang/admin.css";
import "@/app/generation-history/generation-history.css";

interface GenerationHistoryDialogProps {
  open: boolean;
  onClose: () => void;
}

export function GenerationHistoryDialog({ open, onClose }: GenerationHistoryDialogProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(open && !detailOpen);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !detailOpen) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detailOpen, onClose, open]);

  const handleDetailOpenChange = useCallback((nextOpen: boolean) => {
    setDetailOpen(nextOpen);
  }, []);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`admin-body generation-history-modal ${GeistSans.variable} ${GeistMono.variable}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !detailOpen) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="generation-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="generation-history-dialog-head">
          <div>
            <h2 id={titleId}>我的生成记录</h2>
            <p>仅显示当前账号发起的任务</p>
          </div>
          <button type="button" className="generation-history-dialog-close" aria-label="关闭生成记录" onClick={onClose}>
            <X aria-hidden size={18} />
          </button>
        </header>
        <div className="generation-history-dialog-body">
          <GenerationHistory mode="modal" onDetailOpenChange={handleDetailOpenChange} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
