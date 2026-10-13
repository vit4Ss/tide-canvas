let locks = 0;
let restore: (() => void) | undefined;

export function lockModalScroll() {
  if (locks++ === 0) {
    const body = document.body, root = document.documentElement;
    const x = window.scrollX, y = window.scrollY, url = location.pathname + location.search;
    const properties = ["position", "top", "left", "width", "overflow", "paddingRight"] as const;
    const saved = Object.fromEntries(properties.map(key => [key, body.style[key]]));
    const rootOverflow = root.style.overflow, behavior = root.style.scrollBehavior;
    const gap = Math.max(0, innerWidth - root.clientWidth);
    const padding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
    root.style.overflow = "hidden";
    Object.assign(body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%", overflow: "hidden", paddingRight: `${padding + gap}px` });
    restore = () => {
      for (const key of properties) body.style[key] = saved[key];
      root.style.overflow = rootOverflow;
      root.style.scrollBehavior = "auto";
      if (location.pathname + location.search === url) window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
    };
  }
  let released = false;
  return () => { if (!released) { released = true; if (--locks === 0) { restore?.(); restore = undefined; } } };
}
