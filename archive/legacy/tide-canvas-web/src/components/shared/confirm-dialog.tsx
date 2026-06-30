"use client";

import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmText = "确认", cancelText = "取消",
  danger = false, onConfirm, onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          {danger && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {message && <p className="mt-1 text-sm text-neutral-500">{message}</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
            {cancelText}
          </button>
          <button onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"}`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
