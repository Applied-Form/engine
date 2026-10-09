/**
 * Reading somebody else's design system into this one.
 *
 * A Standards pack (`appliedform/standards`) states a system as a `tokens.json` on its own
 * contract: a handful of named colour roles with a sentence of intent each, one or two type
 * families, and a set of system values. It is not DTCG and it is not ours, which is the point —
 * this is the path by which a system authored elsewhere becomes an instance the gate enforces.
 *
 * Three things make the import honest rather than a lossy guess.
 *
 * **The pack's own values win where it states them.** A role the pack names is used exactly as
 * written. Nothing is nudged to fit our palette.
 *
 * **What the pack does not state is derived, and said so.** Applied Form's rules reference roles
 * a six-colour pack has never heard of — a support colour for chart series, a caution, a tint.
 * Those are derived from the pack's own accent hue and paper by `derivePalette`, which walks
 * lightness until every floor is measured to hold. Every derived role is listed in the report,
 * so nobody mistakes a derivation for a decision the pack's author made.
 *
 * **A pack that cannot satisfy the floors is refused with the measurement.** This is the same
 * contract `af brand` has: the system says no and shows its working, rather than emitting an
 * overlay that fails contrast the first time it is linted.
 *
 * What cannot be imported is reported too. A pack with no display voice cannot fill Register I,
 * and a pack whose grid is not this one keeps its own number in the report while the overlay
 * inherits ours, because the grid is not yet a parameter (decision 0016).
 */
import { derivePalette, toOverlay } from './palette.mjs';
import { contrast } from './contrast.mjs';
import { floors } from './tokens.mjs';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Hue in degrees from a hex, which is what derivePalette takes as its anchor. */
export function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}

/**
 * Which pack role fills which of this system's colour tokens.
 *
 * The mapping is by job rather than by name: a pack's `signal` is whatever it uses for
 * identification and one point of emphasis, which is what this system calls the accent. Anything
 * not listed here has no counterpart in the pack contract and is derived.
 */
export const PACK_ROLE_TO_TOKEN = {
  ground: 'paper',
  ink: 'ink',
  muted: 'muted',
  rule: 'sand',
  signal: 'terracotta',
  focus: 'focus',
};

/** The floors an imported palette is measured against before it is allowed out. */
function floorChecks(color) {
  const c = (k) => color[k];
  return [
    ['body text on the ground', c('ink'), c('paper'), floors.bodyContrast],
    ['muted text on the ground', c('muted'), c('paper'), floors.bodyContrast],
    ['the accent on the ground', c('terracotta'), c('paper'), floors.bodyContrast],
    ['the ground on ink', c('paper'), c('ink'), floors.bodyContrast],
  ].filter(([, a, b]) => HEX.test(a ?? '') && HEX.test(b ?? ''));
}

/**
 * Turn a pack's token contract into a brand overlay for this system.
 *
 * Returns `{ overlay, report }`, or `{ overlay: null, report }` when a floor fails. The report is
 * the deliverable as much as the overlay is: stated roles, derived roles, what could not be
 * carried across, and every measurement that was taken.
 */
