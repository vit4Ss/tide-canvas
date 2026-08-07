/** Whether a link targets the public pricing route that is currently hidden. */
export function isHiddenPricingRoute(value?: string | null): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim(), "http://flowinglight.local");
    const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "").toLowerCase();
    return pathname === "/pricing" || pathname.startsWith("/pricing/");
  } catch {
    return false;
  }
}
