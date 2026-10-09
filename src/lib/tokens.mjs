/**
 * Loads tokens/applied-form.tokens.json (DTCG 2024 draft) and exposes the
 * resolved, flattened views the rest of the system uses.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TOKENS_PATH = fileURLToPath(new URL('../../tokens/applied-form.tokens.json', import.meta.url));
export const BRANDS_DIR = fileURLToPath(new URL('../../brands/', import.meta.url));

/** Deep-merge a brand overlay into the base tree: objects merge, everything else (arrays, strings, numbers) replaces. */
export function mergeTokens(base, overlay) {
  if (Array.isArray(overlay) || overlay === null || typeof overlay !== 'object') return overlay;
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) out[k] = k in out && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && v && typeof v === 'object' && !Array.isArray(v) ? mergeTokens(out[k], v) : v;
  return out;
}

/** Load the base token file, with a brand overlay (brands/<name>.tokens.json) merged in when one is named. */
export function loadTokens(brand = process.env.AF_BRAND) {
  const base = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
  if (!brand) return base;
  // A brand is a name under brands/, or a path to an overlay file, so a test can state a system
  // without it having to be one of the shipped brands.
  const overlay = JSON.parse(readFileSync(brand.endsWith('.json') ? brand : `${BRANDS_DIR}${brand}.tokens.json`, 'utf8'));
  return mergeTokens(base, overlay);
}

export const brand = process.env.AF_BRAND || null;
export const tokens = loadTokens(brand);

const EXT = 'form.applied';
const REF = /^\{([a-z0-9.-]+)\}$/i;

/** Walk a dotted path through the token tree. */
export function get(path, root = tokens) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), root);
}

/** Resolve `{a.b}` aliases anywhere inside a value. Plain values pass through. */
/**
 * A DTCG 2025.10 colour is an object carrying its colour space, its components and an
 * optional hex fallback; before 2025.10 it was a plain hex string. Both forms are accepted
 * for one release (decision 0015), and everything downstream of here sees a hex string,
 * because that is what the contrast maths, the CSS emitters and the rules all speak.
 * Components are used when the hex fallback is absent, which is how a wide-gamut colour
 * with no sRGB spelling arrives.
 */
const isColorObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Array.isArray(v.components) && typeof v.colorSpace === 'string';

export function colorHex(v) {
  if (typeof v === 'string') return v;
  if (!isColorObject(v)) return v;
  if (typeof v.hex === 'string') return v.hex.toUpperCase();
  const ch = (n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + v.components.slice(0, 3).map(ch).join('');
}

/**
 * A hex written back into the file in whichever colour form the token already used, so an
 * import can update a value without silently migrating the file's format underneath it.
 */
export function colorLike(hex, existing) {
  const up = hex.toUpperCase();
  if (typeof existing === 'string' || !isColorObject(existing)) return up;
  const c = (i) => Math.round((parseInt(up.slice(i, i + 2), 16) / 255) * 10000) / 10000;
  return { ...existing, colorSpace: existing.colorSpace ?? 'srgb', components: [c(1), c(3), c(5)], hex: up };
}

export function resolve(value, root = tokens) {
  if (isColorObject(value)) return colorHex(value);
  if (Array.isArray(value)) return value.map((v) => resolve(v, root));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, root)]));
  }
  if (typeof value !== 'string') return value;
  const m = value.match(REF);
  if (!m) return value;
  const node = get(m[1], root);
  if (node == null) throw new Error(`Unresolved token alias ${value}`);
  return resolve('$value' in node ? node.$value : node, root);
}

/** Resolved $value of the token at `path`. */
export const value = (path) => {
  const node = get(path);
  if (node == null || !('$value' in node)) throw new Error(`No token at ${path}`);
  return resolve(node.$value);
};

/** The form.applied extension object at `path` (or the root). */
export const ext = (path) => (path ? get(path) : tokens)?.$extensions?.[EXT] ?? {};

const px = (dim) => (typeof dim === 'object' ? dim.value : parseFloat(dim));
const dim = (d) => `${d.value}${d.unit}`;
const leafEntries = (group) => Object.entries(group).filter(([k]) => !k.startsWith('$'));

/** Flat map of colour name -> hex. */
export const colors = Object.fromEntries(leafEntries(tokens.color).map(([name, t]) => [name, colorHex(t.$value)]));

/** Hex -> token name. */
export const colorName = (hex) =>
  Object.entries(colors).find(([, v]) => v.toUpperCase() === String(hex).toUpperCase())?.[0] ?? null;

/** Resolved register palettes, e.g. registers.ii.link is the Register II link colour as a hex string. */
export const registers = Object.fromEntries(
  leafEntries(tokens.register).map(([id, group]) => [
    id,
    { ...Object.fromEntries(leafEntries(group).map(([k, t]) => [k, resolve(t.$value)])), grounds: resolve(ext(`register.${id}`).grounds) },
  ]),
);