export function fromPack(pack, { key, name } = {}) {
  const report = { system: pack.system, version: pack.version, stated: [], derived: [], carried: [], refused: [], notes: [] };

  if (!pack.colour || !pack.colour.signal || !pack.colour.ground) {
    report.refused.push('the pack states no signal or no ground, and both anchor the derivation');
    return { overlay: null, report };
  }
  const stated = Object.fromEntries(
    Object.entries(PACK_ROLE_TO_TOKEN)
      .filter(([role]) => pack.colour[role] && HEX.test(pack.colour[role].value ?? ''))
      .map(([role, token]) => [token, pack.colour[role].value.toUpperCase()]),
  );
  report.stated = Object.entries(stated).map(([token, hex]) => `${token} ← ${hex}, the pack's own value`);

  // Everything the pack never names, derived from its own accent and paper rather than borrowed
  // from ours. A pack of six colours cannot state a chart support colour or a caution.
  let derived;
  try {
    derived = derivePalette({ hue: hueOf(stated.terracotta), paper: stated.paper });
  } catch (e) {
    report.refused.push(`no palette satisfies the floors from this pack's accent and ground: ${e.message}`);
    return { overlay: null, report };
  }

  const overlay = toOverlay(derived, { key, name: name ?? `${pack.system} (imported)` });
  const before = Object.fromEntries(Object.entries(overlay.color).map(([k, v]) => [k, v.$value.hex ?? v.$value]));
  for (const [token, hex] of Object.entries(stated)) {
    overlay.color[token] = { $value: { colorSpace: 'srgb', components: [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 10000) / 10000), hex } };
  }
  report.derived = Object.keys(before)
    .filter((token) => !(token in stated))
    .map((token) => `${token} ← ${before[token]}, derived from the pack's accent hue ${hueOf(stated.terracotta)}°`);

  // The pack's values are its own, so they are measured rather than trusted. A system whose own
  // colours fail the floors is a finding to hand back to its author, not a defect to inherit.
  const measured = Object.fromEntries(Object.entries(overlay.color).map(([k, v]) => [k, v.$value.hex ?? v.$value]));
  for (const [what, fg, bg, need] of floorChecks(measured)) {
    const ratio = contrast(fg, bg);
    report.notes.push(`${what}: ${ratio.toFixed(2)}:1 against a floor of ${need}`);
    if (ratio < need) report.refused.push(`${what} measures ${ratio.toFixed(2)}:1, below the ${need}:1 floor`);
  }

  // Type. A pack states the families it uses; a voice it has no family for keeps this system's,
  // and that is a limitation rather than a decision, so it is reported as one.
  const font = {};
  if (pack.type?.text) font.text = { $value: splitStack(pack.type.text) };
  if (pack.type?.data) font.data = { $value: splitStack(pack.type.data) };
  if (pack.type?.display) font.display = { $value: splitStack(pack.type.display) };
  else report.carried.push('no display voice: this pack has none, so Register I keeps this system\'s display family and a Register I page under it is not the pack\'s design');
  if (Object.keys(font).length) overlay.font = font;

  // System values that this system already has a home for, and the ones it does not.
  const sv = pack.system_values ?? {};
  const num = (v) => (v == null ? null : parseFloat(String(v)));
  if (num(sv.radius) === 0) report.carried.push('radius 0: kept as a declared absence, which is this system\'s default');
  else if (num(sv.radius) > 0) {
    overlay.radius = { $type: 'dimension', $description: `Imported from ${pack.system}, which permits a radius of ${sv.radius}.`, base: { $value: { value: num(sv.radius), unit: 'px' } } };
    overlay.$extensions = { ...overlay.$extensions };
    overlay.$extensions['form.applied'] = { ...overlay.$extensions['form.applied'], absent: { $value: ['shadow', 'gradient-fill'] } };
    report.carried.push(`radius ${sv.radius}: permitted, on a one-step scale`);
  }
  if (num(sv.measure) && num(sv.measure) !== floors.maxMeasureCh) {
    report.carried.push(`measure ${sv.measure}: this system's ceiling is ${floors.maxMeasureCh}ch and floors do not move, so the stricter of the two applies`);
  }
  if (num(sv.cols) && num(sv.cols) !== 16) {
    report.carried.push(`grid ${sv.cols} columns: not carried, because the grid is not yet a parameter (decision 0016). The overlay uses this system's 16`);
  }
  if (num(sv.unit) && num(sv.unit) !== 8) {
    report.carried.push(`base unit ${sv.unit}: not carried; this system's spacing scale is 8px and every spacing rule reads it`);
  }

  return { overlay: report.refused.length ? null : overlay, report };
}

/** A CSS font stack as a DTCG fontFamily array. */
function splitStack(stack) {
  return String(stack).split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
