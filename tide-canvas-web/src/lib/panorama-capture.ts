export interface PixelSize { width: number; height: number }

const MAX_CAPTURE_EDGE = 4096;
const MAX_CAPTURE_PIXELS = 12_000_000;

/** Choose a perspective render size from the equirectangular source's angular
 * pixel density. Existing DPR preview quality is the minimum; GPU and PNG
 * memory are bounded for unusually large panoramas. */
export function panoramaCaptureSize(input: {
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  previewPixelRatio: number;
  verticalFov: number;
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
  let height = Math.max(viewportHeight * dpr, verticalHeight, horizontalHeight);
  let width = height * aspect;
  const hardwareLimit = positive(input.maxRenderbufferSize ?? MAX_CAPTURE_EDGE, MAX_CAPTURE_EDGE);
  const edgeLimit = Math.min(MAX_CAPTURE_EDGE, hardwareLimit);
  const scale = Math.min(1, edgeLimit / Math.max(width, height), Math.sqrt(MAX_CAPTURE_PIXELS / (width * height)));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  return { width, height };
}
