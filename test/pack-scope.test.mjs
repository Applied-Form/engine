/**
 * A pack is judged by its own rules: universal accessibility rules, and the rules for what the pack
 * itself declares. Never by this system's house rules.
 *
 * Instrument's own eighteen reference pages failed under Instrument's own imported system on every
 * page (readiness baseline B2, 2026-10-13): 372 text-too-small, 252 body-too-small, 108
 * heading-voice-ii — Applied Form's Register II floors and voices, which Instrument never states.
 *
 * Tokens load once per process from AF_BRAND, so each system is linted in a child process.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromPack } from '../src/lib/pack.mjs';
import { RULES } from '../src/lib/rules/registry.mjs';
import { launchBrowser } from '../src/lib/page-lint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const instrument = JSON.parse(readFileSync(new URL('./fixtures/instrument.tokens.json', import.meta.url), 'utf8'));
const scopeOf = Object.fromEntries(RULES.map((r) => [r.id, r.scope]));

let skip = false;
try { await (await launchBrowser()).close(); } catch (e) { if (process.env.CI) throw e; skip = `no Chromium: ${e.message.split('\n')[0]}`; }

/** Lint pages under a pack's overlay in a fresh process; returns { file: [rules fired at 320 or 1280] }. */
function lintUnder(pack, pages) {
  const dir = mkdtempSync(join(tmpdir(), 'af-pack-scope-'));
  const { overlay, report } = fromPack(pack, { key: 'scope' });
  assert.ok(overlay, report.refused.join('; '));
  writeFileSync(join(dir, 'system.json'), JSON.stringify(overlay));
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(dir, name), html);
  writeFileSync(join(dir, 'child.mjs'), `
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    import { lintPages, launchBrowser, DEFAULT_FILE_ROOTS } from ${JSON.stringify(join(root, 'src/lib/page-lint.mjs'))};
    const dir = ${JSON.stringify(dir)};
    const browser = await launchBrowser();
    const out = {};
    for (const f of ${JSON.stringify(Object.keys(pages))}) {
      const rs = await lintPages([pathToFileURL(join(dir, f)).href], { browser, viewports: [320, 1280], fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
      out[f] = [...new Set(rs.flatMap((r) => r.violations.map((v) => v.rule)))].sort();
    }
    await browser.close();
    console.log(JSON.stringify(out));`);
  const run = spawnSync(process.execPath, [join(dir, 'child.mjs')], { env: { ...process.env, AF_BRAND: join(dir, 'system.json') }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return { fired: JSON.parse(run.stdout.trim().split('\n').pop()), report };
}

// Instrument's own idiom: Public Sans text, DM Mono labels at 12px, a 16px body, an 8px scale, its red.
const page = (attrs = '', extra = '') => `<!doctype html><html lang="en"${attrs}><head><meta charset="utf-8"><title>Schedule</title>
<style>
  body { margin: 0; background: #FFFFFF; color: #111111; font: 16px/1.5 "Public Sans", system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 32px; margin: 0 0 16px; }
  .label { font: 12px/1.4 "DM Mono", ui-monospace, monospace; color: #6B6B6B; text-transform: uppercase; margin: 0 0 8px; }
  a { color: #C8102E; text-decoration: underline; }
  ${extra}
</style></head><body><main><p class="label">Release schedule</p><h1>Three dates</h1>
<p>The schedule for the next three releases, with the owner of each. Read the <a href="#notes">notes</a> first.</p>
<div class="box"><p>Box content.</p></div></main></body></html>`;

const planted = '.box { border-radius: 8px; padding: 13px; } .box p { color: #B5B5B5; } main::after { content: ""; display: block; width: 900px; height: 8px; }';

test('a pack page is never judged by this system\'s house rules, declared register or not', { skip }, () => {
  const { fired } = lintUnder(instrument, { 'plain.html': page(), 'declared.html': page(' data-register="ii"') });
  for (const [file, rules] of Object.entries(fired)) {
    assert.deepEqual(rules.filter((r) => scopeOf[r] === 'house'), [], `${file} fired house rules: ${rules.join(', ')}`);
    assert.ok(!rules.includes('register'), `${file}: a pack page needs no data-register`);
  }
});

test('the rules a pack does declare, and the universal ones, still catch a planted defect', { skip }, () => {
  const { fired } = lintUnder(instrument, { 'planted.html': page('', planted) });
  for (const rule of ['radius-present', 'spacing', 'contrast', 'horizontal-overflow']) {
    assert.ok(fired['planted.html'].includes(rule), `${rule} not caught: ${fired['planted.html'].join(', ')}`);
  }
});

test('a rule whose parameter the pack never states does not fire, and the report says so', { skip }, () => {
  const bare = JSON.parse(JSON.stringify(instrument));
  delete bare.system_values;
  const { fired, report } = lintUnder(bare, { 'planted.html': page('', planted) });
  for (const rule of ['spacing', 'radius-present', 'radius-off-scale', 'measure']) {
    assert.ok(!fired['planted.html'].includes(rule), `${rule} fired though the pack declares no ${rule === 'measure' ? 'measure' : rule.startsWith('radius') ? 'radius' : 'spacing unit'}`);
  }
  assert.ok(fired['planted.html'].includes('contrast') && fired['planted.html'].includes('horizontal-overflow'), 'universal rules still apply');
  assert.match(report.carried.join('\n'), /not declared by the pack.*spacing/s);
});

/**
 * Two false positives found by linting Instrument's own eighteen reference pages under Instrument
 * (readiness M1, 2026-10-13). Instrument's ink is for "primary fills" and its ink band "is the mark",
 * so an ink band is a ground the pack declares. And DM Mono is for numerals, units, identifiers,
 * column headers and labels, "never for running text", so a caption in Public Sans is right.
 */
test("a pack's fill colour is a ground it declares; an undeclared one is still caught, in the pack's words", { skip }, () => {
  const band = (hex) => page('', `.band { background: ${hex}; height: 64px; }`).replace('<body>', '<body><div class="band"></div>');
  const { fired } = lintUnder(instrument, { 'ink.html': band('#111111'), 'blue.html': band('#3366FF') });
  assert.ok(!fired['ink.html'].includes('ground-off-palette'), `the ink band: ${fired['ink.html'].join(', ')}`);
  assert.ok(fired['blue.html'].includes('ground-off-palette'), `an undeclared band: ${fired['blue.html'].join(', ')}`);
});

test('under a pack, running text in a caption is not data; a column header still is', { skip }, () => {
  const fig = page('', '').replace('<div class="box">', '<figure><figcaption>All figures are fictional layout data.</figcaption></figure><table><tr><th>Owner</th></tr><tr><td>Ops</td></tr></table><div class="box">');
  const { fired } = lintUnder(instrument, { 'fig.html': fig });
  const msgs = fired['fig.html'];
  assert.ok(msgs.includes('data-not-mono'), 'the th in Public Sans is still caught');
  const { fired: only } = lintUnder(instrument, { 'cap.html': page('', '').replace('<div class="box">', '<figure><figcaption>All figures are fictional layout data.</figcaption></figure><div class="box">') });
  assert.ok(!only['cap.html'].includes('data-not-mono'), `a running-text caption: ${only['cap.html'].join(', ')}`);
});

// The five paid packs state an 8px unit and no steps. "8px unit" is a scale: every multiple of 8.
test('a pack that states only a spacing unit is held to multiples of it, not to this system\'s steps', { skip }, () => {
  const unitOnly = JSON.parse(JSON.stringify(instrument));
  unitOnly.system_values = { unit: '8px', radius: '0', measure: '66ch' };
  const { fired } = lintUnder(unitOnly, {
    'forty.html': page('', '.box { padding: 40px; }'),   // 40 is a multiple of 8, but not on Applied Form's 8/16/24/32/48/64/80/96
    'twelve.html': page('', '.box { padding: 12px; }'),
  });
  assert.ok(!fired['forty.html'].includes('spacing'), `40px under an 8px unit: ${fired['forty.html'].join(', ')}`);
  assert.ok(fired['twelve.html'].includes('spacing'), `12px under an 8px unit: ${fired['twelve.html'].join(', ')}`);
});

/**
 * Three false positives found by linting the paid packs' own catalogue fixtures under each pack
 * (readiness M1, 2026-10-13), each read against the pack's source:
 *  - Broadsheet states a third voice, `util` (Archivo); the importer carried only text, data, display.
 *  - Agitprop: "Geometry replaces image: wedges, circles, bars". A circle is a shape it declares, not
 *    a rounded corner. A small square with rounded corners is still one.
 *  - Raw labels each status in text. "Not colour alone" (WCAG 1.4.1) is the universal rule; a label
 *    *and* a shape is this system's own stricter house requirement.
 */
test("every voice a pack states is one of its voices", { skip }, () => {
  const util = JSON.parse(JSON.stringify(instrument));
  util.type.util = '"Archivo", system-ui, sans-serif';
  const { fired } = lintUnder(util, { 'util.html': page('', '.u { font-family: "Archivo", system-ui, sans-serif; }').replace('<div class="box">', '<p class="u">Filed under operations.</p><div class="box">') });
  assert.ok(!fired['util.html'].includes('font-off-system'), fired['util.html'].join(', '));
});

test('under a pack a circle is a shape, not a rounded corner; a rounded square is still caught', { skip }, () => {
  const { fired } = lintUnder(instrument, {
    'circle.html': page('', '.dot { display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: #111111; }').replace('<div class="box">', '<span class="dot"></span><div class="box">'),
    'square.html': page('', '.sq { display: inline-block; width: 24px; height: 24px; border-radius: 4px; background: #111111; }').replace('<div class="box">', '<span class="sq"></span><div class="box">'),
  });
  assert.ok(!fired['circle.html'].includes('radius-present'), `a circle: ${fired['circle.html'].join(', ')}`);
  assert.ok(fired['square.html'].includes('radius-present'), `a rounded square: ${fired['square.html'].join(', ')}`);
});

test('under a pack a labelled status passes; a status carried by colour alone does not', { skip }, () => {
  const { fired } = lintUnder(instrument, {
    'labelled.html': page('', '[data-status] { color: #C8102E; }').replace('<div class="box">', '<p><span data-status="failed">failed</span></p><div class="box">'),
    'colour.html': page('', '[data-status] { display: inline-block; width: 8px; height: 8px; background: #C8102E; }').replace('<div class="box">', '<p><span data-status="failed"></span> Build</p><div class="box">'),
  });
  assert.ok(!fired['labelled.html'].includes('status-colour-only'), `a labelled status: ${fired['labelled.html'].join(', ')}`);
  assert.ok(fired['colour.html'].includes('status-colour-only'), `colour alone: ${fired['colour.html'].join(', ')}`);
});

/**
 * Measure is the length of a line of text, and a line is never longer than its text. The rule measured
 * the box: a three-word heading ("Field note 01") in a 1,100px column read as 150ch, and so did a
 * date in a definition list (readiness M1, 2026-10-13, 61 violations across four packs' fixtures).
 * A long sentence on one line in the same column is still over the measure.
 */
test('a short line in a wide box is within the measure; a long one is not', { skip }, () => {
  const wide = (text) => page('', 'main { max-width: none; } main > p, .box { max-width: 60ch; } .wide { width: 1100px; max-width: 100%; }').replace('<div class="box">', `<h2 class="wide">${text}</h2><div class="box">`);
  const { fired } = lintUnder(instrument, {
    'short.html': wide('Field note 01'),
    'long.html': wide('A bounded workflow makes the evidence, the decision and the next action available to every reviewer.'),
  });
  assert.ok(!fired['short.html'].includes('measure'), `a three-word heading: ${fired['short.html'].join(', ')}`);
  assert.ok(fired['long.html'].includes('measure'), `a 100-character line: ${fired['long.html'].join(', ')}`);
});
