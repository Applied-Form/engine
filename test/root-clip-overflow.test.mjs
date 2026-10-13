/**
 * Overflow the author clips at the root is still overflow.
 *
 * horizontal-overflow read documentElement's scrollWidth. `html,body{overflow-x:hidden}` makes that
 * equal clientWidth, so a page wider than a phone passed by cutting its own content off instead of
 * fitting it — a worse reflow failure than a scrollbar, and invisible to the rule. On `engine5` it hid
 * overflow of up to 488px at 320 on eight scored pages. Clipping on `body` alone propagates to the
 * viewport differently and was always measured; it is held here so the fix cannot regress it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintPages, launchBrowser, DEFAULT_FILE_ROOTS } from '../src/lib/page-lint.mjs';

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

const overflowAt320 = async (css, wide) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-clip-'));
  const file = join(dir, 'p.html');
  writeFileSync(file, `<!doctype html><html lang="en" data-register="i"><head><meta charset="utf-8"><title>Clip</title><style>body{margin:0}${css}</style></head><body><main><p>Text.</p>${wide ? '<div style="width:900px">A row wider than any phone.</div>' : ''}</main></body></html>`);
  const [r] = await lintPages([pathToFileURL(file).href], { browser, viewports: [320], fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
  return { overflow: r.violations.some((v) => v.rule === 'horizontal-overflow') };
};

test('clipping at the root does not hide overflow from the rule', { skip }, async (t) => {
  t.after(() => browser.close());
  for (const css of ['html,body{overflow-x:hidden}', 'html{overflow-x:clip}', 'html,body{overflow:hidden}']) {
    assert.ok((await overflowAt320(css, true)).overflow, `${css} with a 900px row still overflows at 320px`);
  }
  assert.ok((await overflowAt320('body{overflow-x:hidden}', true)).overflow, 'body alone was always measured');
  assert.equal((await overflowAt320('html,body{overflow-x:hidden}', false)).overflow, false, 'clipping a page that fits is not a violation');
});

test('the overflow violation names the element that sticks out, not just the width', { skip }, async () => {
  const b = await launchBrowser();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'af-culprit-'));
    const file = join(dir, 'p.html');
    // engine5: the repair message said only "The page scrolls horizontally at 320px", and GPT-5-mini's
    // whole-page repairs still overflowed 52% of the time, fixing elements that were not the cause.
    writeFileSync(file, `<!doctype html><html lang="en" data-register="i"><head><meta charset="utf-8"><title>Row</title><style>body{margin:0}.controls{display:flex}.controls button{flex:0 0 auto;min-width:240px}.scroller{overflow-x:auto}</style></head><body><main><p>Text.</p><div class="controls"><button>First option</button><button>Second option</button></div><div class="scroller"><table style="width:900px"><tr><td>Scrolls in its own box</td></tr></table></div></main></body></html>`);
    const [r] = await lintPages([pathToFileURL(file).href], { browser: b, viewports: [320], fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
    const v = r.violations.find((x) => x.rule === 'horizontal-overflow');
    assert.ok(v, 'the row overflows');
    assert.match(v.message, /button/, v.message);
    assert.match(v.message, /Second option/, 'it quotes the text so the model can find the element');
    assert.doesNotMatch(v.message, /table/, 'a box inside its own scroller is not the cause');
  } finally { await b.close(); }
});
