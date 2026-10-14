/**
 * Lint, plan, apply, re-check. A pass whose fixes make any rule worse is retried one rule group at a
 * time, keeping only the groups that do not; a group that does is split until the patches at fault
 * are isolated, so the rest of it is kept. What cannot be fixed is left for the model.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintPages, DEFAULT_FILE_ROOTS } from '../page-lint.mjs';
import { planFixes, FIXABLE } from './plan.mjs';
import { cssOf, withFixes } from './apply.mjs';

/** Violations per rule, counting only the rules `judge` admits. A blind run must not judge its fixes on rules it may not see. */
const tally = (results, judge) => {
  const c = {};
  for (const r of results) for (const v of r.violations) if (judge(v.rule)) c[v.rule] = (c[v.rule] ?? 0) + 1;
  return c;
};
const worse = (before, after) => Object.keys(after).some((k) => after[k] > (before[k] ?? 0));
const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

export async function autoFix(html, { browser, allow = FIXABLE, judge = () => true, register = null, viewports, workDir, maxPasses = 2, salvageTrials = 24 } = {}) {
  const counts = (results) => tally(results, judge);
  const own = !workDir;
  const dir = workDir ?? mkdtempSync(join(tmpdir(), 'af-fix-'));
  const file = join(dir, `.af-fix-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const url = pathToFileURL(file).href;
  const lintAt = (h) => { writeFileSync(file, h); return lintPages([url], { browser, viewports, register, withIds: true, fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] }); };
  let cssRules = [];
  const applied = [];
  let current = withFixes(html, '');
  let results = await lintAt(current);
  const before = total(tally(results, () => true));
  try {
    for (let pass = 0; pass < maxPasses; pass++) {
      const patches = planFixes(results, { allow });
      if (!patches.length) break;
      const rules = cssOf(patches);
      const usable = patches.map((p, i) => ({ ...p, css: rules[i] })).filter((p) => p.css);
      if (!usable.length) break;
      const tryCss = (extra) => withFixes(html, [...cssRules, ...extra.map((p) => p.css)].join('\n'));
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
        const salvage = async (base, group) => {
          if (group.length < 2) return [];
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
      if (!kept.length || total(counts(next)) >= total(counts(results))) break;
      cssRules = [...cssRules, ...kept.map((p) => p.css)];
      applied.push(...kept.map(({ afId, pseudo, decl, rules }) => ({ afId, pseudo, decl, rules })));
      current = candidate;
      results = next;
    }
  } finally {
    rmSync(file, { force: true });
    if (own) rmSync(dir, { recursive: true, force: true });
  }
  return { html: current, css: cssRules.join('\n'), applied, results, stats: { before, after: total(tally(results, () => true)) }, file: basename(file) };
}
