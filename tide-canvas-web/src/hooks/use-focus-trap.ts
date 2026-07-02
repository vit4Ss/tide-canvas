import { useEffect, useRef } from "react";

/**
 * 焦点陷阱：用于 portal/fixed 的模态弹窗(role="dialog" aria-modal)。当 active 为真时：
 *  - 把焦点移入容器(优先容器内第一个可聚焦元素，如已 autoFocus 的输入；否则聚焦容器本身)；
 *  - 拦截 Tab / Shift+Tab，使焦点在容器内循环，不会跑到弹窗背后的控件；
 *  - 关闭/卸载时把焦点归还给打开前的元素(触发按钮)。
 * 返回一个挂到对话框容器元素上的 ref（容器需可聚焦，建议设 tabIndex={-1}）。
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const prevFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    // 初始焦点：容器内第一个可聚焦元素；没有则聚焦容器本身。
    const first0 = focusables()[0];
    if (first0) first0.focus();
    else container.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prevFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
