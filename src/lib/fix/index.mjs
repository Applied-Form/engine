/**
 * Lint, plan, apply, re-check. A pass whose fixes make any rule worse is retried one rule group at a
 * time, keeping only the groups that do not; a group that does is split until the patches at fault
 * are isolated, so the rest of it is kept, and a patch at fault is tried once more with its remedy's
 * second answer where it has one. A page still wider than its viewport is then offered the overflow
 * ladder, one whole rung at a time. What cannot be fixed is left for the model.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintPages, DEFAULT_FILE_ROOTS } from '../page-lint.mjs';
import { planFixes, planOverflow, FIXABLE, OVERFLOW_LADDER } from './plan.mjs';
import { cssOf, withFixes } from './apply.mjs';

/** Violations per rule, counting only the rules `judge` admits. A blind run must not judge its fixes on rules it may not see. */
const tally = (results, judge) => {
  const c = {};
  for (const r of results) for (const v of r.violations) if (judge(v.rule)) c[v.rule] = (c[v.rule] ?? 0) + 1;
  return c;
};
const worse = (before, after) => Object.keys(after).some((k) => after[k] > (before[k] ?? 0));
const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

/** One patch's identity across passes: the element by its structural selector, the state, the rules. */
const keyOf = (p) => `${p.sel ?? p.afId}|${p.pseudo}|${p.rules.join(',')}`;

/**
 * `fileRoots` are the directories the rendered page may read besides its own: the working directory
 * and the engine's files unless the caller says otherwise. A caller rendering a page it did not write
 * (the MCP server) passes the engine's files alone, as it does for `af_lint`. `unregistered`,
 * `network`, `onFailed` and `realpaths` are handed to the linter unchanged, and `onDark` to the
 * planner (`planFixes`).
 */
