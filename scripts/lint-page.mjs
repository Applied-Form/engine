#!/usr/bin/env node
/**
 * Lint rendered HTML pages against the Applied Form rules.
 *
 *   node scripts/lint-page.mjs examples/register-ii.html https://example.com/page [...]
 *
 * Exit 1 if any page has an error-severity violation that is not in the baseline. APCA advisories
 * are printed but never fail.
 *
 *   --json                 one JSON document for CI and editors
 *   --config <file>        severity overrides (default: ./af.config.json if present)
 *   --baseline [file]      hold known violations (default: ./af-baseline.json)
 *   --baseline-write       record the current violations as the baseline and exit 0
 *   --out <file>           where --baseline-write writes (default: ./af-baseline.json)
 *   --register <i|ii>      lint a page that declares no register as if it were in this one; a
 *                          page that declares its own keeps it, and the output says which was assumed
 *
 * Set AF_CHROMIUM to a Chromium executable to skip Playwright's own download.
 */
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';
import { writeFileSync } from 'node:fs';
import { lintPages, sampledViewports, VIEWPORTS } from '../src/lib/page-lint.mjs';
import { loadConfig, loadBaseline, buildBaseline, mergeBaseline, applyPolicy, policyNotes, severityOf, splitArgs, pageKey } from '../src/lib/policy.mjs';

const { files, opts } = splitArgs(process.argv.slice(2));
const flag = (name) => opts[name] !== undefined;
const opt = (name, fallback = null) => (typeof opts[name] === 'string' ? opts[name] : fallback);
if (files.length === 0) {
  console.error('usage: node scripts/lint-page.mjs <file.html|url> [...] [--json] [--register i|ii] [--config f] [--baseline [f]] [--baseline-write --out f]');
  process.exit(2);
}

const json = flag('json');
// A missing explicit --config or --baseline is a usage error, printed as one line rather than a stack.
const fail = (e) => { console.error(`error: ${e.message}`); process.exit(2); };
let config;
try { config = loadConfig(opt('config', process.cwd())); } catch (e) { fail(e); }
const writing = flag('baseline-write');
const baselinePath = writing ? opt('out', config.baseline ?? 'af-baseline.json')
  : flag('baseline') ? opt('baseline', config.baseline ?? 'af-baseline.json')
  : config.baseline;
// A path the user typed must exist; one that came from a default or the config may not yet.
const explicitBaseline = !writing && typeof opts.baseline === 'string';
// Page keys are relative to the baseline file's directory, not the current one, so the same
// baseline matches whether the linter is run from the repo root or from inside examples/.
const keyBase = baselinePath ? dirname(resolvePath(baselinePath)) : process.cwd();

// Validate the baseline before the browser pass, so a bad path costs a second and not a minute.
let baseline;
if (!writing) { try { baseline = loadBaseline(baselinePath, { required: explicitBaseline }); } catch (e) { fail(e); } }

// Two widths drawn from between the fixed four, so a page pinned to the tested numbers is
// caught. --sample 0 turns it off for a run that has to be reproducible against a baseline.
const sampleCount = opts.sample != null ? Number(opts.sample) : 2;
const seed = opts.seed != null ? Number(opts.seed) : Date.now();
const sampled = sampleCount > 0 ? sampledViewports(sampleCount, seed) : [];
const viewports = [...VIEWPORTS, ...sampled].sort((a, b) => a - b);
if (sampled.length) console.log(`sampled widths ${sampled.join(', ')}px (--seed ${seed} to reproduce)`);
const register = opt('register');
if (opts.register === true) fail(new Error('--register needs a value: i or ii'));
let results;
try {
  results = await lintPages(files.map((f) => (/^https?:\/\//.test(f) ? f : pathToFileURL(resolvePath(f)).href)), { viewports, register });
} catch (e) { if (/unknown register/.test(e.message)) fail(e); throw e; }

if (writing) {
  const fresh = buildBaseline(results, { cwd: keyBase, stamp: new Date().toISOString() });
  const visited = new Set(results.map((r) => pageKey(r.url, r.viewport, keyBase)));
  const { baseline, kept } = mergeBaseline(loadBaseline(baselinePath), fresh, visited);
  const count = Object.values(baseline.entries).reduce((s, fps) => s + Object.values(fps).reduce((a, b) => a + b, 0), 0);
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`wrote ${baselinePath}: ${count} known violation(s) across ${Object.keys(baseline.entries).length} page/viewport pair(s).`);
  if (kept.length) console.log(`kept ${kept.length} page/viewport pair(s) not linted this run.`);
  console.log('These are now held. Anything beyond them fails.');
  process.exit(0);
}

const { results: judged, summary, failed } = applyPolicy(results, { config, baseline, cwd: keyBase });

if (json) {
  console.log(JSON.stringify({
    summary,
    config: { source: config.source, overrides: config.rules, baseline: baselinePath ?? null },
    pages: judged.map((r) => ({
      url: r.url, viewport: r.viewport, register: r.spec.register, assumedRegister: r.spec.assumedRegister ?? false,
      errors: r.errors.map(({ rule, message }) => ({ rule, message, severity: 'error' })),
      warnings: r.warnings.map(({ rule, message }) => ({ rule, message, severity: 'warn' })),
      known: r.known.map(({ rule, message }) => ({ rule, message, severity: 'baselined' })),
      // Kept for consumers written against the pre-policy shape: every violation, unjudged.
      violations: r.violations.map(({ rule, message }) => ({ rule, message, severity: severityOf(rule, config) })),
      advisories: r.advisories.map(({ rule, message }) => ({ rule, message })),
    })),
  }, null, 2));
  process.exit(failed ? 1 : 0);
}

for (const r of judged) {
  const label = `${r.url.replace(/^.*\//, '')} @ ${r.viewport}px`;
  const held = r.known.length ? ` · ${r.known.length} known` : '';
  const warned = r.warnings.length ? ` · ${r.warnings.length} warning(s)` : '';
  if (r.errors.length === 0) console.log(`✓ ${label} (register ${r.spec.register.toUpperCase()}${r.spec.assumedRegister ? ', assumed' : ''}, ${r.spec.text.length} text runs)${held}${warned}`);
  else console.log(`✗ ${label}${r.spec.assumedRegister ? ` (register ${r.spec.register.toUpperCase()}, assumed)` : ''}: ${r.errors.length} violation(s)${held}${warned}`);
  for (const v of r.errors) console.log(`    ${v.rule}: ${v.message}${v.text?.sample ? `  [${v.text.sample}]` : ''}`);
  for (const v of r.warnings) console.log(`  ! ${v.rule}: ${v.message}${v.text?.sample ? `  [${v.text.sample}]` : ''}`);
  for (const a of r.advisories) console.log(`    · ${a.message}${a.text?.sample ? `  [${a.text.sample}]` : ''}`);
}

const notes = policyNotes(config);
if (notes.length) console.log(`\npolicy (${config.source}): ${notes.join(' · ')}`);
if (summary.known) console.log(`baseline (${baselinePath}): ${summary.known} known violation(s) held.`);
if (summary.fixed) console.log(`${summary.fixed} baselined violation(s) no longer occur (${summary.fixedRules.join(', ')}). Re-run with --baseline-write to shrink the baseline.`);
process.exit(failed ? 1 : 0);
