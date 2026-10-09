/**
 * The four bypasses the research report proposed, each measured on a page built to use it.
 *
 * All four landed when they were first tried, which is the reason this file exists: an instrument
 * that has never been attacked is an instrument whose limits nobody knows. The fixture is not a
 * pattern to copy; it is a page written to cheat, kept so that the cheats stay caught.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { lintPages, launchBrowser } from '../src/lib/page-lint.mjs';

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

const url = new URL('./fixtures/attacks.html', import.meta.url).href;
let cached = null;
const attacked = async () => (cached ??= await lintPages([url], { viewports: [1280], browser }));

test('a page that paints its interface onto a canvas is caught', { skip }, async () => {
  const [{ violations }] = await attacked();
  const v = violations.find((x) => x.rule === 'content-not-dom');
  assert.ok(v, 'a canvas covering most of the viewport is not a figure');
  assert.match(v.message, /invisible to every other rule/);
});

test('a hand-placed element outside any declared grid is caught', { skip }, async () => {
  const [{ violations }] = await attacked();
  const v = violations.find((x) => x.rule === 'offset-off-grid');
  assert.ok(v, 'left 123px and top 47px are on no scale this system has');
});

test('an interactive control hidden from assistive technology is caught', { skip }, async () => {
  const [{ violations }] = await attacked();
  const v = violations.find((x) => x.rule === 'hidden-interactive');
  assert.ok(v, 'a focusable button inside aria-hidden is reachable and unannounced');
  assert.match(v.message, /worse than either alone/);
});

test('a figure whose content is text painted into an SVG is caught', { skip }, async () => {
  const [{ violations }] = await attacked();
  const v = violations.find((x) => x.rule === 'alt-missing');
  assert.ok(v, 'an SVG carrying sentences needs a name');
  assert.match(v.message, /characters of text/);
});

test('all four are caught in one pass, and the fixture is not accidentally clean', { skip }, async () => {
  const [{ violations }] = await attacked();
  const found = new Set(violations.map((v) => v.rule));
  for (const rule of ['content-not-dom', 'offset-off-grid', 'hidden-interactive', 'alt-missing']) {
    assert.ok(found.has(rule), `${rule} did not fire`);
  }
});

test('close browser', { skip }, async () => { await browser.close(); });
