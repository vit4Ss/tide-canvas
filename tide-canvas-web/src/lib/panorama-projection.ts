export interface PanoramaView {
  yaw: number;
  pitch: number;
  verticalFov: number;
  width: number;
  height: number;
}

export const MAX_PANORAMA_SOURCE_PIXELS = 40_000_000;
export const MAX_PANORAMA_OUTPUT_PIXELS = 24_000_000;

/** Project the decoded original pixels, independent of preview mesh tessellation,
 * mipmaps, screen size and WebGL MAX_TEXTURE_SIZE. Runs in a worker. */
export function projectPanorama(
  source: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, view: PanoramaView,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height } = view;
  if (![sourceWidth, sourceHeight, width, height].every((n) => Number.isInteger(n) && n > 0)
    || sourceWidth * sourceHeight > MAX_PANORAMA_SOURCE_PIXELS || width * height > MAX_PANORAMA_OUTPUT_PIXELS
    || source.length !== sourceWidth * sourceHeight * 4
    || ![view.yaw, view.pitch, view.verticalFov].every(Number.isFinite)) throw new Error("全景截图尺寸或视角无效");
  const yaw = ((view.yaw % 360) + 360) % 360 * Math.PI / 180;
  const pitch = Math.max(-85, Math.min(85, view.pitch)) * Math.PI / 180;
  const tangent = Math.tan(Math.max(30, Math.min(100, view.verticalFov)) * Math.PI / 360);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const dy = (1 - 2 * (y + 0.5) / height) * tangent;
    for (let x = 0; x < width; x++) {
      const dx = (2 * (x + 0.5) / width - 1) * tangent * width / height;
      // Same basis as Three's lookAt(yaw, pitch): forward + screen-right + up.
      const rx = cp * cy - dx * sy - dy * sp * cy;
      const ry = sp + dy * cp;
      const rz = cp * sy + dx * cy - dy * sp * sy;
      const length = Math.hypot(rx, ry, rz);
      // Inward-facing SphereGeometry scaled(-1,1,1): yaw 180° is image centre.
      const u = ((Math.atan2(rz, rx) / (2 * Math.PI)) % 1 + 1) % 1;
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ry / length))) / Math.PI;
      const sx = u * sourceWidth - 0.5;
      const floorX = Math.floor(sx);
      const x0 = (floorX % sourceWidth + sourceWidth) % sourceWidth;
      const x1 = (x0 + 1) % sourceWidth;
      const syPixel = Math.max(0, Math.min(sourceHeight - 1, v * sourceHeight - 0.5));
      const y0 = Math.floor(syPixel), y1 = Math.min(sourceHeight - 1, y0 + 1);
      const fx = sx - floorX, fy = syPixel - y0;
      const a = (y0 * sourceWidth + x0) * 4, b = (y0 * sourceWidth + x1) * 4;
      const c = (y1 * sourceWidth + x0) * 4, d = (y1 * sourceWidth + x1) * 4;
      const wa = (1 - fx) * (1 - fy) * source[a + 3], wb = fx * (1 - fy) * source[b + 3];
      const wc = (1 - fx) * fy * source[c + 3], wd = fx * fy * source[d + 3];
      const out = (y * width + x) * 4;
      // Premultiplied interpolation prevents dark fringes at transparent edges.
      const alpha = wa + wb + wc + wd;
      output[out + 3] = alpha;
      if (alpha > 0) {
        for (let channel = 0; channel < 3; channel++) {
          const value = source[a + channel] * wa + source[b + channel] * wb
            + source[c + channel] * wc + source[d + channel] * wd;
          output[out + channel] = value / alpha;
        }
      }
    }
  }
  return output;
}
