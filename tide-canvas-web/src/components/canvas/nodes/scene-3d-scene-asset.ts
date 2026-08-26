import type { CanvasThreeDSceneAsset } from "@/types/canvas-three-d";

/** Persisted Director scene assets are deliberately limited to browser-loadable GLB files. */
export function normalizeScene3DSceneAsset(value: unknown): CanvasThreeDSceneAsset | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<CanvasThreeDSceneAsset>;
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!/^https?:\/\//i.test(url) || !/\.glb(?:[?#]|$)/i.test(url)) return undefined;
  const title = typeof raw.title === "string" && raw.title.trim()
    ? raw.title.trim().slice(0, 200)
    : "3D 场景";
  const sourceNodeId = typeof raw.sourceNodeId === "string" && raw.sourceNodeId.trim()
    ? raw.sourceNodeId.trim().slice(0, 100)
    : undefined;
  const source = raw.source === "connected" || raw.source === "restored" ? raw.source : undefined;
  return {
    url,
    title,
    ...(sourceNodeId ? { sourceNodeId } : {}),
    ...(source ? { source } : {}),
  };
}
