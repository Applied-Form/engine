/**
 * The config file, the baseline and the `.standards/` directory under their new names (decision
 * 0029): the new name is read silently, the old one with one line on stderr, the new file wins
 * when both exist, an explicit path gets no fallback, and `init` never rewrites an old file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { CONFIG, BASELINE, DIR, ENV, deprecated } from '../src/lib/names.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STANDARDS = join(ROOT, 'bin/standards.mjs');
const scratch = () => mkdtempSync(join(tmpdir(), 'standards-config-'));
const write = (dir, name, text) => writeFileSync(join(dir, name), typeof text === 'string' ? text : `${JSON.stringify(text)}\n`);
const cleanEnv = () => { const env = { ...process.env }; for (const [current, old] of Object.entries(ENV)) { delete env[current]; delete env[old]; } return env; };
const run = (dir, ...args) => spawnSync(process.execPath, [STANDARDS, ...args], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
/** The lines on stderr that announce a legacy file. */
const noticesFor = (r, legacy) => r.stderr.split('\n').filter((l) => l.startsWith(`${legacy} is deprecated`));

let chromium = null;
try { chromium = await launchBrowser(); await chromium.close(); } catch (e) { if (process.env.CI) throw e; }
const skip = chromium ? false : 'no Chromium';

const PAGE = '<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>t</title></head><body>'
  + '<p style="color:#ccc;font-size:16px">Low contrast body text that is plainly too faint to read.</p></body></html>';

test('a config under the old name lowering a mandatory rule is refused, naming that file, with one line', () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  write(dir, CONFIG.legacy, { rules: { contrast: 'warn' } });
  const r = run(dir, 'lint', 'page.html', '--sample', '0');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /"contrast" is mandatory/);
  assert.ok(r.stderr.includes(`${CONFIG.legacy}: `), 'the message names the file that was read');
  assert.equal(noticesFor(r, CONFIG.legacy).length, 1, r.stderr);
});

test('a config under the new name lowering a mandatory rule is refused the same way, with no deprecation line', () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  write(dir, CONFIG.name, { rules: { contrast: 'off' } });
  const r = run(dir, 'lint', 'page.html', '--sample', '0');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /"contrast" is mandatory/);
  assert.ok(r.stderr.includes(`${CONFIG.name}: `));
  assert.doesNotMatch(r.stderr, /deprecated/);
});

test('both configs exist: the new one is used, and the old one is named as ignored', () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  write(dir, CONFIG.legacy, { rules: { contrast: 'off' } });
  write(dir, CONFIG.name, { rules: { 'label-apca': 'off' } });
  const r = run(dir, 'lint', 'page.html', '--sample', '0', '--json');
  // The old file would have been refused. It is never read.
  assert.doesNotMatch(r.stderr, /is mandatory/);
  assert.equal(noticesFor(r, CONFIG.legacy).length, 1, r.stderr);
  assert.ok(r.stderr.includes(`${CONFIG.legacy} is ignored`), r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).config.overrides, { 'label-apca': 'off' });
});

test('an explicit --config path gets no fallback', () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  write(dir, CONFIG.legacy, { rules: {} });
  const r = run(dir, 'lint', 'page.html', '--config', CONFIG.name);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /config file not found: standards\.config\.json/, 'the old file is not read in its place');
});

test('a system named in a config under the old name is judged against, with exactly one line', () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  const floors = Object.fromEntries(['body-contrast', 'display-contrast', 'text-min-px'].map((k) => [k, { $value: 1 }]));
  write(dir, 'overlay.tokens.json', { floors });
  write(dir, CONFIG.legacy, { system: 'overlay.tokens.json' });
  const r = run(dir, 'lint', 'page.html', '--json', '--sample', '0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /floors\.body-contrast is 1, below the platform floor/, 'the overlay it names was loaded through the old file');
  assert.equal(noticesFor(r, CONFIG.legacy).length, 1, `the command and the script it runs say it once between them:\n${r.stderr}`);
});

