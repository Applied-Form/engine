/**
 * Perceptual colour distance, which is the only honest way to ask whether two colours are
 * "the same" in a design system.
 *
 * A hex comparison says #3A6EA5 and #3A6EA6 are different colours. They are not: they are one
 * colour and a typo, and no human has ever seen the difference. Sorting that out is the whole
 * job of the palette inference in `infer.mjs`, and it needs a distance that tracks perception
 * rather than byte values.
 *
 * CIE Lab with a CIE76 distance is used here rather than the newer CIEDE2000. CIE76 overstates
 * differences among saturated blues, which is a real defect, but it is a handful of lines with
 * no branching and it is monotonic in the direction that matters. The decisions this feeds are
 * "is this a token or a mistake", taken against a threshold near the just-noticeable difference,
 * where the two formulas agree. Swapping in CIEDE2000 would change the third decimal place of a
 * number nobody reads and the answer to no question anybody asks. If that stops being true — a
 * client whose palette lives in saturated blue — this is the file to change, and `nearest()` is
 * the only entry point the rest of the code uses.
 *
 * Lifted out of `eval/score.mjs`, which had a private copy. The evaluation harness is dev-only
 * and unreachable from `src/`, so a product feature could not have used it there.
 */

/** The just-noticeable difference in CIE76, near enough. Two colours closer than this are one colour. */
export const JND = 2.3;

/**
 * sRGB hex to CIE Lab, D65. Returns null for anything that is not a six-digit hex, because the
 * callers survey real pages and a real page will hand you `transparent`, `currentcolor`, and
 * colours in four other syntaxes.
 */
export function srgbToLab(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** Perceptual distance between two hex colours, or null if either is not a hex. */
export function deltaE(a, b) {
  const [x, y] = [srgbToLab(a), srgbToLab(b)];
  if (!x || !y) return null;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * The closest colour in `palette` to `hex`, with its distance. Null when neither side has a
 * usable colour, so the caller can tell "no palette" from "on palette", which are opposite
 * findings and must never collapse into the same zero.
 */
export function nearest(hex, palette) {
  const a = srgbToLab(hex);
  if (!a) return null;
  let best = null;
  for (const p of palette) {
    const b = srgbToLab(p);
    if (!b) continue;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (best === null || d < best.distance) best = { hex: p, distance: d };
  }
  return best;
}

/** Distance from a colour to the nearest colour a palette allows. 0 means exactly on palette. */
export function paletteDistance(hex, palette) {
  return nearest(hex, palette)?.distance ?? null;
}
