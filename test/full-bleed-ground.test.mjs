/**
 * A ground is a surface that bleeds to the viewport's edges, judged by the colour it renders as.
 *
 * Two defects this pins down, both in src/lib/page-spec.mjs's ground collection:
 *  1. "Wide" was `rect.width >= vw * 0.9`. At 320px that is 288px — exactly a card inside the ordinary
 *     16px mobile margin — so the same card was a card at 1280px and a full-bleed ground at 320px.
 *  2. Translucent paint was read by its raw rgb. `rgba(<declared ground>, 0.1)` renders as a pale tint
 *     but was reported as the declared ground itself, and passed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintPages, launchBrowser } from '../src/lib/page-lint.mjs';
import { registers } from '../src/lib/tokens.mjs';

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }

const page = (inMain = '', afterMain = '') => `<!doctype html><html lang="en" data-register="i"><head><meta charset="utf-8"><title>Ground</title><style>
html,body{background:${registers.i.background};margin:0}
body{font-family:system-ui;color:#111}
main{max-width:960px;margin:0 auto;padding:40px 16px}
</style></head><body><main><h1>A heading</h1><p>Body copy that exists so the page is not empty.</p>${inMain}</main>${afterMain}</body></html>`;

const lint = async (html, width) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-bleed-'));
  const file = join(dir, 'p.html');
  writeFileSync(file, html);
  const [r] = await lintPages([pathToFileURL(file).href], { browser, viewports: [width] });
  return r.violations.filter((v) => /ground/.test(v.rule)).map((v) => `${v.rule} ${v.color}`);
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
// A direct child of a margin-0 body, so it reaches both viewport edges.
const band = (bg) => `<div style="background:${bg};height:120px"></div>`;

test('a card inside the page margin is not a ground at any width; a band to the edges is', { skip: browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}` }, async (t) => {
  t.after(() => browser.close());
  const card = '<div style="background:#FFFFFF;border-radius:8px;height:120px"></div>';

  assert.deepEqual(await lint(page(card), 1280), [], 'control: the card is a card at 1280px');
  assert.deepEqual(await lint(page(card), 320), [], 'the same card is still a card at 320px');

  // Still caught: an undeclared colour bleeding to both edges, at both widths.
  for (const w of [320, 1280]) {
    assert.ok((await lint(page('', band('#8B1E3F')), w)).some((v) => v.startsWith('ground-off-palette')), `a genuine off-palette band at ${w}px`);
  }
  // A declared ground, opaque, is fine.
  assert.deepEqual(await lint(page('', band(registers.i.grounds[0])), 320), [], 'a declared ground bleeding is allowed');
});

test('translucent paint is judged by what it renders as', { skip: browser ? false : 'no Chromium' }, async () => {
  const b = await launchBrowser();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'af-bleed-'));
    const file = join(dir, 'p.html');
    writeFileSync(file, page('', band(`rgba(${rgb(registers.i.grounds[0])},0.1)`)));
    const [r] = await lintPages([pathToFileURL(file).href], { browser: b, viewports: [1280] });
    const v = r.violations.filter((x) => x.rule === 'ground-off-palette');
    assert.equal(v.length, 1, `a 10% tint of a declared ground is not that ground: ${JSON.stringify(r.violations.map((x) => x.rule))}`);
    assert.notEqual(v[0].color.toUpperCase(), registers.i.grounds[0].toUpperCase(), 'and is reported as the colour it renders as');
  } finally { await b.close(); }
});
