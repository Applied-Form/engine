/**
 * Generate, fix, repair once, fix, gate. The gate never passes a page that fails a checked rule: a
 * page it cannot pass is returned with the rules it still fails and what it cost.
 *
 * The repair asks for an edit list rather than a corrected page. Output tokens are what the cost of
 * a page is mostly made of, and regenerating every line to change a few is what put the pipeline at
 * roughly twice the cost of simply reading the rules. A model that needs different markup rather
 * than different styling returns the page instead, and that fallback is counted rather than hidden.
 */
import { autoFix } from './fix/index.mjs';
import { FIXABLE } from './fix/plan.mjs';
import { parsePatches, patchCss, selectorsFrom } from './fix/patch.mjs';
import { withPatches } from './fix/apply.mjs';

/** Violations per judged rule, for deciding whether a repair left the page worse than it found it. */
function countsOf(fixed, judge) {
  const c = {};
  for (const r of fixed.results) for (const v of r.violations) if (judge(v.rule)) c[v.rule] = (c[v.rule] ?? 0) + 1;
  return c;
}
const worseThan = (before, after, judge) => {
  if (!before) return false;
  const a = countsOf(before, judge), b = countsOf(after, judge);
  return Object.keys(b).some((k) => b[k] > (a[k] ?? 0));
};

/** The element a violation is about, preferring the block for a rule measured on one. */
const idOf = (v) =>
  (v.rule === 'measure' ? v.text?.block?.afId : null) ??
  v.text?.afId ?? v.link?.afId ?? v.target?.afId ?? v.focus?.afId ?? v.absence?.afId ?? v.imagery?.afId ?? null;

/**
 * Rules a patch cannot fix, because their remedy is markup or layout rather than a declaration on
 * an element that already exists: a narrow viewport needs the layout restructured, a plot needs
 * geometry drawn, a figure needs an attribute its generator writes.
 *
 * Leaving this to the model's judgement did not work. `horizontal-overflow` is not in FIXABLE, so
 * the deterministic fixer never touched it and only a whole-page rewrite ever cured it. On
 * gpt-5-mini it failed 20/72 pipeline pages under whole-page repair (engine2) against 55/72 in the
 * blind arm, which is never told about it; once the repair returned edit lists the pipeline arm
 * moved to 49/72 and 48/72 (engine3, engine4) — level with blind, i.e. cured by nothing.
 *
 * From engine10 the fixer has a remedy for it (the overflow ladder, src/lib/fix/plan.mjs), so an
 * overflow reaches the repair only when no rung cleared it without making another rule worse, and
 * that is an overflow a declaration could not fix: it stays here.
 */
export const PAGE_ONLY = new Set([
  'horizontal-overflow', 'print-overflow', 'content-not-dom',
  'decorative-imagery', 'figure-hand-drawn', 'mark-not-svg', 'recipe-mismatch',
]);

export function repairPrompt(violations, brief = null) {
  const lines = [...new Set(violations.map((v) => {
    const id = idOf(v);
    return `- ${v.rule}${id ? ` [#${id}]` : ''}: ${v.message}${v.text?.sample ? ` ("${v.text.sample}")` : ''}`;
  }))];
  const needsPage = violations.some((v) => PAGE_ONLY.has(v.rule));
  const head = needsPage
    ? [
      'The page still fails these checks. At least one of them needs different markup, so an edit',
      'list cannot fix it: return the complete corrected page and nothing else.',
    ]
    : [
      'The page still fails these checks. Return ONLY a JSON array of edits — no prose, no page — in this shape:',
      '',
      '[{"id":"12","css":{"max-width":"72ch"}}]',
      '',
      'Each `id` is the number in brackets below, and `css` is the declarations to apply to that element. Add `"pseudo": ":focus-visible"` to style a state.',
      'Styling only. If a check needs different markup — an attribute, an element, different content — return the complete corrected page instead of the array.',
    ];
  return [
    ...head,
    ...(brief ? ['', `The page is for this brief, which still has to be served: ${brief}`] : []),
    '',
    ...lines,
  ].join('\n');
}

export async function generateConformant({ prompt, brief = null, generate, toHtml, browser, allow = FIXABLE, judge = () => true, secondAnswers = false, visible = (vs) => vs, register = null, viewports, workDir, maxRepairs = 1, costOf = () => 0, ceiling = Infinity }) {
  const messages = [{ role: 'user', content: prompt }];
  const usage = { input: 0, output: 0 };
  let fixes = [], rounds = 0, out, fixed, html = null, draft = null, repairKind = null, patchStats = null;
  for (;;) {
    out = await generate(messages);
    usage.input += out.usage.input; usage.output += out.usage.output;
    if (rounds === 0) {
      html = toHtml(out.text);
      draft = html;
    } else {
      const patches = parsePatches(out.text);
      if (patches) {
        const { css, applied, unknown } = patchCss(patches, selectorsFrom(fixed.results));
        repairKind = 'patch';
        patchStats = { asked: patches.length, applied: applied.length, unknown: unknown.length };
        html = withPatches(fixed.html, css);
      } else {
        repairKind = 'page';
        html = toHtml(out.text);
      }
    }
    const next = await autoFix(html, { browser, allow, judge, secondAnswers, register, viewports, workDir });
    // The model's patches get the same discipline as the fixer's own: a repair that makes any rule
    // worse is not shipped.
    //
    // This guard was first justified by overflow failures concentrating on patch-repaired pages.
    // That was base-rate confounded — 81% of pages were patch-repaired, so most failures of any
    // kind landed on one. Measured: the guard fires on 20.3% of computed patches and overflow
    // moved 49/72 → 48/72, i.e. not at all. It is kept because it is correct in itself (a repair
    // that worsens a rule should not ship, and `contrast` did fall 21 → 9), not because it fixes
    // overflow. PAGE_ONLY above is what addresses that.
    if (repairKind === 'patch' && worseThan(fixed, next, judge)) {
      repairKind = 'patch-rejected';
    } else {
      fixed = next;
    }
    // Only the shipped round's fixes count: a repair replaces the page an earlier round fixed.
    fixes = fixed.applied.map((a) => ({ round: rounds, ...a }));
    const remaining = visible(fixed.results.flatMap((r) => r.violations));
    if (!remaining.length || rounds >= maxRepairs || costOf(usage) >= ceiling) break;
    messages.push({ role: 'assistant', content: out.text }, { role: 'user', content: repairPrompt(remaining, brief) });
    rounds += 1;
  }
  const failing = [...new Set(fixed.results.flatMap((r) => r.violations.map((v) => v.rule)))].sort();
  return { html: fixed.html, draft, text: out.text, stop: out.stop, usage, rounds, fixes, fixStats: fixed.stats, repairKind, patchStats, gate: { passed: failing.length === 0, failing } };
}
