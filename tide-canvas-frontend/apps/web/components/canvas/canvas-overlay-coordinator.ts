"use client";

import { useCallback, useEffect, useId, useRef } from "react";

const CANVAS_OVERLAY_EVENT = "tide-canvas:exclusive-overlay";

interface CanvasOverlayEventDetail {
  id: string;
}

interface CanvasOverlayBoundaryRef {
  readonly current: HTMLElement | null;
}

function emitCanvasOverlay(id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CanvasOverlayEventDetail>(CANVAS_OVERLAY_EVENT, {
    detail: { id },
  }));
}

/**
 * 画布内的模型、参数、张数等浮层共享互斥协议：打开一个时关闭其余浮层。
 * 浮层仍可各自使用 Portal/Floating UI，避免被 React Flow 的 transform/overflow 裁切。
 */
export function useExclusiveCanvasOverlay(open: boolean, onClose: () => void, scope: string) {
  const reactId = useId();
  const overlayId = `${scope}-${reactId}`;
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handleOverlayOpen = (event: Event) => {
      const detail = (event as CustomEvent<CanvasOverlayEventDetail>).detail;
      if (detail?.id !== overlayId) onCloseRef.current();
    };
    window.addEventListener(CANVAS_OVERLAY_EVENT, handleOverlayOpen);
    return () => window.removeEventListener(CANVAS_OVERLAY_EVENT, handleOverlayOpen);
  }, [open, overlayId]);

  return useCallback(() => emitCanvasOverlay(overlayId), [overlayId]);
}

/**
 * Portal 浮层的统一收起规则。捕获阶段监听可绕过 React Flow/按钮上的 stopPropagation：
 * 点击边界外、焦点移动到边界外、窗口失焦或按 Escape 时都会关闭。
 */
export function useDismissibleCanvasOverlay(
  open: boolean,
  onClose: () => void,
  boundaries: readonly CanvasOverlayBoundaryRef[],
) {
  const onCloseRef = useRef(onClose);
  const boundariesRef = useRef(boundaries);

  useEffect(() => {
    onCloseRef.current = onClose;
    boundariesRef.current = boundaries;
  });

  useEffect(() => {
    if (!open) return;

    const isInside = (target: EventTarget | null) => (
      target instanceof Node
      && boundariesRef.current.some((boundary) => boundary.current?.contains(target))
    );
    const closeIfOutside = (event: Event) => {
      if (!isInside(event.target)) onCloseRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const handleWindowBlur = () => onCloseRef.current();
    let focusOutTimer: number | undefined;
    const handleFocusOut = () => {
      window.clearTimeout(focusOutTimer);
      focusOutTimer = window.setTimeout(() => {
        if (!isInside(document.activeElement)) onCloseRef.current();
      }, 0);
    };

    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("focusin", closeIfOutside, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.clearTimeout(focusOutTimer);
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("focusin", closeIfOutside, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [open]);
}

export function closeCanvasOverlays() {
  emitCanvasOverlay("__close_all__");
}
