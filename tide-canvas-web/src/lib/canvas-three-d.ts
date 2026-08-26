import type { CanvasNode } from "@/stores/use-canvas-store";
import type { CanvasThreeDAsset } from "@/types/canvas-three-d";

const HTTP_URL = /^https?:\/\//i;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
    return [{
      type,
      url,
      ...(previewImageUrl && HTTP_URL.test(previewImageUrl) ? { previewImageUrl } : {}),
    }];
  });
}

function isGlbAsset(asset: CanvasThreeDAsset): boolean {
  return asset.type.toLowerCase() === "glb" || /\.glb(?:[?#]|$)/i.test(asset.url);
}

/** A Director scene must be GLB; OBJ/STL/FBX/USDZ remain downloadable outputs. */
export function canvasThreeDGlbUrl(node?: Pick<CanvasNode, "modelSrc" | "modelAssets"> | null): string | null {
  if (!node) return null;
  const asset = node.modelAssets?.find(isGlbAsset);
  if (asset?.url) return asset.url;
  return node.modelSrc && /\.glb(?:[?#]|$)/i.test(node.modelSrc) ? node.modelSrc : null;
}

export function canvasThreeDPreviewUrl(node?: Pick<CanvasNode, "modelPreviewSrc" | "modelAssets"> | null): string | null {
  if (!node) return null;
  return node.modelPreviewSrc || node.modelAssets?.find((asset) => asset.previewImageUrl)?.previewImageUrl || null;
}
