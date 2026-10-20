export type TemplateFilters = { media: "" | "image" | "video"; category: string; keyword: string; page: number };
export function templateFilters(query: { get(name: string): string | null }): TemplateFilters {
  const type = query.get("type");
  const page = Number(query.get("page"));
  return { media: type === "image" || type === "video" ? type : "", category: (query.get("category") || "").slice(0, 64), keyword: (query.get("q") || "").slice(0, 128), page: Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : 1 };
}
export function templateListURL(filters: TemplateFilters): string {
  const query = new URLSearchParams();
  if (filters.media) query.set("type", filters.media);
  if (filters.category) query.set("category", filters.category);
  if (filters.keyword) query.set("q", filters.keyword);
  if (filters.page > 1) query.set("page", String(filters.page));
  return `/templates${query.size ? `?${query}` : ""}`;
}
export function templateReturnURL(value: string | null | undefined): string {
  try {
    const url = new URL(value || "/templates", "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== "/templates" || url.hash) return "/templates";
    return templateListURL(templateFilters(url.searchParams));
  } catch { return "/templates"; }
}
export function saveTemplateScroll(url: string, element: HTMLElement): void {
  try { sessionStorage.setItem(`flowlight.template.scroll.${url}`, JSON.stringify({ inner: element.scrollTop, outer: window.scrollY })); } catch { /* navigation still works with storage disabled */ }
}
export function restoreTemplateScroll(url: string, element: HTMLElement): void {
  try {
    const value = JSON.parse(sessionStorage.getItem(`flowlight.template.scroll.${url}`) || "{}");
    element.scrollTop = Number.isFinite(value.inner) ? Math.max(0, value.inner) : 0;
    window.scrollTo({ top: Number.isFinite(value.outer) ? Math.max(0, value.outer) : 0, behavior: "instant" });
  } catch { element.scrollTop = 0; }
}
