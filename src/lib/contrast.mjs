/** WCAG 2.x relative luminance and contrast ratio. */

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Bad hex colour ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colours, 1..21. Order does not matter. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Is `sizePx` "large text" under WCAG? 24px regular or ~18.66px bold.
 */
export function isLargeText(sizePx, weight = 400, floors = { largeTextPx: 24, largeBoldTextPx: 18.66 }) {
  return sizePx >= floors.largeTextPx || (weight >= 700 && sizePx >= floors.largeBoldTextPx);
}

/** The contrast floor that applies to text of this size/weight. */
export function requiredContrast(sizePx, weight = 400, floors = { bodyContrast: 4.5, displayContrast: 3, largeTextPx: 24, largeBoldTextPx: 18.66 }) {
  return isLargeText(sizePx, weight, floors) ? floors.displayContrast : floors.bodyContrast;
}

export function passes(fg, bg, sizePx = 16, weight = 400, floors) {
  return contrast(fg, bg) >= requiredContrast(sizePx, weight, floors);
}

/**
 * Return `fg` if it meets the floor on `bg`, otherwise the first fallback
 * from the token file that does. Returns null when nothing in the system
 * works, which is the signal to change the ground rather than the colour.
 */
export function safeVariant(fg, bg, sizePx = 16, weight = 400, { fallbacks = {}, colorName = () => null, floors } = {}) {
  if (passes(fg, bg, sizePx, weight, floors)) return fg;
  for (const alt of fallbacks[colorName(fg)] ?? []) {
    if (passes(alt, bg, sizePx, weight, floors)) return alt;
  }
  return null;
}

/**
 * APCA (Accessible Perceptual Contrast Algorithm), W3 0.1.9 / 0.0.98G-4g
 * constants. Returns Lc: positive for dark text on a light ground, negative
 * for light on dark. Advisory only in this system; WCAG 2 floors are the gate.
 */
const APCA = {
  blkThrs: 0.022, blkClmp: 1.414, scale: 1.14, loOffset: 0.027, loClip: 0.1, deltaYmin: 0.0005,
  normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
};

function apcaY(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => (c / 255) ** 2.4);
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
}

export function apca(text, background) {
  const clamp = (y) => (y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp);
  const yTxt = clamp(apcaY(text));
  const yBg = clamp(apcaY(background));
  if (Math.abs(yBg - yTxt) < APCA.deltaYmin) return 0;
  let out;
  if (yBg > yTxt) {
    const sapc = (yBg ** APCA.normBG - yTxt ** APCA.normTXT) * APCA.scale;
    out = sapc < APCA.loClip ? 0 : sapc - APCA.loOffset;
  } else {
    const sapc = (yBg ** APCA.revBG - yTxt ** APCA.revTXT) * APCA.scale;
    out = sapc > -APCA.loClip ? 0 : sapc + APCA.loOffset;
  }
  return out * 100;
}
