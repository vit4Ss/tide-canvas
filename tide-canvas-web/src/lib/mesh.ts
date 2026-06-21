// Deterministic mesh-gradient generators — ported 1:1 from the liuguang design
// (design-ref/app/data.jsx + design-ref/liuguang/home-data.js).
//
// These STAND IN for real AI artwork. Each `mesh()` call produces a deterministic
// tri-tone radial mesh whose hues are graded into ONE cohesive cool band
// (cyan -> blue -> indigo -> violet -> magenta, 198..318deg) so a gallery reads
// curated & premium instead of rainbow "AI slop".
//
// Pure, framework-agnostic. Returns a CSS `background` shorthand string.

/** Map any raw hue into the cool 198..318 band, matching the design exactly. */
function mapHue(h: number): number {
  return 198 + ((((h % 360) + 360) % 360) / 360) * 120; // 198..318
}

/**
 * Tri-tone mesh gradient. Pass three "seed" hues (any degree); the output is a
 * deterministic, comma-joined CSS gradient string suitable for a `background`
 * value. Identical seeds always produce identical output.
 */
export function mesh(h1: number, h2: number, h3: number): string {
  const a = mapHue(h1);
  const b = mapHue(h2);
  const c = mapHue(h3);
  return [
    `radial-gradient(120% 130% at 16% 8%, hsl(${a} 68% 60%) 0%, transparent 52%)`,
    `radial-gradient(120% 120% at 88% 18%, hsl(${b} 60% 54%) 0%, transparent 50%)`,
    `radial-gradient(140% 140% at 50% 108%, hsl(${c} 56% 44%) 0%, transparent 58%)`,
    `linear-gradient(155deg, hsl(${a} 46% 15%) 0%, hsl(${b} 52% 8%) 100%)`,
  ].join(', ');
}

/**
 * Named swatch palettes used by the background switcher / theming UI.
 * Returns a deterministic CSS gradient string for a given name. Unknown names
 * fall back to the default cool `flux` swatch so callers always get a valid value.
 *
 * `liuguang`/`flux` — the canonical cool brand band (default)
 * `aurora`         — green->cyan aurora
 * `ember`          — warm magenta->amber (still mapped through the cool band via mesh,
 *                     so swatch uses raw hues for a distinct warm read)
 * `mono`           — desaturated ink
 */
export function swatch(name: string): string {
  switch (name) {
    case 'aurora':
      return [
        'radial-gradient(70% 70% at 30% 25%, hsl(160 70% 52%) 0%, transparent 60%)',
        'radial-gradient(60% 60% at 80% 75%, hsl(190 72% 50%) 0%, transparent 62%)',
        'linear-gradient(155deg, hsl(170 46% 14%) 0%, hsl(200 52% 8%) 100%)',
      ].join(', ');
    case 'ember':
      return [
        'radial-gradient(70% 70% at 30% 25%, hsl(330 72% 58%) 0%, transparent 60%)',
        'radial-gradient(60% 60% at 80% 75%, hsl(28 80% 56%) 0%, transparent 62%)',
        'linear-gradient(155deg, hsl(345 46% 13%) 0%, hsl(20 52% 8%) 100%)',
      ].join(', ');
    case 'mono':
      return [
        'radial-gradient(70% 70% at 30% 25%, hsl(225 12% 42%) 0%, transparent 60%)',
        'radial-gradient(60% 60% at 80% 75%, hsl(225 10% 30%) 0%, transparent 62%)',
        'linear-gradient(155deg, hsl(225 14% 12%) 0%, hsl(225 16% 6%) 100%)',
      ].join(', ');
    case 'flux':
    case 'liuguang':
    default:
      // The canonical cool brand mesh (matches #flux-bg.flux-fallback spirit).
      return mesh(258, 210, 320);
  }
}
