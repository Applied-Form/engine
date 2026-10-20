/**
 * Violations to style patches. Pure: no page, no browser. Each patch names one element (by the id
 * the checker stamped) and the declarations that bring it inside the system. A violation the
 * planner cannot locate, or whose fix needs judgement, is left for the model.
 */
import { colors, spacingScale, spacingUnit, floors, fonts, aspectRatios, registers } from '../tokens.mjs';
import { passes, hexToRgb } from '../contrast.mjs';
import { onDarkColourFor } from '../rules/interaction.mjs';
import { eq } from '../rules/util.mjs';

export const FIXABLE = [
  'radius-present', 'shadow-present', 'spacing', 'focus-hidden', 'focus-restyled', 'link-not-underlined', 'target-size',
  'contrast', 'text-too-small', 'body-too-small', 'font-off-system', 'data-not-mono',
  'aspect-ratio', 'accent-non-interactive-ii', 'measure', 'horizontal-overflow', 'link-colour-ii',
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

/** The Register II palette the checker judged the page against: the dark one on a dark-theme page. */
const linkPalette = (spec) => registers[spec?.register === 'ii' && spec?.theme === 'dark' && registers['ii-dark'] ? 'ii-dark' : 'ii'];

/**
 * The same link as the extractor measured it at every width of this page, each with the spec it was
 * measured in; the link itself, in the spec of the result it came from, where no width reports it.
 */
const measuredLinks = (results, r, link) => {
  const all = results.filter((x) => x.url === r.url)
    .flatMap((x) => (x.spec?.links ?? []).filter((y) => y.afId === link.afId).map((y) => ({ link: y, spec: x.spec })));
  return all.length ? all : [{ link, spec: r.spec }];
};

/**
 * The link that holds a text run, from `links`: the innermost one whose structural selector is the
 * run's own or an ancestor of it. Null for a run in no link.
 */
const linkHolding = (t, links) => (t?.sel ? (links ?? [])
  .filter((l) => l.sel && (t.sel === l.sel || t.sel.startsWith(`${l.sel} > `)))
  .sort((a, b) => b.sel.length - a.sel.length)[0] ?? null : null);

/**
 * The text runs whose colour a link gives them, as measured in `spec`: the runs it is the innermost
 * link of, painted in its colour. The fixer's run reports `paint`, a run's colour before any opacity,
 * so a run dimmed by opacity is found too; a run reported without it is read by its colour.
 */
const runsInLinkColour = (link, spec) => {
  const links = [link, ...(spec?.links ?? []).filter((l) => l.afId !== link.afId)];
  return (spec?.text ?? []).filter((t) => linkHolding(t, links) === link && eq(t.paint ?? t.color, link.color));
};

/** `hex` painted at `alpha` over `ground`, as the extractor composites a run's colour. */
const dimmed = (hex, alpha, ground) => {
  if (alpha == null || alpha >= 1) return hex;
  const f = hexToRgb(hex), g = hexToRgb(ground);
  return `#${f.map((v, i) => Math.round(v * alpha + g[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

/**
 * The on-dark link colour for a link, or null (decision 0025). `link-colour-ii` accepts either the
 * link colour or the on-dark one on a link that paints no ground of its own on exactly ink or
 * espresso, on a page declared Register II and judged against the light palette. The fixer gives
 * the link the on-dark colour only where, at every width the link was measured at:
 *   - the link is in that case;
 *   - the checker can vouch for its ground, as `registerColour` asks for a contrast fix;
 *   - the colour clears the body floor there;
 *   - the link holds text of its own that a reader can see and that is not the wordmark (`hasText`,
 *     from the extractor). A link whose only visible content is an svg or an img, such as the
 *     outlined wordmark used as the home link, with or without a screen-reader-only label, is never
 *     recoloured: its colour paints only the image;
 *   - every text run whose colour the link gives it, not only a failing one, clears its own floor in
 *     the on-dark colour, at the run's own size and weight, on the run's own measured ground, dimmed
 *     as the run is, and on a ground the checker can vouch for. A run in a child that paints its own
 *     fill, such as a white chip inside the link, is read on that fill, where the on-dark colour does
 *     not read, so such a link keeps its colour; a run whose ground is painted where the checker
 *     cannot read it (a ::before pill, an svg rect) is not vouched for, so that link keeps its colour too.
 * The caller says which links need it: one in neither accepted colour, or one in the link colour
 * whose text fails `contrast`. `widths` is `measuredLinks` for the link.
 */
function onDarkLink(spec, widths) {
  if (spec?.register !== 'ii') return null;
  const palette = linkPalette(spec);
  const colour = onDarkColourFor(palette, widths[0].link);
  if (!colour) return null;
  const reads = (t) => !!t.background && t.groundTrusted === true && passes(dimmed(colour, t.alpha, t.background), t.background, t.sizePx ?? 16, t.weight ?? 400, floors);
  const ok = widths.every(({ link: x, spec: s }) => eq(onDarkColourFor(palette, x), colour) && x.groundTrusted === true && x.hasText === true
    && passes(colour, x.background, 16, 400, floors) && runsInLinkColour(x, s).every(reads));
  return ok ? { color: colour } : null;
}

/**
 * The Register II link colour, from the palette the checker judged the page against (the dark one on a
 * dark-theme page), or null where it would not read on the link's measured ground: a link on a dark
 * band would trade link-colour-ii for contrast, and only the ground can change there, which is the
 * model's call. The link's own colour only: the rule reads nothing inside it.
 *
 * One exception (decision 0025): a link the rule would also accept in the on-dark link colour takes
 * that colour where `onDarkLink` allows it, unless the caller turns the on-dark fix off. Every other
 * link is planned as on 5722c0a.
 */
function linkColour(link, spec, widths, onDark = true) {
  const palette = linkPalette(spec);
  const c = palette?.link;
  if (!c) return null;
  const dark = onDark ? onDarkLink(spec, widths) : null;
  if (dark) return dark;
  if (!link?.background || passes(c, link.background, 16, 400, floors)) return { color: c };
  // A link drawn as a filled button (engine10: 13 of the 18 pages that failed the rule) is white on the
  // accent, where the link colour cannot read. Without its fill it is an underlined link on the ground
  // behind it, which is what Register II asks a link to be, and there the colour reads.
  if (link.paintsGround && link.behindTrusted && link.behind && passes(c, link.behind, 16, 400, floors)) {
    return { color: c, 'background-color': 'transparent', 'background-image': 'none' };
  }
  return null;
}

/**
 * The remedies for a page wider than its viewport, least layout changed first: a long word may break,
 * a nowrap run may wrap, an image or svg is capped at its container, a box is capped at its container
 * and its automatic minimum lifted, a flex row may wrap, all of those at once, then (from engine11) the
 * outermost box reflows all the way down while a table or code block in it scrolls in its own box, and
 * last the outermost box scrolls in its own container. The extractor tries each in the page it measured and reports the
 * ones that made it fit (page-spec.mjs, for the fixer only); on engine9's 23 overflowing pipeline
 * pages one of them always did.
 */
export const OVERFLOW_LADDER = ['wrap', 'nowrap', 'media', 'shrink', 'flexwrap', 'all', 'reflow', 'scroller'];

/**
 * The descendants the reflow rung reaches inside a box it reflows: everything but tables, svg and code,
 * which keep their shape and scroll in a box of their own if still too wide (src/lib/page-spec.mjs
 * writes the same text, since it runs in the page). eval/overflow-remedies.mjs reads a kept reflow rung
 * by it.
 */
export const REFLOW_SCOPE = ':not(table, table *, svg, svg *, pre, pre *)';

/**
 * The overflow rungs the fixer may try, in ladder order: those that made the page fit at every width
 * it overflowed at, each with its patches from every such width merged, one per element. A layout
 * change is judged on the whole page, so a rung is tried whole and never split.
 */
export function planOverflow(results, { allow = FIXABLE, ladder = OVERFLOW_LADDER } = {}) {
  if (!allow.includes('horizontal-overflow')) return [];
  const overflowing = results.filter((r) => (r.violations ?? []).some((v) => v.rule === 'horizontal-overflow'));
  if (!overflowing.length || overflowing.some((r) => !Array.isArray(r.spec?.overflowRemedies))) return [];
  return ladder
    .filter((name) => overflowing.every((r) => r.spec.overflowRemedies.some((x) => x.name === name)))
    .map((name) => {
      const by = new Map();
      for (const r of overflowing) {
        for (const p of r.spec.overflowRemedies.find((x) => x.name === name).patches) {
          if (p.afId == null || !p.sel) continue;
          const old = by.get(p.afId);
          by.set(p.afId, { afId: String(p.afId), sel: p.sel, pseudo: '', decl: { ...old?.decl, ...p.decl }, rules: ['horizontal-overflow'] });
        }
      }
      return { name, patches: [...by.values()] };
    })
    .filter((r) => r.patches.length);
}

/** The nearest step of the spacing scale; beyond the largest step, the nearest multiple of the unit. */
export function snap(px) {
  const steps = [...spacingScale].sort((a, b) => a - b);
  if (px > steps[steps.length - 1]) return Math.round(px / spacingUnit) * spacingUnit;
  return steps.reduce((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best), steps[0]);
}

/**
 * The accepted value on the other side of `px` from snap(px), or null. 20px is as near 16 as 24,
 * and the near one can be the one that breaks another rule where the far one breaks none. Below the
 * first step the other side is 0, which the rule also accepts: spacing that is there goes to a step
 * first, and to nothing only when the step is refused, and only below half the first step. From
 * there up a value is spacing an author chose, and 0 would remove it rather than correct it.
 */
export function snapOther(px) {
  const near = snap(px);
  const steps = [0, ...spacingScale].sort((a, b) => a - b);
  const pool = px > steps[steps.length - 1] ? [near - spacingUnit, near + spacingUnit] : steps;
  if (near < px) return pool.find((s) => s > px) ?? null;
  if (near > px) {
    const other = [...pool].reverse().find((s) => s < px) ?? null;
    return other === 0 && px >= steps[1] / 2 ? null : other;
  }
  return null;
}

/** A raised font size may break a long word (an address, a URL) rather than widen the box it sits in. */
const wrapping = (decl) => ({ ...decl, 'overflow-wrap': 'anywhere' });

/**
 * A patch may carry `alt`: the declarations the fixer tries instead when the patch on its own makes
 * a rule worse. Only remedies with a second answer that keeps the rule have one. Every second answer
 * changes layout (a far spacing step, a word allowed to break), so `secondAnswers: false` plans none.
 *
 * `onDark: false` plans no on-dark link colour (decision 0025), for `contrast` or for
 * `link-colour-ii`, so every link is planned as on 5722c0a. Only a diagnosis that replays the fixer
 * engine10 ran asks for it (eval/link-diag.mjs).
 */
export function planFixes(results, { allow = FIXABLE, secondAnswers = false, onDark = true } = {}) {
  const allowed = new Set(allow.filter((r) => FIXABLE.includes(r)));
  const patches = new Map();
  // A run drawn by ::before or ::after carries its host's id and names its pseudo-element.
  const add = (item, rule, decl, { pseudo = item?.pseudo ?? '', subtree = false, alt = null } = {}) => {
    const afId = item?.afId;
    if (afId == null || afId === '') return;
    // One patch per element, pseudo-element or -class, and rule: rolling back one rule never takes another's fix.
    const key = `${afId}|${pseudo}|${rule}`;
    const p = patches.get(key) ?? { afId: String(afId), sel: item.sel, pseudo, decl: {}, rules: new Set(), ...(subtree ? { subtree } : {}) };
    merge(p.decl, decl);
    if (alt && secondAnswers) merge(p.alt ??= {}, alt);
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
            const sign = Math.sign(s.raw) < 0 ? '-' : '', other = snapOther(s.value);
            add(s, v.rule, { [kebab(s.prop)]: `${sign}${snap(s.value)}px` }, { alt: other == null ? null : { [kebab(s.prop)]: `${sign}${other}px` } });
          }
          break;
        case 'contrast': {
          const t = v.text;
          if (t?.afId == null) break;
          // A run painted in the link colour, inside a link in the link colour that `link-colour-ii`
          // also accepts in the on-dark colour (decision 0025): the link takes the on-dark colour,
          // which the run inherits. Planned for this rule, on the link, where `onDarkLink` allows it:
          // only when every run the link colours reads in the new colour, not only this one.
          const link = onDark && t.isInteractive ? linkHolding(t, r.spec?.links) : null;
          const lp = linkPalette(r.spec);
          if (link && lp?.link && eq(link.color, lp.link) && eq(t.color, link.color)) {
            const decl = onDarkLink(r.spec, measuredLinks(results, r, link));
            if (decl) { add(link, v.rule, decl); break; }
          }
          const measured = results.filter((x) => x.url === r.url).flatMap((x) => (x.spec?.text ?? []).filter((y) => y.afId === t.afId));
          const c = v.suggestion ?? registerColour(t, r.spec, measured.length ? measured : [t]);
          if (!c) break;
          // SVG paints text with fill, and an element's own opacity dims whatever colour it is given.
          add(t, v.rule, { color: c, ...(t.isSvgText ? { fill: c } : {}), ...(t.opacitySelf < 1 ? { opacity: '1' } : {}) });
          break;
        }
        case 'text-too-small': case 'body-too-small': {
          const decl = { 'font-size': sizeFor(v.text, v.rule === 'text-too-small' ? floors.textMinPx : floors.bodyMinPxRegisterII) };
          // SVG text never wraps, so a refused label has no second answer.
          add(v.text, v.rule, decl, { alt: v.text?.isSvgText ? null : wrapping(decl) });
          break;
        }
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
        case 'link-colour-ii': {
          const decl = v.link?.afId == null ? null : linkColour(v.link, r.spec, measuredLinks(results, r, v.link), onDark);
          if (decl) add(v.link, v.rule, decl);
          break;
        }
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
          const decl = { 'font-family': stack(t?.isData ? 'data' : 'text'), ...(toBody ? { 'font-size': sizeFor(t, floors.bodyMinPxRegisterII) } : {}) };
          add(t, v.rule, decl, { alt: toBody ? wrapping(decl) : null });
          break;
        }
        case 'data-not-mono': add(v.text, v.rule, { 'font-family': stack('data') }); break;
      }
    }
  }
  return [...patches.values()].map((p) => ({ ...p, rules: [...p.rules].sort(), ...(p.alt ? { alt: { ...p.decl, ...p.alt } } : {}) }));
}
