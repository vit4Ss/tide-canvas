import type { CanvasThreeDSceneAsset } from "@/types/canvas-three-d";

/** Persisted Director assets accept regular GLB meshes and Marble SPZ worlds. */
export function normalizeScene3DSceneAsset(value: unknown): CanvasThreeDSceneAsset | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<CanvasThreeDSceneAsset>;
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return undefined;
  const inferredFormat = /\.spz(?:[?#]|$)/i.test(url) ? "spz" : /\.glb(?:[?#]|$)/i.test(url) ? "glb" : undefined;
  const format = raw.format === "spz" || raw.format === "glb" ? raw.format : inferredFormat;
  if (!format) return undefined;
  const colliderUrl = typeof raw.colliderUrl === "string" && /^https?:\/\//i.test(raw.colliderUrl.trim())
    && /\.glb(?:[?#]|$)/i.test(raw.colliderUrl.trim())
    ? raw.colliderUrl.trim()
    : undefined;
  const metricScaleFactor = Number(raw.metricScaleFactor);
  const groundPlaneOffset = Number(raw.groundPlaneOffset);
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
    format,
    ...(colliderUrl ? { colliderUrl } : {}),
    ...(Number.isFinite(metricScaleFactor) && metricScaleFactor > 0 ? { metricScaleFactor } : {}),
    ...(Number.isFinite(groundPlaneOffset) ? { groundPlaneOffset } : {}),
    ...(sourceNodeId ? { sourceNodeId } : {}),
    ...(source ? { source } : {}),
  };
}
