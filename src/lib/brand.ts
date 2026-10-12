export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Framelyn",
  description: "A little imagination. An entirely new world.",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100",
  currency: process.env.NEXT_PUBLIC_BILLING_CURRENCY || "CNY",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "",
};

export const INSPIRATION = [
  { id: "coast", src: "/art/coast.jpg", title: "Somewhere beyond the ordinary", category: "Landscape", prompt: "A cinematic aerial view of a dramatic coastline, mist rolling over dark cliffs, soft evening light, atmospheric film photography, finely detailed, 16:9 composition." },
  { id: "architecture", src: "/art/architecture.jpg", title: "Space to think differently", category: "Architecture", prompt: "Minimal sculptural architecture with curved sandstone walls, a quiet courtyard, warm light and deep shadows, editorial architectural photography, natural materials." },
  { id: "portrait", src: "/art/portrait.jpg", title: "A new point of view", category: "Portrait", prompt: "An expressive editorial portrait with natural window light, subtle film grain, soft tonal contrast and a cinematic shallow depth of field." },
  { id: "desert", src: "/art/desert.jpg", title: "Let the light lead", category: "Nature", prompt: "An otherworldly desert landscape, layered dunes, tiny human figure for scale, warm sunset light, an elegant cinematic color palette, expansive composition." },
];

export function number(value: number | string): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}
export function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: BRAND.currency, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}
export function date(value: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
export function modelName(model: { name?: string; modelKey?: string; modelId?: string }): string {
  const name = model.name || "";
  if (name && !/[\p{Script=Han}]/u.test(name)) return name;
  return model.modelKey || model.modelId || "AI model";
}
