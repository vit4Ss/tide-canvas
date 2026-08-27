import type { CanvasNode } from "@/stores/use-canvas-store";
import type { CanvasThreeDAsset, CanvasThreeDSceneAsset } from "@/types/canvas-three-d";

const HTTP_URL = /^https?:\/\//i;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse the durable multi-format metadata written by the 3D relay provider. */
export function canvasThreeDAssetsFromMeta(meta: unknown): CanvasThreeDAsset[] {
  let parsed = meta;
  if (typeof meta === "string") {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return [];
    }
  }
  const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as { assets?: unknown }).assets
    : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((candidate): CanvasThreeDAsset[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const url = nonEmptyString(row.url);
    if (!url || !HTTP_URL.test(url)) return [];
    const type = (nonEmptyString(row.type) || "model").toLowerCase();
    const previewImageUrl = nonEmptyString(row.previewImageUrl) || nonEmptyString(row.preview_image_url);
    const metricScaleFactor = finiteNumber(row.metricScaleFactor) ?? finiteNumber(row.metric_scale_factor);
    const groundPlaneOffset = finiteNumber(row.groundPlaneOffset) ?? finiteNumber(row.ground_plane_offset);
    return [{
      type,
      url,
      ...(previewImageUrl && HTTP_URL.test(previewImageUrl) ? { previewImageUrl } : {}),
      ...(metricScaleFactor !== undefined && metricScaleFactor > 0 ? { metricScaleFactor } : {}),
      ...(groundPlaneOffset !== undefined ? { groundPlaneOffset } : {}),
    }];
  });
}

function isGlbAsset(asset: CanvasThreeDAsset): boolean {
  return HTTP_URL.test(asset.url)
    && (asset.type.toLowerCase() === "glb" || /\.glb(?:[?#]|$)/i.test(asset.url));
}

/** A Director scene must be GLB; OBJ/STL/FBX/USDZ remain downloadable outputs. */
export function canvasThreeDGlbAsset(node?: Pick<CanvasNode, "modelSrc" | "modelAssets"> | null): CanvasThreeDAsset | null {
  if (!node) return null;
  const candidates = node.modelAssets?.filter(isGlbAsset) || [];
  // Marble's exact `glb` entry is its lightweight collider. Other providers
  // keep their declared order because a glb-hq entry may be the primary mesh.
  const hasSpz = node.modelAssets?.some(isSpzAsset) ?? false;
  const asset = hasSpz
    ? candidates.find((candidate) => candidate.type.toLowerCase() === "glb") || candidates[0]
    : candidates[0];
  if (asset?.url) return asset;
  return node.modelSrc && HTTP_URL.test(node.modelSrc) && /\.glb(?:[?#]|$)/i.test(node.modelSrc)
    ? { type: "glb", url: node.modelSrc }
    : null;
}

export function canvasThreeDGlbUrl(node?: Pick<CanvasNode, "modelSrc" | "modelAssets"> | null): string | null {
  return canvasThreeDGlbAsset(node)?.url || null;
}

export function canvasThreeDPreviewUrl(node?: Pick<CanvasNode, "modelPreviewSrc" | "modelAssets"> | null): string | null {
  if (!node) return null;
  if (node.modelPreviewSrc && HTTP_URL.test(node.modelPreviewSrc)) return node.modelPreviewSrc;
  return node.modelAssets?.find((asset) => asset.previewImageUrl && HTTP_URL.test(asset.previewImageUrl))?.previewImageUrl || null;
}

function isSpzAsset(asset: CanvasThreeDAsset): boolean {
  return HTTP_URL.test(asset.url)
    && (asset.type.toLowerCase().startsWith("spz") || /\.spz(?:[?#]|$)/i.test(asset.url));
}

/** Return the real file extension for provider variants such as spz-500k/glb-hq. */
export function canvasThreeDAssetExtension(type: string, url = ""): string {
  if (HTTP_URL.test(url)) {
    try {
      const match = new URL(url).pathname.match(/\.([a-z0-9]{2,6})$/i);
      const extension = match?.[1]?.toLowerCase();
      if (extension && ["glb", "spz", "obj", "stl", "usdz", "fbx", "ply"].includes(extension)) {
        return extension;
      }
    } catch {
      // Fall through to provider type normalization.
    }
  }
  const normalized = type.trim().toLowerCase().replace(/^\./, "");
  if (normalized.startsWith("spz")) return "spz";
  if (normalized.startsWith("glb")) return "glb";
  return ["obj", "stl", "usdz", "fbx", "ply"].includes(normalized) ? normalized : "glb";
}

/** Prefer Marble's balanced 500k SPZ, then lightweight 100k, before full-res. */
export function canvasThreeDSpzAsset(node?: Pick<CanvasNode, "modelSrc" | "modelAssets"> | null): CanvasThreeDAsset | null {
  if (!node) return null;
  const candidates = (node.modelAssets || []).filter(isSpzAsset);
  const preferred = ["spz-500k", "spz-100k", "spz", "spz-full"];
  for (const type of preferred) {
    const match = candidates.find((asset) => asset.type.toLowerCase() === type);
    if (match) return match;
  }
  if (candidates[0]) return candidates[0];
  return node.modelSrc && HTTP_URL.test(node.modelSrc) && /\.spz(?:[?#]|$)/i.test(node.modelSrc)
    ? { type: "spz", url: node.modelSrc }
    : null;
}

/** Resolve a canvas 3D node into a Director-loadable white model.
 *  Every GLB starts with a neutral material. Marble additionally provides a
 *  photographic SPZ, but the Director uses its collider GLB for blocking.
 *  Marble meshes share the SPZ raw frame, so the metric scale and ground
 *  offset ride along (falling back to the SPZ row on older records) — without
 *  them the Director would shrink a room-scale scene into a tabletop prop. */
export function canvasThreeDSceneAssetFromNode(
  node?: Pick<CanvasNode, "id" | "title" | "modelSrc" | "modelAssets"> | null,
): CanvasThreeDSceneAsset | null {
  if (!node) return null;
  const spz = canvasThreeDSpzAsset(node);
  const glb = canvasThreeDGlbAsset(node);
  if (glb) {
    const metricScaleFactor = glb.metricScaleFactor ?? spz?.metricScaleFactor;
    const groundPlaneOffset = glb.groundPlaneOffset ?? spz?.groundPlaneOffset;
    return {
      url: glb.url,
      format: "glb",
      materialMode: "solid",
      ...(spz ? { colliderUrl: glb.url } : {}),
      ...(metricScaleFactor !== undefined && metricScaleFactor > 0 ? { metricScaleFactor } : {}),
      ...(groundPlaneOffset !== undefined ? { groundPlaneOffset } : {}),
      title: node.title || (spz ? "Marble 白膜场景" : "已连接 3D 场景"),
      sourceNodeId: node.id,
      source: "connected",
    };
  }
  return null;
}