test('--baseline with only the old baseline holds its violations, with one line', { skip }, () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  const wrote = run(dir, 'baseline', 'page.html', '--sample', '0', '--out', BASELINE.legacy);
  assert.equal(wrote.status, 0, wrote.stdout + wrote.stderr);
  assert.deepEqual(readdirSync(dir).sort(), [BASELINE.legacy, 'page.html']);
  const r = run(dir, 'lint', 'page.html', '--sample', '0', '--baseline');
  assert.equal(r.status, 0, `the page's violations are held, not judged anew:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /known violation\(s\) held/);
  assert.equal(noticesFor(r, BASELINE.legacy).length, 1, r.stderr);
  const without = run(dir, 'lint', 'page.html', '--sample', '0');
  assert.equal(without.status, 1, 'without --baseline the same page fails');
});

test('baseline with only the old file present writes the old file and keeps the pages it did not lint', { skip }, () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  const held = { 'elsewhere.html@1280': { 'contrast|x': 2 } };
  write(dir, BASELINE.legacy, { version: 1, recorded: null, entries: held });
  const r = run(dir, 'baseline', 'page.html', '--sample', '0');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(dir).sort(), [BASELINE.legacy, 'page.html'], 'no new-named file appears beside it');
  const after = JSON.parse(readFileSync(join(dir, BASELINE.legacy), 'utf8'));
  assert.deepEqual(after.entries['elsewhere.html@1280'], held['elsewhere.html@1280']);
  assert.ok(after.entries['page.html@1280'], 'and the page it linted is recorded');
  assert.match(r.stdout, /kept 1 page\/viewport pair\(s\) not linted this run/);
  assert.equal(noticesFor(r, BASELINE.legacy).length, 1, r.stderr);
});

test('baseline in an empty directory writes the new name, silently', { skip }, () => {
  const dir = scratch();
  write(dir, 'page.html', PAGE);
  const r = run(dir, 'baseline', 'page.html', '--sample', '0');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(dir).sort(), ['page.html', BASELINE.name]);
  assert.doesNotMatch(r.stderr, /deprecated/);
});

test('init in an empty directory writes the new names only', () => {
  const dir = scratch();
  const r = run(dir, 'init', '--pack', 'instrument');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(dir).sort(), [DIR.name, CONFIG.name]);
  assert.equal(JSON.parse(readFileSync(join(dir, CONFIG.name), 'utf8')).system, `${DIR.name}/system.json`);
  assert.ok(existsSync(join(dir, DIR.name, 'system.json')));
  assert.doesNotMatch(r.stderr, /deprecated/);
});

test('an existing config under the old name survives init untouched; the new file carries its rules', () => {
  const dir = scratch();
  const old = `${JSON.stringify({ rules: { measure: 'warn' }, baseline: 'kept.json' }, null, 1)}\n`;
  write(dir, CONFIG.legacy, old);
  const r = run(dir, 'init', '--pack', 'instrument');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(dir, CONFIG.legacy), 'utf8'), old, 'the old file is neither deleted nor rewritten');
  const next = JSON.parse(readFileSync(join(dir, CONFIG.name), 'utf8'));
  assert.deepEqual(next, { rules: { measure: 'warn' }, baseline: 'kept.json', system: `${DIR.name}/system.json` });
  assert.equal(noticesFor(r, CONFIG.legacy).length, 1, r.stderr);
});

test('an existing config under the new name is updated in place by init', () => {
  const dir = scratch();
  write(dir, CONFIG.name, { rules: { spacing: 'warn' } });
  const r = run(dir, 'init', '--pack', 'instrument');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, CONFIG.name), 'utf8')), { rules: { spacing: 'warn' }, system: `${DIR.name}/system.json` });
  assert.deepEqual(readdirSync(dir).sort(), [DIR.name, CONFIG.name]);
});

test('the deprecation line for a file is the shared text', () => {
  assert.equal(deprecated(CONFIG.legacy, CONFIG.name), `${CONFIG.legacy} is deprecated: use ${CONFIG.name}. ${CONFIG.legacy} will be removed in Standards 5.0.0.`);
});
