#!/usr/bin/env node
/**
 * Lint the deployed site. Reads site.urls.json (an array of URLs) or takes URLs as arguments,
 * lints each, and writes a report to dist/site-lint.json so successive runs can be diffed.
 *   node scripts/lint-site.mjs [url ...]
 */
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lintPages } from '../src/lib/page-lint.mjs';
import { loadConfig, loadBaseline, applyPolicy, policyNotes } from '../src/lib/policy.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const urls = process.argv.slice(2).length ? process.argv.slice(2) : (existsSync(`${ROOT}site.urls.json`) ? JSON.parse(readFileSync(`${ROOT}site.urls.json`, 'utf8')) : []);
if (!urls.length) { console.error('usage: node scripts/lint-site.mjs <url ...>  (or list them in site.urls.json)'); process.exit(2); }
const config = loadConfig(process.cwd());
// Same key base as lint-page: relative to the baseline file, so both tools read one baseline the same way.
const keyBase = config.baseline ? dirname(resolve(config.baseline)) : process.cwd();
const { results, summary } = applyPolicy(await lintPages(urls), { config, baseline: loadBaseline(config.baseline), cwd: keyBase });
const report = results.map((r) => ({ url: r.url, viewport: r.viewport, violations: r.errors.map((v) => ({ rule: v.rule, message: v.message })), warnings: r.warnings.length, known: r.known.length, advisories: r.advisories.length }));
const prevPath = `${ROOT}dist/site-lint.json`;
const prev = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
writeFileSync(prevPath, JSON.stringify(report, null, 2) + '\n');
let failed = 0;
for (const r of report) {
  const before = prev?.find((p) => p.url === r.url && p.viewport === r.viewport)?.violations.length;
  const delta = before == null ? '' : ` (was ${before})`;
  console.log(`${r.violations.length ? '✗' : '✓'} ${r.url} @ ${r.viewport}px: ${r.violations.length} violation(s)${delta}${r.known ? ` · ${r.known} known` : ''}`);
  for (const v of r.violations) console.log(`    ${v.rule}: ${v.message}`);
  if (r.violations.length) failed++;
}
const notes = policyNotes(config);
if (notes.length) console.log(`policy (${config.source}): ${notes.join(' · ')}`);
if (summary.known) console.log(`baseline: ${summary.known} known violation(s) held.`);
process.exit(failed ? 1 : 0);
