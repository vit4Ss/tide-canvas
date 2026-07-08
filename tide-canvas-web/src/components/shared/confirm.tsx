"use client";

/* ============================================================================
   confirmDialog — 原生 window.confirm 的产品化替代（Promise<boolean>）。

   用法（调用方须为 async）：
     if (!(await confirmDialog({ title: "删除对话", message: "此操作不可撤销。" }))) return;

   与 toast 同一套监听器模式：ConfirmHost 挂在根布局，模块级函数触发。
   主题：默认深色（imini 令牌）；检测到 .admin-body（苹果浅色后台）时切换
   浅色变体——弹窗渲染在 body 层，拿不到 .admin-body 的令牌域，只能显式分支。
   Esc = 取消，Enter = 确认，点遮罩 = 取消。
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import "./confirm.css";

export interface ConfirmOptions {
  /** 弹窗标题（默认「确认操作」）。 */
  title?: string;
  message: string;
  /** 确认按钮文字（默认「确定」）。 */
  confirmText?: string;
  cancelText?: string;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let hostListener: ((p: Pending) => void) | null = null;

/** 弹出确认框，resolve(true)=确认。Host 未挂载时回退原生 confirm（不吞操作）。 */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
  return new Promise((resolve) => {
    if (!hostListener) {
      resolve(typeof window !== "undefined" ? window.confirm(o.message) : false);
      return;
    }
    hostListener({ ...o, resolve });
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [light, setLight] = useState(false);

  useEffect(() => {
    hostListener = (p) => {
      // 苹果浅色后台（.admin-body 令牌域）→ 浅色变体
      setLight(!!document.querySelector(".admin-body"));
      setPending(p);
    };
    return () => {
      hostListener = null;
    };
  }, []);

  const done = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, done]);

  if (!pending) return null;
  return (
    <div className={`cfm-mask${light ? " light" : ""}`} onClick={() => done(false)}>
      <div
        className="cfm"
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title ?? "确认操作"}
        onClick={(e) => e.stopPropagation()}
      >
        <b className="cfm-t">{pending.title ?? "确认操作"}</b>
        <p className="cfm-m">{pending.message}</p>
        <div className="cfm-acts">
          <button type="button" className="cfm-btn ghost" onClick={() => done(false)}>
            {pending.cancelText ?? "取消"}
          </button>
          <button type="button" className="cfm-btn pri" autoFocus onClick={() => done(true)}>
            {pending.confirmText ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
