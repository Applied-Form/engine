/**
 * Violations to style patches. Pure: no page, no browser. Each patch names one element (by the id
 * the checker stamped) and the declarations that bring it inside the system. A violation the
 * planner cannot locate, or whose fix needs judgement, is left for the model.
 */
import { colors, spacingScale, spacingUnit, floors, fonts, aspectRatios, registers } from '../tokens.mjs';
import { passes } from '../contrast.mjs';

export const FIXABLE = [
  'radius-present', 'shadow-present', 'spacing', 'focus-hidden', 'focus-restyled', 'link-not-underlined', 'target-size',
  'contrast', 'text-too-small', 'body-too-small', 'font-off-system', 'data-not-mono',
  'aspect-ratio', 'accent-non-interactive-ii', 'measure',
];

const kebab = (p) => p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const stack = (voice) => [].concat(fonts[voice] ?? []).map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');

/**
 * A font size that renders at `floor` px: text drawn smaller than its own size (a scaled SVG chart)
 * is scaled up to match, with 2% of headroom, since the checker reads the rendered size to two
 * decimals and the other fixes in the same pass reflow the page by a pixel or two.
 */
const scaled = (t) => t?.cssPx && t?.sizePx && Math.abs(t.cssPx / t.sizePx - 1) > 0.001;
const sizeFor = (t, floor) => `${scaled(t) ? Math.ceil((floor * 1.02 * t.cssPx / t.sizePx) * 100) / 100 : floor}px`;

/**
 * The permitted ratio nearest to w:h, compared on a log scale so 2:1 and 1:2 are equally far from
 * 1:1. With `max`, only ratios at or below it are considered, falling back to all of them when
 * none qualifies.
 */
const nearestRatio = (w, h, { max = null } = {}) => {
  const all = aspectRatios.map((r) => r.split(':').map(Number));
  const pool = max != null ? all.filter(([rw, rh]) => rw / rh <= max + 1e-9) : [];
  return (pool.length ? pool : all)
    .reduce((best, r) => (Math.abs(Math.log((r[0] / r[1]) / (w / h))) < Math.abs(Math.log((best[0] / best[1]) / (w / h))) ? r : best));
};
const ratioOf = (s) => { const [a, b] = String(s).split('/').map(Number); return a / b; };

/**
 * Declarations measured at two widths into one patch. The same element is fixed once, for every
 * width, so where the widths disagree the patch takes the value that satisfies both: the larger
 * size, the taller box.
 */
const merge = (into, decl) => {
  for (const [k, v] of Object.entries(decl)) {
    const old = into[k];
    if (old != null && k === 'font-size') into[k] = parseFloat(v) > parseFloat(old) ? v : old;
    else if (old != null && k === 'aspect-ratio') into[k] = ratioOf(v) < ratioOf(old) ? v : old;
    else into[k] = v;
  }
};

/**
 * The register's own colour for text on this element's ground, used when the fallback lists have none:
 * its text colour, else its on-accent colour, whichever passes at every width the element was measured
 * at, since the fix is one rule for all of them. Null when none does, when a ground is one the checker
 * cannot vouch for, or for Register II interactive text, whose link colour is required: those need the
 * ground changed, which is the model's call.
 */
function registerColour(t, spec, measured) {
  const reg = spec?.register;
  const palette = registers[reg === 'ii' && spec?.theme === 'dark' && registers['ii-dark'] ? 'ii-dark' : reg];
  if (!palette || (String(reg).startsWith('ii') && t.isInteractive)) return null;
  if (!measured.every((x) => x.groundTrusted && x.background)) return null;
  return [palette.text, palette['on-accent']]
    .find((c) => c && measured.every((x) => passes(c, x.background, x.sizePx ?? 16, x.weight ?? 400, floors))) ?? null;
}

/** The nearest step of the spacing scale; beyond the largest step, the nearest multiple of the unit. */
export function snap(px) {
  const steps = [...spacingScale].sort((a, b) => a - b);
  if (px > steps[steps.length - 1]) return Math.round(px / spacingUnit) * spacingUnit;
  return steps.reduce((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best), steps[0]);
}

