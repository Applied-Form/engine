/**
 * The deterministic fixer, reached without the evaluation harness: one page in, the fixed page and an
 * account of it out. `af fix` and the `af_fix` tool both come through here. No model is called.
 *
 * The settings are the pipeline arm's (`pipelineOptions('pipeline')` in eval/arms.mjs): every fixable
 * rule, judged on every rule, with second answers. The never-worse rule is autoFix's own: a fix that
 * makes any checked rule worse at any width measured is not shipped, and is reported as refused.
 */
import { autoFix } from './index.mjs';
import { FIXABLE } from './plan.mjs';
import { RULES } from '../rules/registry.mjs';

export const PRODUCT_SETTINGS = Object.freeze({ allow: FIXABLE, judge: () => true, secondAnswers: true });

export const NOT_CHECKED = Object.freeze({
  doc: 'docs/accessibility-scope.md',
  note: 'A pass covers the rules this engine measures and nothing else. It is not a WCAG conformance claim and does not replace an accessibility audit. What is not tested is listed in docs/accessibility-scope.md.',
});

/** The structural selectors of the elements a violation is about, or none when it is about the page. */
export function selectorsOf(v, spec = {}) {
  if (v.rule === 'measure' && v.text?.block?.sel) return [v.text.block.sel];
  if (v.rule === 'spacing') return [...new Set((spec.spacingSources ?? []).filter((s) => s.value === v.value && s.sel).map((s) => s.sel))];
  if (v.rule === 'aspect-ratio') return [...new Set((spec.ratioSources ?? []).filter((s) => s.value === v.value && s.sel).map((s) => s.sel))];
  for (const k of ['text', 'link', 'target', 'focus', 'absence', 'imagery', 'heading', 'status']) if (v[k]?.sel) return [v[k].sel];
  for (const value of Object.values(v)) if (value && typeof value === 'object' && typeof value.sel === 'string') return [value.sel];
  return [];
}

const tallyRules = (results) => {
  const c = {};
  for (const r of results) for (const v of r.violations) c[v.rule] = (c[v.rule] ?? 0) + 1;
  return c;
};
const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);
const sorted = (c) => Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));

/**
 * The account of one autoFix run. Pure: it reads the run's results and nothing else.
 *
 * `remaining` holds one entry per rule and element, with the widths it failed at, so a violation
 * measured at six widths is read once rather than six times.
 */
export function fixReport(out, { widths = [] } = {}) {
  const before = tallyRules(out.initial ?? []);
  const after = tallyRules(out.results ?? []);
  const fixOf = Object.fromEntries(RULES.map((r) => [r.id, r.fix]));
  const remaining = new Map();
  for (const r of out.results ?? []) {
    for (const v of r.violations) {
      const selectors = selectorsOf(v, r.spec);
      const key = `${v.rule}|${selectors.length ? selectors.join(',') : v.message}`;
      const entry = remaining.get(key) ?? { rule: v.rule, selectors, message: v.message, fix: fixOf[v.rule] ?? null, sample: v.text?.sample ?? v.link?.sample ?? v.target?.sample ?? null, widths: [] };
      if (!entry.widths.includes(r.viewport)) entry.widths.push(r.viewport);
      remaining.set(key, entry);
    }
  }
  const first = (out.results ?? [])[0]?.spec ?? {};
  const shape = (p) => ({ selector: p.sel ?? null, pseudo: p.pseudo || null, rules: p.rules, declarations: p.decl });
  return {
    passed: sum(after) === 0,
    widths,
    register: first.register ?? null,
    assumedRegister: first.assumedRegister ?? false,
    // With no system loaded and no register given, a page that declares none is held to the rules
    // that apply to any page, as `af lint` holds it.
    scope: (out.results ?? []).some((r) => r.scope === 'universal') ? 'universal' : 'system',
    before: { violations: sum(before), rules: sorted(before) },
    after: { violations: sum(after), rules: sorted(after) },
    fixed: Object.keys(before).filter((r) => !after[r]).sort(),
    applied: (out.applied ?? []).map(shape),
    refused: (out.refused ?? []).map((p) => ({ ...shape(p), reason: p.reason })),
    remaining: [...remaining.values()].sort((a, b) => a.rule.localeCompare(b.rule)),
    notChecked: { ...NOT_CHECKED },
  };
}

/**
 * Render a page as if it sat at `href`, so its relative stylesheets, fonts and images load while the
 * checker works on a copy elsewhere. The tag is removed from the result, so the fixed page carries the
 * author's markup and the fix block, and nothing else.
 */
export function withBase(html, href) {
  if (!href || /<base[\s>]/i.test(html)) return { html, strip: (h) => h };
  const tag = `<base href="${String(href).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-af-base>`;
  const opener = html.match(/<head(\s[^>]*)?>/i) ?? html.match(/<html(\s[^>]*)?>/i) ?? html.match(/<!doctype[^>]*>/i);
  const at = opener ? opener.index + opener[0].length : 0;
  return { html: `${html.slice(0, at)}${tag}${html.slice(at)}`, strip: (h) => h.replace(tag, '') };
}

/**
 * Fix one page with the product settings. `fileRoots` are what the rendered page may read besides its
 * own directory; a page the caller did not write gets the engine's files alone. `network: false`
 * renders it offline, `onFailed` hears every request it made that did not load, and `realpaths`
 * checks the file a link leads to (see lintPages and confine in page-lint.mjs).
 */
export async function fixPage(html, { browser, register = null, viewports, fileRoots, unregistered = 'house', baseHref = null, network = true, onFailed = null, realpaths = false } = {}) {
  const based = withBase(html, baseHref);
  const out = await autoFix(based.html, { browser, ...PRODUCT_SETTINGS, register, viewports, unregistered, network, onFailed, realpaths, ...(fileRoots ? { fileRoots } : {}) });
  // The lint results before and after go back too, with the fixer's CSS, for a caller that accounts
  // for each violation (`af audit`, which renders the page at its own address with `css` added);
  // `report` is the summary `af fix` prints.
  return { html: based.strip(out.html), css: out.css, report: fixReport(out, { widths: viewports ?? [] }), initial: out.initial, results: out.results };
}
