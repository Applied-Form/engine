/**
 * The eighteenth protocol amendment freezes a table of what the 4.0.0 engine did on the 3.3.0 test
 * pages. A frozen record must not carry a number its own evidence contradicts: the table said
 * `violations.html` fired 28 rules when it fires 31. This lints the two fixtures the way the
 * amendment says it did (default configuration, no system variable, no config file in the
 * directory, `--json --sample 0`) and holds the table's violation and rule counts to the output.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { chromiumFromEnv } from '../src/lib/env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
if (browser) await browser.close();
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

// No system variable, new name or old: the amendment's run set none. The Chromium setting is kept, under
// the new name whichever name it was set under, so the child finds the same browser the probe above
// found. This file spells the old names out on purpose, and is exempt from the old-name greps beside
// compat.test.mjs and names.test.mjs: the 5.0.0 removal sweep must see it.
const SYSTEM_NAMES = ['STANDARDS_SYSTEM', 'AF_BRAND'];
const OLD_CHROMIUM = 'AF_CHROMIUM';
const env = () => {
  const chromium = chromiumFromEnv();
  const kept = Object.entries(process.env).filter(([k]) => ![...SYSTEM_NAMES, OLD_CHROMIUM, 'STANDARDS_CHROMIUM'].includes(k));
  return { ...Object.fromEntries(kept), ...(chromium === undefined ? {} : { STANDARDS_CHROMIUM: chromium }) };
};
const scratch = mkdtempSync(join(tmpdir(), 'standards-amendment-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const doc = readFileSync(join(root, 'docs/evaluation-protocol.md'), 'utf8');
const header = '| Page set | Pages | Violations at 320, 672, 1280 and 1584 | Rules fired |';
const amendment = doc.slice(doc.indexOf(header));
assert.ok(doc.includes(header), "the amendment's table is in the protocol");

const row = (page) => {
  const line = amendment.split('\n').find((l) => l.startsWith(`| \`test/fixtures/${page}\``));
  assert.ok(line, `the amendment's table has a row for ${page}`);
  const cells = line.split('|').map((c) => c.trim());
  return { violations: Number(cells[3]), rules: Number(cells[4]) };
};

function lint(page) {
  const r = spawnSync(process.execPath, [join(root, 'bin/standards.mjs'), 'lint', join(root, 'test/fixtures', page), '--json', '--sample', '0'],
    { encoding: 'utf8', env: env(), cwd: scratch });
  // The amendment says both pages exit 1: they carry errors. Anything else is a crash, and its stderr says why.
  assert.equal(r.status, 1, `${page}: exit status (stderr: ${r.stderr.trim() || 'empty'})`);
  const report = JSON.parse(r.stdout);
  const errors = report.pages.flatMap((p) => p.errors ?? []);
  assert.equal(errors.length, report.summary.errors, 'the per-width lists sum to the summary');
  return { violations: errors.length, rules: new Set(errors.map((e) => e.rule)) };
}

test("the eighteenth amendment's counts for attacks.html and violations.html are what the engine reports", { skip }, () => {
  const all = new Set();
  for (const page of ['attacks.html', 'violations.html']) {
    const got = lint(page), said = row(page);
    assert.equal(said.violations, got.violations, `${page}: violations`);
    assert.equal(said.rules, got.rules.size, `${page}: rules fired`);
    got.rules.forEach((r) => all.add(r));
  }
  assert.match(amendment, new RegExp(`${all.size} distinct rules fire in the set`), 'the distinct total matches the union of the two pages');
});
