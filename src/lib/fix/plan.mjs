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

/** A font size that renders at `floor` px: text drawn smaller than its own size (a scaled SVG chart) is scaled up to match. */
const sizeFor = (t, floor) => `${t?.cssPx && t?.sizePx ? Math.ceil((floor * t.cssPx / t.sizePx) * 100) / 100 : floor}px`;

/** The permitted ratio nearest to w:h, compared on a log scale so 2:1 and 1:2 are equally far from 1:1. */
const nearestRatio = (w, h) => aspectRatios.map((r) => r.split(':').map(Number))
  .reduce((best, r) => (Math.abs(Math.log((r[0] / r[1]) / (w / h))) < Math.abs(Math.log((best[0] / best[1]) / (w / h))) ? r : best));

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
  const add = (item, rule, decl, pseudo = '') => {
    const afId = item?.afId;
    if (afId == null || afId === '') return;
    // One patch per element, pseudo-class and rule: rolling back one rule never takes another's fix.
    const key = `${afId}|${pseudo}|${rule}`;
    const p = patches.get(key) ?? { afId: String(afId), sel: item.sel, pseudo, decl: {}, rules: new Set() };
    Object.assign(p.decl, decl);
    p.rules.add(rule);
    patches.set(key, p);
  };
  for (const r of results) {
    for (const v of r.violations ?? []) {
      if (!allowed.has(v.rule)) continue;
      switch (v.rule) {
        case 'radius-present': add(v.absence, v.rule, { 'border-radius': '0' }); break;
        case 'shadow-present': add(v.absence, v.rule, { 'box-shadow': 'none' }); break;
        case 'link-not-underlined': add(v.link, v.rule, { 'text-decoration-line': 'underline' }); break;
        case 'target-size':
          add(v.target, v.rule, { 'min-width': '24px', 'min-height': '24px', ...(v.target?.display === 'inline' ? { display: 'inline-block' } : {}) });
          break;
        // Deliberately two cases, not one shared one: `outline: none` reports both rules on the same
        // focus style, and one of them is held out, so a single case lets a disclosed fix clear a
        // scored rule. Keep them separate even though the declaration is identical.
        case 'focus-hidden':
          add(v.focus, v.rule, { outline: `3px solid ${colors.focus}`, 'outline-offset': '2px' }, ':focus-visible');
          break;
        case 'focus-restyled':
          add(v.focus, v.rule, { outline: `3px solid ${colors.focus}`, 'outline-offset': '2px' }, ':focus-visible');
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
        case 'accent-non-interactive-ii': add(v.text, v.rule, { color: registers.ii.text }); break;
        case 'aspect-ratio':
          for (const s of (r.spec?.ratioSources ?? []).filter((x) => x.value === v.value)) {
            const [rw, rh] = nearestRatio(s.w, s.h);
            add(s, v.rule, { 'aspect-ratio': `${rw} / ${rh}`, 'object-fit': 'cover', height: 'auto' });
          }
          break;
        case 'font-off-system': add(v.text, v.rule, { 'font-family': stack(v.text?.isData ? 'data' : 'text') }); break;
        case 'data-not-mono': add(v.text, v.rule, { 'font-family': stack('data') }); break;
      }
    }
  }
  return [...patches.values()].map((p) => ({ ...p, rules: [...p.rules].sort() }));
}
