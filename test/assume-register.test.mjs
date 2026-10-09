/**
 * A page with no register of its own, linted as if it had one.
 *
 * The first live-URL run measured example.com and reported a missing register at six widths and
 * nothing else. That is correct for an Applied Form page and useless for anyone else's, which is
 * the page a first look at a prospect is made of. These hold what `--register` promises: every
 * rule runs, the result says the register was assumed, and a page that declares its own keeps it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lintPages, launchBrowser } from '../src/lib/page-lint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

// Somebody else's page: a system font, a hex colour, and no register.
const foreign = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'af-foreign-'));
  const file = join(dir, 'foreign.html');
  writeFileSync(file, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Elsewhere</title><style>body{font-family:Arial,sans-serif;color:#333;margin:24px}h1{font-size:30px}p{font-size:14px}</style></head><body><h1>Elsewhere</h1><p>A page made by someone who has never heard of the system.</p></body></html>');
  return pathToFileURL(file).href;
})();

test('an unknown register is refused before a browser is started', async () => {
  await assert.rejects(() => lintPages([foreign], { register: 'iii' }), /unknown register "iii"/);
  // A name every object answers to is not a register the tokens define.
  for (const name of ['constructor', 'toString', '__proto__']) await assert.rejects(() => lintPages([foreign], { register: name }), /unknown register/);
});

test('without a register the foreign page stops at one violation', { skip }, async () => {
  const [r] = await lintPages([foreign], { browser, viewports: [1280] });
  assert.deepEqual(r.violations.map((v) => v.rule), ['register']);
});

test('with an assumed register every rule runs, and the result says it was assumed', { skip }, async () => {
  const [r] = await lintPages([foreign], { browser, viewports: [1280], register: 'ii' });
  assert.equal(r.spec.register, 'ii');
  assert.equal(r.spec.assumedRegister, true);
  const rules = new Set(r.violations.map((v) => v.rule));
  assert.ok(!rules.has('register'), 'the register violation is gone');
  assert.ok(rules.size >= 2, `an off-system page should break more than one rule: ${[...rules]}`);
  assert.ok([...rules].some((id) => /voice|family|font/.test(id)), `Arial is not one of the system's voices: ${[...rules]}`);
});

test('an empty data-register declares nothing, so the assumed one fills it and says so', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-empty-'));
  const file = join(dir, 'empty.html');
  writeFileSync(file, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Empty</title></head><body data-register=""><h1>Empty</h1><p>A register attribute with no value.</p></body></html>');
  const [r] = await lintPages([pathToFileURL(file).href], { browser, viewports: [1280], register: 'ii' });
  assert.equal(r.spec.register, 'ii');
  assert.equal(r.spec.assumedRegister, true);
  assert.ok(!r.violations.some((v) => v.rule === 'register-mixed'), 'one root, not two');
});

test('a page that declares its own register keeps it', { skip }, async (t) => {
  t.after(() => browser.close());
  const [r] = await lintPages([pathToFileURL(root + 'test/fixtures/clean.html').href], { browser, viewports: [1280], register: 'i' });
  assert.equal(r.spec.register, 'ii');
  assert.equal(r.spec.assumedRegister, false);
  assert.equal(r.violations.length, 0, JSON.stringify(r.violations.map((v) => v.rule)));
});
