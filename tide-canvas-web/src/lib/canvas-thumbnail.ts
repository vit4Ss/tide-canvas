export const MAX_PROJECT_THUMBNAIL_CHARS = 512;

/** Project.thumbnail is VARCHAR(512). Long signed URLs stay in canvasData but
 * must not make the whole recovery snapshot fail at the database boundary. */
export function persistableProjectThumbnail(url: string | undefined | null): url is string {
  return !!url
    && /^https?:\/\//.test(url)
    && Array.from(url).length <= MAX_PROJECT_THUMBNAIL_CHARS;
}
