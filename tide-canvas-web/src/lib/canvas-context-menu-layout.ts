interface ContextMenuLayoutOptions {
  anchor: { x: number; y: number };
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  previous?: { left: number; top: number };
}

export interface ContextMenuLayout {
  left: number;
  top: number;
  maxHeight: number;
}

const VIEWPORT_MARGIN = 8;
const MIN_USABLE_HEIGHT = 120;

/**
 * Pass previous only while the same menu opening remains active. Its origin
 * stays fixed when a submenu grows; the body scrolls in the remaining space.
 * A shrinking viewport may move it enough to retain a usable scroll region.
 * The menu's CSS must also constrain its width to the viewport minus margins.
 */
export function resolveContextMenuLayout({
  anchor, menu, viewport, previous,
}: ContextMenuLayoutOptions): ContextMenuLayout {
  const availableHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2);
  const reservedHeight = Math.min(
    availableHeight,
    previous ? MIN_USABLE_HEIGHT : Math.max(MIN_USABLE_HEIGHT, menu.height),
  );
  const rightmost = Math.max(VIEWPORT_MARGIN, viewport.width - menu.width - VIEWPORT_MARGIN);
  const lowest = Math.max(VIEWPORT_MARGIN, viewport.height - reservedHeight - VIEWPORT_MARGIN);
  const left = Math.max(VIEWPORT_MARGIN, Math.min(previous?.left ?? anchor.x, rightmost));
  const top = Math.max(VIEWPORT_MARGIN, Math.min(previous?.top ?? anchor.y, lowest));

  return {
    left,
    top,
    maxHeight: Math.max(0, viewport.height - top - VIEWPORT_MARGIN),
  };
}
