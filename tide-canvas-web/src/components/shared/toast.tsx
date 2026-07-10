"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let toastIdCounter = 0;
const listeners: Array<(item: ToastItem) => void> = [];

export function showToast(type: ToastType, message: string) {
  const item: ToastItem = { id: ++toastIdCounter, type, message };
  listeners.forEach((listener) => listener(item));
}

export const toast = {
  success: (msg: string) => showToast("success", msg),
  error: (msg: string) => showToast("error", msg),
  info: (msg: string) => showToast("info", msg),
};

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: AlertCircle,
};

const COLORS = {
  success: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/50 dark:text-green-400",
  error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400",
  info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-400",
};

function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const Icon = ICONS[item.type];

  useEffect(() => {
    if (paused) return;
    const duration = item.type === "error" ? 8000 : 5000;
    const timer = window.setTimeout(() => onRemove(item.id), duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.type, onRemove, paused]);

  return (
    <div
      role={item.type === "error" ? "alert" : "status"}
      aria-atomic="true"
      tabIndex={0}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-md ${COLORS[item.type]}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{item.message}</span>
      <button type="button" aria-label="关闭提示" onClick={() => onRemove(item.id)} className="ml-2 opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (item: ToastItem) => {
      setItems((prev) => [...prev, item]);
    };
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // z 必须高于全部弹层（modal-zoom/lightbox/srcmask 均为 1000）：toast 是反馈层，任何时候都要可见
  return (
    <div className="pointer-events-none fixed left-1/2 top-6 z-[1200] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite" aria-label="操作反馈">
      {items.map((item) => {
        return (
          <ToastCard key={item.id} item={item} onRemove={remove} />
        );
      })}
    </div>
  );
}
