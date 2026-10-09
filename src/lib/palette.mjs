/**
 * Brand slots: derive a palette from a primary hue and a paper, measured
 * against every floor, and refuse one that cannot satisfy them.
 *
 * Roles derived, mirroring the Applied Form palette:
 *   paper (given), sand, tint, primary (the accent), primary-deep (links on paper/white),
 *   primary-light (links on ink), espresso (dark ground), ink (darkest ground and text), muted,
 *   support (a second hue at +150°), positive, caution, critical, focus (yellow, fixed).
 *
 * Colour maths is HSL-based; every candidate is checked with the WCAG ratio,
 * not assumed. The output is a token-file fragment.
 */
import { contrast } from './contrast.mjs';
import { colors as systemColors, colorLike } from './tokens.mjs';

export function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
}
export function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** Walk lightness from `from` toward `to` until every (ground, ratio) target holds. Returns hex or null. */
function fit(h, s, from, to, targets) {
  const step = from < to ? 0.005 : -0.005;
  for (let l = from; step > 0 ? l <= to : l >= to; l += step) {
    const hex = hslToHex(h, s, l);
    if (targets.every(([ground, min]) => contrast(hex, ground) >= min)) return hex;
  }
  return null;
}

/**
 * derivePalette({ hue, paper, saturation? }) -> { colors, register, report } or throws with the reasons.
 * hue 0–360; paper a light hex; saturation 0–1 for the accent (default 0.55).
 */
export function derivePalette({ hue, paper, saturation = 0.55, floors = { body: 4.5, large: 3 } }) {
  const reasons = [];
  const pl = hexToHsl(paper).l;
  if (pl < 0.9) reasons.push(`paper ${paper} is too dark (lightness ${pl.toFixed(2)}); a paper is 0.90 or lighter`);
  const ph = hexToHsl(paper).h, ps = Math.min(hexToHsl(paper).s, 0.4);
  const sand = hslToHex(ph, ps, Math.max(pl - 0.05, 0.86));
  const tint = hslToHex(ph, Math.min(ps + 0.1, 0.5), Math.max(pl - 0.12, 0.8));
  const ink = hslToHex(hue, 0.12, 0.15);
  const espresso = hslToHex(hue, 0.35, 0.26);
  const white = '#FFFFFF';
  // Accent: the most saturated lightness that still reads as body text on paper and white (4.5), like terracotta.
  const primary = fit(hue, saturation, 0.5, 0.2, [[paper, floors.body], [white, floors.body]]);
  if (!primary) reasons.push(`no lightness of hue ${hue} at saturation ${saturation} reaches ${floors.body}:1 on ${paper}`);
  const primaryDeep = primary ? fit(hue, Math.min(saturation + 0.1, 1), hexToHsl(primary).l - 0.02, 0.12, [[white, 7], [paper, 6.5], [sand, floors.body]]) : null;
  if (!primaryDeep) reasons.push('no deep accent reaches 7:1 on white, 6.5:1 on paper and 4.5:1 on sand');
  const primaryLight = fit(hue, 0.45, 0.6, 0.9, [[ink, floors.body], [espresso, floors.body]]);
  if (!primaryLight) reasons.push('no light accent reaches 4.5:1 on ink and espresso');
  const muted = fit(hue, 0.12, 0.45, 0.25, [[paper, 5], [white, 5], [sand, floors.body]]);
  const support = fit((hue + 150) % 360, 0.35, 0.5, 0.2, [[paper, floors.body], [white, floors.body]]);
  const supportLight = fit((hue + 150) % 360, 0.3, 0.6, 0.9, [[ink, floors.body], [espresso, floors.body]]);
  const supportDeep = fit((hue + 150) % 360, 0.4, 0.5, 0.15, [[sand, floors.body], [paper, floors.body], [white, floors.body]]);
  if (!supportDeep) reasons.push('no deep support reaches 4.5:1 on white, paper and sand');
  // Soft: the mid-tone of the primary hue. Decorative and a chart fill, so it needs only the 3:1 mark floor on ink;
  // its light and deep variants carry the text floors on dark and light grounds respectively.
  const soft = fit(hue, Math.min(saturation * 0.75, 0.5), 0.5, 0.78, [[ink, floors.large]]);
  const softLight = fit(hue, 0.35, 0.6, 0.92, [[espresso, 5], [ink, 7]]);
  const softDeep = fit(hue, 0.4, 0.5, 0.15, [[white, floors.body], [paper, floors.body], [sand, floors.body]]);
  if (!soft || !softLight || !softDeep) reasons.push('no soft mid-tone with a light variant on dark grounds and a deep variant on light grounds');
  const positive = fit(160, 0.25, 0.45, 0.2, [[white, floors.body], [paper, floors.body]]);
  const caution = fit(40, 0.75, 0.5, 0.25, [[white, floors.large]]);
  const cautionDeep = fit(40, 0.75, 0.4, 0.15, [[white, floors.body], [paper, floors.body], [sand, floors.body]]);
  const critical = fit(5, 0.6, 0.45, 0.2, [[white, floors.body], [paper, floors.body]]);
  if (contrast(paper, ink) < 7) reasons.push(`paper on ink is only ${contrast(paper, ink).toFixed(2)}:1`);
  if (reasons.length) { const e = new Error(`This brand cannot satisfy the floors:\n- ${reasons.join('\n- ')}`); e.reasons = reasons; throw e; }
  const colors = { paper, sand, tint, soft, 'soft-light': softLight, 'soft-deep': softDeep, primary, 'primary-deep': primaryDeep, 'primary-light': primaryLight, espresso, ink, muted, support, 'support-deep': supportDeep, 'support-light': supportLight, white, 'layer-ii': hslToHex(ph, Math.min(ps, 0.15), 0.96), 'text-ii': hslToHex(hue, 0.15, 0.1), positive, caution, 'caution-deep': cautionDeep, critical, focus: systemColors.focus };
  const report = Object.entries({ 'primary on paper': [primary, paper], 'primary-deep on white': [primaryDeep, white], 'primary-light on ink': [primaryLight, ink], 'muted on paper': [muted, paper], 'support on white': [support, white], 'paper on ink': [paper, ink], 'paper on espresso': [paper, espresso], 'text-ii on white': [colors['text-ii'], white], 'soft-light on espresso': [softLight, espresso], 'soft-deep on white': [softDeep, white], 'support-deep on sand': [supportDeep, sand], 'ink on focus': [ink, systemColors.focus] }).map(([k, [a, b]]) => [k, Number(contrast(a, b).toFixed(2))]);
  return {
    colors,
    register: { i: { background: paper, layer: sand, text: ink, accent: primary, link: primary, support }, ii: { background: white, layer: colors['layer-ii'], text: colors['text-ii'], accent: primary, link: primaryDeep, support }, 'ii-dark': { background: ink, layer: espresso, text: paper, accent: primaryLight, link: primaryLight, support: supportLight } },
    report,
  };
}

