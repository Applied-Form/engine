#!/usr/bin/env node
/**
 * `af drift` over the targets in `eval/drift/targets.json`, one directory per target.
 *
 *   node eval/drift-batch.mjs all
 *   node eval/drift-batch.mjs govuk carbon
 *   node eval/drift-batch.mjs https://example.com/ https://example.com/about --name example
 *   node eval/drift-batch.mjs examples/register-ii*.html --name applied-form     # the repository, surveying itself
 *
 * Each target gets `survey.json` — every computed value the browser saw, the evidence — and
 * `report.json`, the inference over it. A page that fails to load is recorded in `status.json`
 * with the error rather than dropped, because a report over two of three pages is a different
 * report and the reader has to be able to tell. Needs network; it is what `.github/workflows/drift.yml`
 * runs, and it runs the same way on any machine that can reach the sites.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const name = nameIdx >= 0 ? args[nameIdx + 1] : 'adhoc';
const words = args.filter((a, i) => !a.startsWith('--') && i !== nameIdx + 1);
if (!words.length) { console.error('usage: node eval/drift-batch.mjs <all | key... | url...> [--name dir]'); process.exit(2); }

const { targets } = JSON.parse(readFileSync(resolve(ROOT, 'eval/drift/targets.json'), 'utf8'));
const jobs = [];
if (words.length === 1 && words[0] === 'all') {
  for (const [key, t] of Object.entries(targets)) jobs.push({ key, name: t.name, pages: t.pages });
} else if (words.every((w) => targets[w])) {
  for (const w of words) jobs.push({ key: w, name: targets[w].name, pages: targets[w].pages });
} else if (words.every((w) => /^https?:\/\//.test(w) || /\.html?$/.test(w))) {
  // URLs, or local pages: the latter is how the repository surveys itself, which needs no network
  // and is the baseline every external number is read against.
  jobs.push({ key: name, name, pages: words.map((w) => (/^https?:/.test(w) ? w : resolve(process.cwd(), w))) });
} else {
  console.error(`arguments must be "all", target keys (${Object.keys(targets).join(', ')}), URLs or local .html pages — not a mixture`);
  process.exit(2);
}

let failed = 0;
for (const job of jobs) {
  const dir = resolve(ROOT, 'eval/drift', job.key);
  mkdirSync(dir, { recursive: true });
  const survey = resolve(dir, 'survey.json'), report = resolve(dir, 'report.json');
  console.log(`\n== ${job.key} · ${job.name} · ${job.pages.length} page(s)`);
  const started = new Date().toISOString();
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/drift.mjs'), ...job.pages, '--save-survey', survey, '--out', report], { encoding: 'utf8', cwd: ROOT });
  const ok = r.status === 0 && existsSync(survey);
  const status = { key: job.key, name: job.name, pages: job.pages, started, finished: new Date().toISOString(), ok, exit: r.status, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-4000) };
  writeFileSync(resolve(dir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  process.stdout.write(r.stdout);
  if (!ok) { failed += 1; console.error(`   failed (exit ${r.status}): ${r.stderr.split('\n').find(Boolean) ?? ''}`); }
}
console.log(`\n${jobs.length - failed}/${jobs.length} targets surveyed.`);
process.exit(failed === jobs.length ? 1 : 0);
