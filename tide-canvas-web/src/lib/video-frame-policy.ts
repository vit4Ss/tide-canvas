const FIRST_DECODABLE_TIME = 0.001;

/** Resolve a seek target that forces browsers to decode a frame even when the
 * visible player has never started. Seeking to exactly 0 is commonly a no-op,
 * leaving a metadata-only video with nothing drawable on canvas. */
export function frameCaptureSeekTarget(timeSec: number, duration: number): number {
  const requested = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
  if (!Number.isFinite(duration) || duration <= 0) return requested;
  const lastSafeFrame = Math.max(0, duration - 0.02);
  const bounded = Math.min(requested, lastSafeFrame);
  if (bounded > 0) return bounded;
  return Math.min(FIRST_DECODABLE_TIME, duration / 2);
}