const series = (group) => leafEntries(group).sort(([a], [b]) => Number(a) - Number(b)).map(([, t]) => resolve(t.$value));
export const chartSeries = series(tokens.chart.series);
export const chartSeriesOnLight = series(tokens.chart['series-on-light']);
export const chartSeriesOnDark = series(tokens.chart['series-on-dark']);
export const chartScales = { sequential: series(tokens.chart['scale-sequential']), diverging: series(tokens.chart['scale-diverging']) };
export const chart = { minMarkContrast: value('chart.min-mark-contrast'), minNeighbourContrast: value('chart.min-neighbour-contrast'), maxSeries: value('chart.max-series'), stroke: { line: px(value('chart.stroke.line')), axis: px(value('chart.stroke.axis')), spark: px(value('chart.stroke.spark')) }, mark: { dot: px(value('chart.mark.dot')), barGap: px(value('chart.mark.bar-gap')) }, labelOffset: px(value('chart.label-offset')) };

export const fonts = Object.fromEntries(leafEntries(tokens.font).map(([k, t]) => [k, t.$value]));

/** Type scale, flattened: { voice, family, weight, size, minSize, leading, tracking, transform, registers }. */
export const typeScale = Object.fromEntries(
  leafEntries(tokens.type).map(([name, t]) => {
    const v = resolve(t.$value);
    const x = ext(`type.${name}`);
    return [name, {
      voice: x.voice,
      family: v.fontFamily,
      weight: v.fontWeight,
      minSize: px(v.fontSize),
      size: x.fluidSize ?? `${px(v.fontSize)}px`,
      leading: v.lineHeight,
      tracking: x.trackingEm != null ? `${x.trackingEm}em` : (v.letterSpacing && v.letterSpacing.value ? `${v.letterSpacing.value}${v.letterSpacing.unit}` : undefined),
      transform: x.transform,
      registers: x.registers,
    }];
  }),
);

export const display = {
  opszBreakpoint: px(value('display.opsz-breakpoint')),
  opszAbove: value('display.opsz-above'),
  opszBelow: value('display.opsz-below'),
  weightMin: value('display.weight-min'),
  weightMax: value('display.weight-max'),
};

export const spacingUnit = ext('spacing').unit;
export const spacingScale = leafEntries(tokens.spacing).sort(([a], [b]) => Number(a) - Number(b)).map(([, t]) => px(t.$value));

export const grid = {
  gutter: px(tokens.grid.gutter.$value),
  breakpoints: Object.fromEntries(
    leafEntries(tokens.grid.breakpoints).map(([k, b]) => [k, { minWidth: px(b['min-width'].$value), columns: b.columns.$value, margin: px(b.margin.$value) }]),
  ),
};

export const aspectRatios = ext().aspectRatios;

export const floors = {
  bodyContrast: value('floors.body-contrast'),
  displayContrast: value('floors.display-contrast'),
  largeTextPx: value('floors.large-text-px'),
  largeBoldTextPx: value('floors.large-bold-text-px'),
  maxMeasureCh: value('floors.max-measure-ch'),
  bodyMinPxRegisterII: value('floors.body-min-px-register-ii'),
  textMinPx: value('floors.text-min-px'),
  labelApca: value('floors.label-apca'),
  provenanceAfterWords: value('floors.provenance-after-words'),
  apcaBodyAdvisory: value('floors.apca-body-advisory'),
  apcaLargeAdvisory: value('floors.apca-large-advisory'),
};

/** Colour name -> ordered list of resolved fallback hexes. */
export const fallbacks = Object.fromEntries(
  Object.entries(ext().fallbacks).filter(([k]) => !k.startsWith('$')).map(([name, list]) => [name, resolve(list)]),
);

export const version = ext().version;

/** Spread archetypes (the moves), grounds resolved. */
export const spreads = Object.fromEntries(
  Object.entries(ext().spreads).filter(([k]) => !k.startsWith('$')).map(([k, s]) => [k, resolve(s)]),
);
export const markParams = ext().mark;
export const motion = {
  duration: Object.fromEntries(leafEntries(tokens.motion.duration).map(([k, t]) => [k, t.$value.value])),
  easing: Object.fromEntries(leafEntries(tokens.motion.easing).map(([k, t]) => [k, t.$value])),
};
export const rules = Object.fromEntries(leafEntries(tokens.rule).map(([k, t]) => [k, px(t.$value)]));
export const opacity = Object.fromEntries(leafEntries(tokens.opacity).map(([k, t]) => [k, t.$value]));
export const focus = Object.fromEntries(leafEntries(tokens.focus).map(([k, t]) => [k, px(t.$value)]));

