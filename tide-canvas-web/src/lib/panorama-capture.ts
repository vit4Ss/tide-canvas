export interface PixelSize { width: number; height: number }

const MAX_CAPTURE_EDGE = 8192;
export const MAX_PANORAMA_OUTPUT_PIXELS = 24_000_000;
// A source-density-only projection from a common 2K/4K panorama can be merely
// 1200–1750 px wide. It contains the source detail but looks visibly soft when
// opened on a modern 2K display because the browser must enlarge it again.
// Supersample every perspective export to at least a 2560 px long edge; this
// cannot invent source detail, but it preserves projection edges and prevents a
// second lossy-looking display upscale. Export size/pixel caps remain authoritative.
const MIN_CAPTURE_LONG_EDGE = 2560;

/** Choose a perspective render size from the equirectangular source's angular
 * pixel density. Existing DPR preview quality is the minimum; PNG memory is
 * bounded. Worker exports do not inherit the preview GPU's texture-size limit. */
export function panoramaCaptureSize(input: {
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  previewPixelRatio: number;
  verticalFov: number;
  /** Optional ceiling for older WebGL callers; worker export leaves it unset. */
  maxRenderbufferSize?: number;
}): PixelSize {
  const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
  const sourceWidth = positive(input.sourceWidth, 1);
  const sourceHeight = positive(input.sourceHeight, 1);
  const viewportWidth = positive(input.viewportWidth, 1);
  const viewportHeight = positive(input.viewportHeight, 1);
  const aspect = viewportWidth / viewportHeight;
  const dpr = Math.min(2, Math.max(1, positive(input.previewPixelRatio, 1)));
  const fov = Math.min(100, Math.max(30, positive(input.verticalFov, 74))) * Math.PI / 180;
  const tangent = Math.tan(fov / 2);
  // Equirectangular source density: W/(2π), H/π. Perspective centre density:
  // output/(2*tan(FOV/2)). Standard 2:1 panoramas produce equal requirements.
  const verticalHeight = 2 * tangent * sourceHeight / Math.PI;
  const horizontalHeight = tangent * sourceWidth / Math.PI;
  const minimumExportHeight = MIN_CAPTURE_LONG_EDGE / Math.max(1, aspect);
  let height = Math.max(viewportHeight * dpr, verticalHeight, horizontalHeight, minimumExportHeight);
  let width = height * aspect;
  const hardwareLimit = positive(input.maxRenderbufferSize ?? MAX_CAPTURE_EDGE, MAX_CAPTURE_EDGE);
  const edgeLimit = Math.min(MAX_CAPTURE_EDGE, hardwareLimit);
  const scale = Math.min(1, edgeLimit / Math.max(width, height), Math.sqrt(MAX_PANORAMA_OUTPUT_PIXELS / (width * height)));
  width = Math.max(1, Math.floor(width * scale));
  height = Math.max(1, Math.floor(height * scale));
  return { width, height };
}
