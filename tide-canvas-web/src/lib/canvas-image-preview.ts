/** Original and thumbnail failures are independent. Prefer the requested
 * rendition, then try the other once; only fail the card when both failed. */
export function canvasImagePreview(input: {
  original: string;
  thumbnail: string;
  preferOriginal: boolean;
  failedUrls: readonly string[];
}): string | undefined {
  const candidates = input.preferOriginal
    ? [input.original, input.thumbnail]
    : [input.thumbnail, input.original];
  return candidates.find((url) => url && !input.failedUrls.includes(url));
}
