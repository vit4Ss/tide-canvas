"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import styles from "./toast.module.css";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let toastIdCounter = 0;
const listeners: Array<(item: ToastItem) => void> = [];
const MAX_VISIBLE_TOASTS = 4;

export function showToast(type: ToastType, message: string) {
  const item: ToastItem = { id: ++toastIdCounter, type, message };
  listeners.forEach((listener) => listener(item));
}

export const toast = {
  success: (msg: string) => showToast("success", msg),
  error: (msg: string) => showToast("error", msg),
  info: (msg: string) => showToast("info", msg),
};

const META = {
  success: { Icon: Check, label: "成功" },
  error: { Icon: TriangleAlert, label: "错误" },
  info: { Icon: Info, label: "提醒" },
};

function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const [closing, setClosing] = useState(false);
  const duration = item.type === "error" ? 8000 : 5000;
  const remainingRef = useRef(duration);
  const startedAtRef = useRef(0);
  const closingRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const { Icon, label } = META[item.type];

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    exitTimerRef.current = window.setTimeout(() => onRemove(item.id), 180);
  }, [item.id, onRemove]);

  useEffect(() => {
    if (paused || closing) return;
    startedAtRef.current = performance.now();
    const timer = window.setTimeout(requestClose, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - startedAtRef.current));
    };
  }, [closing, paused, requestClose]);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  const lifeStyle = { "--toast-life": `${duration}ms` } as CSSProperties;

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
      className={`${styles.card} ${styles[item.type]}${paused ? ` ${styles.paused}` : ""}${closing ? ` ${styles.closing}` : ""}`}
      style={lifeStyle}
      data-toast-type={item.type}
    >
      <span className={styles.icon} aria-hidden>
        <Icon />
      </span>
      <span className={styles.message}>{item.message}</span>
      <button
        type="button"
        aria-label={`关闭${label}提示`}
        title="关闭"
        onClick={requestClose}
        className={styles.close}
      >
        <X aria-hidden />
      </button>
      <span className={styles.life} aria-hidden />
    </div>
  );
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (item: ToastItem) => {
      setItems((prev) => {
        const last = prev.at(-1);
        const next = last?.type === item.type && last.message === item.message
          ? [...prev.slice(0, -1), item]
          : [...prev, item];
        return next.slice(-MAX_VISIBLE_TOASTS);
      });
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
    <div
      className={styles.viewport}
      aria-live="polite"
      aria-label="操作反馈"
    >
      {items.map((item) => {
        return (
          <ToastCard key={item.id} item={item} onRemove={remove} />
        );
      })}
    </div>
  );
}
