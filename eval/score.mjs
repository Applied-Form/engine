/**
 * Scoring one generated page.
 *
 * Three instruments, deliberately of different provenance:
 *
 *   1. Our linter, restricted to the withheld rules (see split.mjs). Primary metric.
 *   2. axe-core, which we did not write and cannot tune. Independent accessibility check.
 *   3. Token adherence — CIE Lab distance from the nearest palette colour, and deviation of spacing
 *      values from the 8px scale — computed from the page's own computed styles. This measures
 *      drift rather than pass/fail, so a page that is nearly right is distinguishable from one that
 *      is nowhere near, which a binary rule cannot show.
 *
 * Two fairness corrections matter more than any of the metrics:
 *
 *   Normalisation. Arms that were never told about `data-register` are not penalised for omitting
 *   it; the register declared in the brief is injected before linting, and the injection recorded.
 *   Otherwise we would be measuring knowledge of our attribute names, not conformance.
 *
 *   Opportunity. A violation count alone rewards a page for being empty: no links means no link
 *   violations. Every rate is therefore reported per unit of opportunity — per link, per image, per
 *   focusable target — and a page with no opportunity for a rule is excluded from that rule's rate
 *   rather than counted as passing it.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lintPages, launchBrowser } from '../src/lib/page-lint.mjs';
import { partition } from './split.mjs';

const AXE = new URL('../node_modules/axe-core/axe.min.js', import.meta.url);

/** Which measurable thing each universal rule can go wrong on. Used as the rate denominator. */
export const OPPORTUNITY = {
  'aspect-ratio': 'imagery', 'horizontal-overflow': 'page',
  'focus-hidden': 'focusable', 'link-not-underlined': 'links',
  'target-size': 'targets', 'alt-missing': 'imagery',
  // Per focusable target: a page with one control has one chance to hide it, and a page with
  // twenty has twenty. Counted per page it would reward a page for containing nothing.
  'hidden-interactive': 'focusable',
  'shadow-present': 'elements', 'gradient-fill': 'elements', 'radius-present': 'elements',
};

/** Make a page lintable without giving any arm credit for knowing our attribute names. */
export function normalise(html, register) {
  if (/data-register\s*=/.test(html)) return { html, injected: false };
  const patched = html.replace(/<body([^>]*)>/i, `<body$1 data-register="${register}">`);
  return { html: patched === html ? html : patched, injected: patched !== html };
}

/**
 * Perceptual colour distance lives in `src/lib/lab.mjs` and is re-exported here so the harness's
 * public surface does not change. It used to be a private copy in this file, which meant a
 * product feature could not use it: `eval/` is dev-only and nothing in `src/` may import from it.
 * `af drift` needed exactly this arithmetic, so it moved to where both halves can reach it.
 */
import { paletteDistance } from '../src/lib/lab.mjs';
export { paletteDistance };
// Not `export { x } from`: a re-export forwards the binding to importers and leaves this module's
// own scope without it, so `score()` below threw `paletteDistance is not defined` on every cell
// from 3.1.0 until the stub dry run was next executed. `test/harness.test.mjs` now runs that path.

/** How far a set of pixel values sits off the 8px scale, as a mean absolute remainder in px. */
export function spacingDrift(values, step = 8) {
  const used = values.map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (!used.length) return null;
  const off = used.map((v) => Math.min(v % step, step - (v % step)));
  return off.reduce((a, b) => a + b, 0) / off.length;
}

/** axe-core, injected into the rendered page. Third-party, so it cannot be tuned in our favour. */
export async function axeScan(url, browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.addScriptTag({ path: fileURLToPath(AXE) });
    const result = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    });
    return {
      violations: result,
      count: result.reduce((s, v) => s + v.nodes, 0),
      serious: result.filter((v) => v.impact === 'serious' || v.impact === 'critical').reduce((s, v) => s + v.nodes, 0),
    };
  } finally { await page.close(); }
}

