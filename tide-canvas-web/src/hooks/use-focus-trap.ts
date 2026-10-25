import { useEffect, useRef } from "react";

type FocusTrapEntry = {
  container: HTMLElement;
  previous: HTMLElement | null;
  lastFocused: HTMLElement | null;
};
// A confirmation dialog can be mounted above an existing editor. Only the
// innermost active trap handles Tab; otherwise both handlers fight for focus.
const activeTraps: FocusTrapEntry[] = [];

/**
 * 焦点陷阱：用于 portal/fixed 的模态弹窗(role="dialog" aria-modal)。当 active 为真时：
 *  - 把焦点移入容器(优先容器内第一个可聚焦元素，如已 autoFocus 的输入；否则聚焦容器本身)；
 *  - 拦截 Tab / Shift+Tab，使焦点在容器内循环，不会跑到弹窗背后的控件；
 *  - 关闭/卸载时把焦点归还给打开前的元素(触发按钮)。
 * 返回一个挂到对话框容器元素上的 ref（容器需可聚焦，建议设 tabIndex={-1}）。
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const prevFocused = document.activeElement as HTMLElement | null;
    const parentEntry = activeTraps.at(-1);
    const entry: FocusTrapEntry = {
      container,
      // React's autoFocus runs before this effect. A nested confirmation may
      // already own focus, so recover its opener from the active parent.
      previous: container.contains(prevFocused)
        ? parentEntry?.lastFocused || parentEntry?.container || null
        : prevFocused,
      lastFocused: container.contains(prevFocused) ? prevFocused : null,
    };
    const childIndex = activeTraps.findIndex((trap) =>
      container.contains(trap.container),
    );
    if (childIndex < 0) activeTraps.push(entry);
    else {
      // React may mount a child's effect before its parent's effect.
      entry.previous = activeTraps[childIndex].previous;
      activeTraps.splice(childIndex, 0, entry);
    }
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) entry.lastFocused = event.target;
    };
    container.addEventListener("focusin", rememberFocus);

    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    // 初始焦点：优先显式 autofocus / 表单控件；否则取第一个可聚焦元素。
    // 这样表单弹窗不会先落到右上角关闭按钮，危险确认框仍可用 autoFocus 指向取消。
    const preferred = container.querySelector<HTMLElement>(
      "[autofocus],[data-autofocus],input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
    );
    const first0 =
      preferred && preferred.offsetParent !== null
        ? preferred
        : focusables()[0];
    if (activeTraps.at(-1) === entry) {
      if (first0) first0.focus();
      else container.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || activeTraps.at(-1) !== entry) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      // 自绘下拉等浮层会 portal 到 body。它们在 DOM 上不属于 dialog，但在交互上
      // 仍由 dialog 内的触发器拥有；用锚点替代当前浮层焦点参与首尾判断。
      const portal = activeEl?.closest<HTMLElement>("[data-focus-trap-portal]");
      const portalId = portal?.dataset.focusTrapPortal;
      const portalAnchor = portalId
        ? (Array.from(
            container.querySelectorAll<HTMLElement>("[data-focus-trap-anchor]"),
          ).find((element) => element.dataset.focusTrapAnchor === portalId) ??
          null)
        : null;
      const focusOrigin = container.contains(activeEl)
        ? activeEl
        : portalAnchor;
      if (e.shiftKey) {
        if (focusOrigin === first || !focusOrigin) {
          e.preventDefault();
          last.focus();
        }
      } else if (focusOrigin === last || !focusOrigin) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      container.removeEventListener("focusin", rememberFocus);
      const index = activeTraps.indexOf(entry);
      if (index < 0) return;
      const wasTop = index === activeTraps.length - 1;
      activeTraps.splice(index, 1);
      // If an editor and its confirmation close in the same render, preserve
      // the original opener rather than a now-detached editor button.
      for (const trap of activeTraps) {
        if (trap.previous && container.contains(trap.previous)) {
          trap.previous = entry.previous;
        }
      }
      if (!wasTop) return;
      const parent = activeTraps.at(-1)?.container;
      const target = entry.previous;
      if (target?.isConnected && (!parent || parent.contains(target))) {
        target.focus();
      } else if (parent?.isConnected) {
        parent.focus();
      }
    };
  }, [active]);

  return ref;
}
