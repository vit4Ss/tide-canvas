/** 3D outputs are distributed through the dedicated 3D workflow. Their raw
 * provider URLs are diagnostic artifacts and should not be previewed in either
 * generation-history detail surface. */
export function shouldShowGenerationResult(
  ...mediaTypes: Array<string | null | undefined>
): boolean {
  return !mediaTypes.some((mediaType) => mediaType?.trim().toLowerCase() === "3d");
}
