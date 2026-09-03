export type ResolvedResultKind = "image" | "video" | "audio" | "3d";

export interface ResultCellSeed {
  i: number;
  hues: [number, number, number];
  url?: string;
}

/**
 * Materialize terminal result cells from the provider's authoritative URL list.
 *
 * The number selected before submission describes how many requests/outputs the
 * user asked for; it is not necessarily the number a provider returns. Some
 * models (notably Midjourney) accept one request and return four independent
 * images. Conversely, a partially successful batch may return fewer URLs than
 * requested. Terminal UI must therefore follow urls.length exactly instead of
 * duplicating urls[0] to fill the original placeholders.
 *
 * 3D is the exception: multiple URLs commonly represent file formats for one
 * model (GLB/OBJ/FBX), so it remains one result card and exposes its formats via
 * the asset list.
 */
export function resolvedResultCells(
  seeds: readonly ResultCellSeed[],
  urls: readonly string[],
  kind: ResolvedResultKind,
): ResultCellSeed[] {
  if (urls.length === 0) return [];

  const count = kind === "3d" ? 1 : urls.length;
  const baseHues = seeds[0]?.hues ?? [0, 80, 200];
  return Array.from({ length: count }, (_, i) => {
    const seed = seeds[i];
    const hues: [number, number, number] = seed?.hues ?? [
      baseHues[0] + i * 36,
      baseHues[1] + i * 36,
      baseHues[2] + i * 36,
    ];
    return { i, hues, url: urls[i] };
  });
}