/** Resolved interaction-state palette, e.g. states.hover.link is the hovered link colour as a hex string. Follows the two-level shape of `state`: a named state group of leaf tokens. */
export const states = Object.fromEntries(
  leafEntries(tokens.state).map(([group, node]) => [group, Object.fromEntries(leafEntries(node).map(([k, t]) => [k, resolve(t.$value)]))]),
);

/** Effects the system deliberately never uses; the absence rules flag anything reaching for one. */
/**
 * What a system forbids, read from its own file rather than from Applied Form's taste.
 *
 * `neverGround` names colours that may never be a full-bleed ground, whatever the register;
 * `pairs` names text-on-ground combinations that are refused outright, which is how a system
 * states a prohibition stricter than the contrast floor. A system that declares neither gets
 * neither rule, which is correct: the absence of a prohibition is not a missing rule.
 */
/**
 * Tokens on their way out.
 *
 * A design system without a deprecation cycle removes a token when somebody decides to, and every
 * consumer finds out by breaking. `$deprecated` on a leaf says a token is going: the value keeps
 * working, the CSS carries a comment, the flat export carries the note, `af rules --deprecated`
 * lists them, and a test fails when a major release ships one that is still there. The replacement
 * is named, because "deprecated" without a successor is an instruction to guess.
 */
export function deprecations(root = tokens) {
  const out = [];
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    if (node.$deprecated) {
      out.push({
        path,
        replacement: typeof node.$deprecated === 'string' ? node.$deprecated : node.$deprecated.replacement ?? null,
        since: node.$deprecated.since ?? null,
        removeIn: node.$deprecated.removeIn ?? null,
      });
    }
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, path ? `${path}.${k}` : k);
  };
  walk(root, '');
  return out;
}

export const prohibitions = {
  neverGround: (ext().prohibitions?.neverGround ?? []).map((v) => resolve(v)),
  pairs: (ext().prohibitions?.pairs ?? []).map((p) => ({ text: resolve(p.text), ground: resolve(p.ground) })),
};

/**
 * Effects a system permits, and on what scale.
 *
 * `absent` lists what it refuses outright — Applied Form refuses shadow, gradient fill and
 * radius. A system that permits one removes it from that list and declares the scale it is
 * allowed on, as a token group. The rules then check membership of the scale instead of
 * presence of the effect, which is the difference between enforcing a design system and
 * enforcing this one. A declared absence is still the stricter statement, so it wins where
 * both are present.
 */
/** The declared steps by name, for the CSS custom properties. Empty when the system declares the effect absent. */
export const radiusTokens = tokens.radius ? Object.fromEntries(leafEntries(tokens.radius).map(([k, t]) => [k, px(t.$value)])) : {};
export const elevationTokens = tokens.elevation ? Object.fromEntries(leafEntries(tokens.elevation).map(([k, t]) => [k, String(resolve(t.$value))])) : {};

export const radiusScale = tokens.radius ? leafEntries(tokens.radius).map(([, t]) => px(t.$value)) : [];
export const elevationScale = tokens.elevation ? leafEntries(tokens.elevation).map(([, t]) => String(resolve(t.$value))) : [];

/** The voices this system has, in the order the file declares them. A system may have any number. */
export const voices = Object.keys(fonts);

/** The first family of a voice's stack, for a message that names what the reader will see. */
export const familyOf = (voice) => (fonts[voice] ?? [])[0] ?? voice;

export const absent = ext().absent.$value;
export const layers = Object.fromEntries(leafEntries(tokens.layer).map(([k, t]) => [k, t.$value]));
export const bleeds = Object.fromEntries(leafEntries(tokens.bleed).map(([k, t]) => [k, px(t.$value)]));
export const composition = ext().composition;
/**
 * The column count the recipes were authored against.
 *
 * A recipe names its cells by absolute column index — `11 / 13` is the eleventh line to the
 * thirteenth — so a move is written for a grid, not for a proportion. Five-eighths of the width is
 * column 11 of 16 and has no column line at all on a twelve-column grid. Declaring the number lets
 * the linter say that instead of listing cells the page could never have produced. It is also the
 * honest statement of a limitation: the grid is the one part of this system that is not yet a
 * parameter (engineering review, 3.0).
 */
export const recipeColumns = ext().recipes?.$authoredForColumns ?? null;

export const recipes = Object.fromEntries(Object.entries(ext().recipes).filter(([k]) => !k.startsWith('$')));
export const print = {
  page: { width: dim(tokens.print.page.width.$value), height: dim(tokens.print.page.height.$value) },
  margin: { top: dim(tokens.print.margin.top.$value), bottom: dim(tokens.print.margin.bottom.$value), inline: dim(tokens.print.margin.inline.$value) },
};

/** The brand block, if any: name, wordmark asset, self-hosted font files, fonts directory. */
export const brandInfo = ext().brand ?? null;