/** Every colour and spacing value the rendered page actually uses, for the drift measures. */
export async function computedUsage(url, browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'load' });
    return await page.evaluate(() => {
      const colours = new Set(), spacing = [];
      const hex = (c) => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
        if (!m || (m[4] !== undefined && Number(m[4]) < 0.95)) return null;
        return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
      };
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
          const h = hex(s[prop]);
          if (h) colours.add(h);
        }
        for (const prop of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'gap', 'rowGap', 'columnGap']) {
          const v = parseFloat(s[prop]);
          if (Number.isFinite(v) && v > 0) spacing.push(v);
        }
      }
      // How much design happened at all. An unstyled page scores almost perfectly on the nine
      // rules — default link underlines, no shadows, no radius, visible focus — so the rate alone
      // cannot tell "well designed" from "not designed". This sits beside it.
      let declarations = 0;
      for (const sheet of document.styleSheets) {
        try { for (const rule of sheet.cssRules) declarations += rule.style ? rule.style.length : 0; } catch { /* cross-origin */ }
      }
      const fonts = new Set();
      for (const el of document.querySelectorAll('body, body *')) fonts.add(getComputedStyle(el).fontFamily);
      return { colours: [...colours], spacing, elements: document.querySelectorAll('*').length, styling: { declarations, fonts: fonts.size } };
    });
  } finally { await page.close(); }
}

/**
 * Score one page. `url` must be a file:// or http URL of the already-normalised page.
 * `palette` is the list of hex colours the study's brand allows.
 */
/**
 * Two viewports, not one. A three-card row that fits a desktop overflows every phone, and scored at
 * 1280 alone it passes clean — measured, not supposed. Violations and opportunities are summed
 * across the viewports tested: an element present at two widths is two chances to break a rule.
 */
export const SCORE_VIEWPORTS = [320, 1280];

export async function score(url, { register, palette, browser: given = null, viewports = SCORE_VIEWPORTS } = {}) {
  const browser = given ?? await launchBrowser();
  try {
    const lints = await lintPages([url], { viewports, browser });
    const usage = await computedUsage(url, browser);
    const axe = await axeScan(url, browser);

    const universal = [], gated = [], disclosed = [];
    const opportunity = { page: 0, links: 0, imagery: 0, targets: 0, focusable: 0, spacing: usage.spacing.length, elements: 0 };
    for (const lint of lints) {
      const parts = partition(lint.violations);
      universal.push(...parts.universal); gated.push(...parts.gated); disclosed.push(...parts.disclosed);
      const spec = lint.spec;
      opportunity.page += 1;
      opportunity.links += spec.links?.length ?? 0;
      opportunity.imagery += spec.imagery?.length ?? 0;
      opportunity.targets += spec.targets?.length ?? 0;
      opportunity.focusable += spec.focusStyles?.length ?? 0;
      opportunity.elements += usage.elements;
    }

    // Per-rule counts. A rule the page gave no chance to break is absent, not zero: a page with no
    // links earns nothing on the link rules rather than a perfect score on them.
    const perRule = {};
    for (const [rule, kind] of Object.entries(OPPORTUNITY)) {
      const o = opportunity[kind] ?? 0;
      if (o === 0) continue;
      perRule[rule] = { v: universal.filter((x) => x.rule === rule).length, o };
    }
    const rates = Object.fromEntries(Object.entries(perRule).map(([r, { v, o }]) => [r, v / o]));

    const distances = usage.colours.map((c) => paletteDistance(c, palette)).filter((d) => d !== null);
    return {
      url, register, viewports,
      universal: universal.length,
      gated: gated.length,
      disclosed: disclosed.length,
      rules: { universal: universal.map((v) => v.rule), gated: gated.map((v) => v.rule) },
      opportunity, perRule, rates,
      styling: usage.styling,
      axe: { count: axe.count, serious: axe.serious, ids: axe.violations.map((v) => v.id) },
      drift: {
        palette: distances.length ? distances.reduce((a, b) => a + b, 0) / distances.length : null,
        paletteMax: distances.length ? Math.max(...distances) : null,
        spacing: spacingDrift(usage.spacing),
      },
      // Named `computed`, not `usage`: the run record carries the model's token usage under that name,
      // and a spread of this result over it erased the cost measure from every row.
      computed: { colours: usage.colours.length, elements: usage.elements },
    };
  } finally { if (!given) await browser.close(); }
}

export function paletteFrom(tokenFile) {
  const t = JSON.parse(readFileSync(tokenFile, 'utf8'));
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    // DTCG 2025.10 writes a colour as an object with its hex beside the components; the older form
    // was the hex string. Reading only the string form returned an empty palette for the study's
    // own token file, and every page's palette drift came back null.
    const v = node.$value;
    const hex = typeof v === 'string' ? v : v?.hex;
    if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) out.push(hex.toUpperCase());
    for (const v of Object.values(node)) walk(v);
  };
  walk(t.color ?? t);
  return [...new Set(out)];
}

export { pathToFileURL };