export async function autoFix(html, { browser, allow = FIXABLE, judge = () => true, secondAnswers = false, onDark = true, register = null, viewports, workDir, maxPasses = 2, salvageTrials = 24, overflowTrials = 8, trace = null, ladder = OVERFLOW_LADDER, fileRoots = DEFAULT_FILE_ROOTS(), unregistered = 'house', network = true, onFailed = null, realpaths = false } = {}) {
  const counts = (results) => tally(results, judge);
  const own = !workDir;
  const dir = workDir ?? mkdtempSync(join(tmpdir(), 'af-fix-'));
  const file = join(dir, `.af-fix-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const url = pathToFileURL(file).href;
  const lintAt = (h) => { writeFileSync(file, h); return lintPages([url], { browser, viewports, register, withIds: true, fileRoots: [dir, ...fileRoots], unregistered, network, onFailed, realpaths }); };
  let cssRules = [];
  const applied = [];
  // Every patch planned and not shipped, with why: the account a person reads beside the fixed page.
  const refused = new Map();
  let current = withFixes(html, '');
  let results = await lintAt(current);
  const initial = results;
  const before = total(tally(results, () => true));
  const tryCss = (extra) => withFixes(html, [...cssRules, ...extra.map((p) => p.css)].join('\n'));
  const withCss = (patches) => { const rules = cssOf(patches); return patches.map((p, i) => ({ ...p, css: rules[i] })).filter((p) => p.css); };
  try {
    for (let pass = 0; pass < maxPasses; pass++) {
      const patches = planFixes(results, { allow, secondAnswers, onDark });
      if (!patches.length) break;
      const rules = cssOf(patches);
      patches.forEach((p, i) => { if (!rules[i]) refused.set(keyOf(p), { ...p, reason: 'the checker gave no selector for the element' }); });
      const usable = patches.map((p, i) => ({ ...p, css: rules[i], ...(p.alt ? { altCss: cssOf([{ ...p, decl: p.alt }])[0] } : {}) })).filter((p) => p.css);
      if (!usable.length) break;
      let candidate = tryCss(usable);
      let next = await lintAt(candidate);
      let kept = usable;
      if (worse(counts(results), counts(next))) {
        kept = [];
        // A group that makes some rule worse is split in halves until the patches at fault are
        // isolated, so one bad patch no longer takes its whole rule's fixes with it: on engine7
        // one centred block's margin, snapped to a width that overflowed at 320, cost every
        // spacing fix on its page. Bounded, since every trial is a lint of the page.
        let trials = 0;
        // A patch that makes a rule worse on its own is tried once more with its remedy's second
        // answer, where it has one: the far spacing step, or a raised size that may break a long word.
        const fallback = async (base, p) => {
          if (!p?.altCss || trials >= salvageTrials) return [];
          trials += 1;
          const q = { ...p, decl: p.alt, css: p.altCss };
          return worse(counts(results), counts(await lintAt(tryCss([...base, q])))) ? [] : [q];
        };
        const salvage = async (base, group) => {
          if (group.length < 2) return fallback(base, group[0]);
          const mid = Math.ceil(group.length / 2);
          let keep = [];
          for (const half of [group.slice(0, mid), group.slice(mid)]) {
            if (trials >= salvageTrials) break;
            trials += 1;
            const trial = await lintAt(tryCss([...base, ...keep, ...half]));
            keep = keep.concat(!worse(counts(results), counts(trial)) ? half : await salvage([...base, ...keep], half));
          }
          return keep;
        };
        for (const rule of FIXABLE) {
          const group = usable.filter((p) => p.rules.includes(rule) && !kept.includes(p));
          if (!group.length) continue;
          const trial = await lintAt(tryCss([...kept, ...group]));
          kept.push(...(!worse(counts(results), counts(trial)) ? group : await salvage(kept, group)));
        }
        candidate = tryCss(kept);
        next = await lintAt(candidate);
      }
      const keptKeys = new Set(kept.map(keyOf));
      for (const p of usable) if (!keptKeys.has(keyOf(p))) refused.set(keyOf(p), { ...p, reason: 'it made a checked rule worse' });
      if (!kept.length || total(counts(next)) >= total(counts(results))) {
        for (const p of kept) refused.set(keyOf(p), { ...p, reason: 'together they did not lower the violation count' });
        break;
      }
      cssRules = [...cssRules, ...kept.map((p) => p.css)];
      applied.push(...kept.map(({ afId, sel, pseudo, decl, rules }) => ({ afId, sel, pseudo, decl, rules })));
      current = candidate;
      results = next;
    }
    // A page still wider than its viewport. Each rung the extractor found to make it fit is tried
    // whole, in ladder order, and the first that leaves no rule worse and the page with fewer
    // violations is kept. A rung that narrows a chart can take its labels under the text floor
    // (engine9 mini b08-s0, b35-s0): such a rung is tried once more with one pass of the fixer's own
    // remedies on the page as the rung left it, and judged with them.
    // `trace`, when given, receives each rung tried and what became of it, for diagnosis
    // (eval/scroller-diag.mjs): kept, refused as worse (with the rules it worsened), or no gain.
    // `worse` is what the rung alone made worse, before any refix.
    const rose = (after) => Object.fromEntries(Object.entries(after).filter(([k, n]) => n > (counts(results)[k] ?? 0)).map(([k, n]) => [k, n - (counts(results)[k] ?? 0)]));
    const note = (rung, outcome, alone, refixed = false) => trace?.push({ rung, outcome, worse: alone ? rose(alone) : {}, refixed });
    let tries = 0;
    for (const rung of planOverflow(results, { allow, ladder })) {
      if (tries >= overflowTrials) break;
      const patches = withCss(rung.patches);
      if (!patches.length) continue;
      tries += 1;
      let keep = patches;
      let candidate = tryCss(keep);
      let next = await lintAt(candidate);
      const alone = counts(next);
      if (worse(counts(results), alone)) {
        const refix = withCss(planFixes(next, { allow: allow.filter((r) => r !== 'horizontal-overflow'), secondAnswers, onDark }));
        if (!refix.length || tries >= overflowTrials) { note(rung.name, 'worse', alone); continue; }
        tries += 1;
        keep = [...patches, ...refix];
        candidate = tryCss(keep);
        next = await lintAt(candidate);
        if (worse(counts(results), counts(next))) { note(rung.name, 'worse', alone, true); continue; }
      }
      if (total(counts(next)) >= total(counts(results))) { note(rung.name, 'no-gain', alone, keep !== patches); continue; }
      note(rung.name, 'kept', alone, keep !== patches);
      cssRules = [...cssRules, ...keep.map((p) => p.css)];
      applied.push(...keep.map(({ afId, sel, pseudo, decl, rules }) => ({ afId, sel, pseudo, decl, rules })));
      current = candidate;
      results = next;
      break;
    }
  } finally {
    rmSync(file, { force: true });
    if (own) rmSync(dir, { recursive: true, force: true });
  }
  const shipped = new Set(applied.map(keyOf));
  const notShipped = [...refused].filter(([k]) => !shipped.has(k)).map(([, { afId, sel, pseudo, decl, rules, reason }]) => ({ afId, sel, pseudo, decl, rules, reason }));
  return { html: current, css: cssRules.join('\n'), applied, refused: notShipped, initial, results, stats: { before, after: total(tally(results, () => true)) }, file: basename(file) };
}