/** A DTCG colour group for the derived palette, keyed by role, ready to splice into a token file. */
export function toTokens(p, name = 'brand') {
  return { $type: 'color', $description: `Derived palette "${name}", every role measured against the floors.`, ...Object.fromEntries(Object.entries(p.colors).map(([k, v]) => [k, { $value: v }])) };
}

/**
 * The derived roles under the system's own colour names, so the result is a brand overlay the
 * loader can merge. The register palettes need no overrides: the base file reaches them through
 * aliases, so they follow the colours.
 */
export const ROLE_TO_TOKEN = {
  paper: 'paper', sand: 'sand', tint: 'tint',
  soft: 'clay', 'soft-light': 'clay-light', 'soft-deep': 'clay-deep',
  primary: 'terracotta', 'primary-deep': 'terra-deep', 'primary-light': 'terracotta-light',
  support: 'teal', 'support-deep': 'teal-deep', 'support-light': 'teal-light',
  espresso: 'espresso', ink: 'ink', muted: 'muted', 'layer-ii': 'layer-ii', 'text-ii': 'text-ii',
  positive: 'positive', caution: 'caution', 'caution-deep': 'caution-deep', critical: 'critical',
};

/** A complete brand overlay: the derived colours under system names, plus the brand block. */
export function toOverlay(p, { name, key, wordmark, fontsDir, fonts } = {}) {
  const color = {};
  // Written in the file's own colour form (DTCG 2025.10), so a derived overlay merges over
  // the base without mixing formats in one tree.
  for (const [role, token] of Object.entries(ROLE_TO_TOKEN)) if (p.colors[role]) color[token] = { $value: colorLike(p.colors[role], { colorSpace: 'srgb', components: [] }) };
  const brand = { name: name ?? key ?? 'brand' };
  if (wordmark) brand.wordmark = wordmark;
  if (fontsDir) brand.fontsDir = fontsDir;
  if (fonts) brand.fonts = fonts;
  return {
    $description: `${brand.name}: a brand overlay derived by af brand. Colour only; type, mark, spacing, grid and every rule come from the base file.`,
    $extensions: { 'form.applied': { brand } },
    color,
  };
}
