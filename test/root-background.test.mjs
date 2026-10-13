/**
 * The register's own background must never be reported as a ground.
 *
 * CSS propagates <body>'s background to the canvas when <html> declares none, so a page that
 * writes `body{background:...}` paints exactly the same pixels as one that writes
 * `html,body{background:...}`. The extractor read the background off the register root only, saw
 * transparent, and reported <body> as a full-bleed ground of an unexpected colour — penalising a
 * selector list rather than a design decision. In Register II, where any ground is forbidden, this
 * failed the page outright.
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

const page = (register, where, bg) => `<!doctype html><html lang="en" data-register="${register}"><head><meta charset="utf-8"><title>Ground</title><style>
${where}{background:${bg}}
body{margin:0;font-family:system-ui;color:#111}
main{max-width:60ch;margin:0 auto;padding:40px 16px}
</style></head><body><main><h1>A heading</h1><p>Body copy that exists so the page is not empty.</p></main></body></html>`;

const lint = async (html) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-ground-'));
  const file = join(dir, 'p.html');
  writeFileSync(file, html);
  const [r] = await lintPages([pathToFileURL(file).href], { browser, viewports: [1280] });
  return r.violations.map((v) => v.rule);
};

test('the register background on body alone is not a ground', { skip: browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}` }, async (t) => {
  t.after(() => browser.close());
  const bgI = registers.i.background;

  const onBoth = await lint(page('i', 'html,body', bgI));
  assert.ok(!onBoth.includes('ground-off-palette'), `html,body is the control and must be clean: ${onBoth}`);

  const onBody = await lint(page('i', 'body', bgI));
  assert.ok(!onBody.includes('ground-off-palette'), `same pixels, so same verdict: ${onBody}`);

  // Register II forbids every ground, so the same defect failed the page outright there.
  const ii = await lint(page('ii', 'body', registers.ii.background));
  assert.ok(!ii.includes('ground-in-ii'), `the register's own background is not a ground in II: ${ii}`);

  // The rule must still fire on a real full-bleed ground the system does not declare.
  const real = await lint(page('i', 'body', bgI).replace('</main>', '</main><div style="background:#8B1E3F;height:200px"></div>'));
  assert.ok(real.includes('ground-off-palette'), `a genuine off-palette full-bleed ground must still be caught: ${real}`);
});