export function planFixes(results, { allow = FIXABLE } = {}) {
  const allowed = new Set(allow.filter((r) => FIXABLE.includes(r)));
  const patches = new Map();
  // A run drawn by ::before or ::after carries its host's id and names its pseudo-element.
  const add = (item, rule, decl, { pseudo = item?.pseudo ?? '', subtree = false } = {}) => {
    const afId = item?.afId;
    if (afId == null || afId === '') return;
    // One patch per element, pseudo-element or -class, and rule: rolling back one rule never takes another's fix.
    const key = `${afId}|${pseudo}|${rule}`;
    const p = patches.get(key) ?? { afId: String(afId), sel: item.sel, pseudo, decl: {}, rules: new Set(), ...(subtree ? { subtree } : {}) };
    merge(p.decl, decl);
    p.rules.add(rule);
    patches.set(key, p);
  };
  for (const r of results) {
    for (const v of r.violations ?? []) {
      if (!allowed.has(v.rule)) continue;
      switch (v.rule) {
        case 'radius-present': add(v.absence, v.rule, { 'border-radius': '0' }); break;
        case 'shadow-present': add(v.absence, v.rule, { 'box-shadow': 'none' }); break;
        // The checker wants the underline on every text-bearing run inside the link, and a run that
        // is not inline (a flex item, a block, an svg's title) does not inherit the link's own, so
        // the patch reaches the link's whole subtree.
        case 'link-not-underlined': add(v.link, v.rule, { 'text-decoration-line': 'underline' }, { subtree: true }); break;
        case 'target-size':
          add(v.target, v.rule, { 'min-width': '24px', 'min-height': '24px', ...(v.target?.display === 'inline' ? { display: 'inline-block' } : {}) });
          break;
        // Deliberately two cases, not one shared one: `outline: none` reports both rules on the same
        // focus style, and one of them is held out, so a single case lets a disclosed fix clear a
        // scored rule. Keep them separate even though the declaration is identical.
        case 'focus-hidden':
          add(v.focus, v.rule, { outline: `3px solid ${colors.focus}`, 'outline-offset': '2px' }, { pseudo: ':focus-visible' });
          break;
        case 'focus-restyled':
          add(v.focus, v.rule, { outline: `3px solid ${colors.focus}`, 'outline-offset': '2px' }, { pseudo: ':focus-visible' });
          break;
        case 'spacing':
          for (const s of (r.spec?.spacingSources ?? []).filter((x) => x.value === v.value)) {
            add(s, v.rule, { [kebab(s.prop)]: `${Math.sign(s.raw) < 0 ? '-' : ''}${snap(s.value)}px` });
          }
          break;
        case 'contrast': {
          const t = v.text;
          if (t?.afId == null) break;
          const measured = results.filter((x) => x.url === r.url).flatMap((x) => (x.spec?.text ?? []).filter((y) => y.afId === t.afId));
          const c = v.suggestion ?? registerColour(t, r.spec, measured.length ? measured : [t]);
          if (!c) break;
          // SVG paints text with fill, and an element's own opacity dims whatever colour it is given.
          add(t, v.rule, { color: c, ...(t.isSvgText ? { fill: c } : {}), ...(t.opacitySelf < 1 ? { opacity: '1' } : {}) });
          break;
        }
        case 'text-too-small': add(v.text, v.rule, { 'font-size': sizeFor(v.text, floors.textMinPx) }); break;
        case 'body-too-small': add(v.text, v.rule, { 'font-size': sizeFor(v.text, floors.bodyMinPxRegisterII) }); break;
        case 'measure': {
          // Cap the block, not the run. A flex or grid container, or one holding a table or an
          // image, changes layout rather than line length when capped, so leave it to the model.
          const b = v.text?.block;
          if (b && b.display !== 'flex' && b.display !== 'grid' && !b.hasLayoutChild) {
            add(b, v.rule, { 'max-width': `${floors.maxMeasureCh}ch`, 'box-sizing': 'border-box' });
          }
          break;
        }
        // SVG paints text with fill, which a colour declaration does not touch.
        case 'accent-non-interactive-ii': add(v.text, v.rule, { color: registers.ii.text, ...(v.text?.isSvgText ? { fill: registers.ii.text } : {}) }); break;
        case 'aspect-ratio':
          for (const s of (r.spec?.ratioSources ?? []).filter((x) => x.value === v.value)) {
            // An inline svg scales its drawing to fit its box, so a box shorter than the drawing
            // needs shrinks every label inside it and the fix is rolled back for the text rules it
            // breaks. The drawing keeps its size in any box no wider than the wider of its own ratio
            // and the box's: bound by the width, it has room down to its own ratio; bound by the
            // height, down to the box's. An image crops, so it takes the nearest ratio.
            const [rw, rh] = nearestRatio(s.w, s.h, { max: s.element === 'svg' ? Math.max(s.intrinsic ?? 0, s.w / s.h) : null });
            // The box follows its width, so what would hold its height is lifted: a max-height, the
            // stretch a flex or grid parent gives a child whose height is auto, and a flex basis
            // along a column. What would hold its width past its row is lifted too: a flex item's
            // automatic minimum, which a box with an aspect ratio takes from its content.
            add(s, v.rule, { 'aspect-ratio': `${rw} / ${rh}`, 'object-fit': 'cover', height: 'auto', 'max-height': 'none', 'min-height': '0', 'min-width': '0', 'align-self': 'start', 'flex-basis': 'auto' });
          }
          break;
        case 'font-off-system': {
          const t = v.text;
          // In Register II, text set in the text voice is body text and held to the body floor. A
          // font fix that exposes that is rolled back for the rule it breaks, so the floor travels
          // with the voice.
          const toBody = String(r.spec?.register ?? '').startsWith('ii') && !t?.isData && t?.role !== 'heading' && t?.sizePx != null && t.sizePx < floors.bodyMinPxRegisterII;
          add(t, v.rule, { 'font-family': stack(t?.isData ? 'data' : 'text'), ...(toBody ? { 'font-size': sizeFor(t, floors.bodyMinPxRegisterII) } : {}) });
          break;
        }
        case 'data-not-mono': add(v.text, v.rule, { 'font-family': stack('data') }); break;
      }
    }
  }
  return [...patches.values()].map((p) => ({ ...p, rules: [...p.rules].sort() }));
}
