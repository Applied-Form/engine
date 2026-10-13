/**
 * `aspect-ratio` must count the same way its denominator does.
 *
 * The scorer divides violations by the number of imagery elements (OPPORTUNITY in eval/score.mjs),
 * but the extractor deduplicated the ratios it reported, so three figures sharing one off-system
 * ratio raised one violation against three opportunities. Drawing more figures then lowered the
 * rate whether or not any of them conformed — a scored, held-out rule moving for an arithmetic
 * reason. Found 2026-10-12 while explaining the engine6 held-out result.
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

// 300x133 is not one of the system's ratios; 300x150 (2:1) is.
const figure = (w, h, i) => `<figure><svg data-figure="plot" data-generated="line-chart" aria-label="Chart ${i}" width="${w}" height="${h}"><path d="M0 ${h} L${w} 0" stroke="black"/></svg></figure>`;

const violations = async (html) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-ratio-'));
  const file = join(dir, 'p.html');
  writeFileSync(file, `<!doctype html><html lang="en" data-register="i"><head><meta charset="utf-8"><title>Ratios</title><style>html,body{background:#F2F6F3;margin:0}</style></head><body><main><h1>Figures</h1>${html}</main></body></html>`);
  const results = await lintPages([pathToFileURL(file).href], { browser, viewports: [1280], fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
  return results.flatMap((r) => r.violations).filter((v) => v.rule === 'aspect-ratio');
};

test('each off-system figure is its own violation, because each is its own opportunity', { skip }, async (t) => {
  t.after(() => browser.close());

  const one = await violations(figure(300, 133, 1));
  assert.equal(one.length, 1, 'control: one off-system figure, one violation');

  const three = await violations([figure(300, 133, 1), figure(300, 133, 2), figure(300, 133, 3)].join(''));
  assert.equal(three.length, 3, 'three figures sharing one off-system ratio are three failures, not one — the denominator counts all three');

  const permitted = await violations([figure(300, 150, 1), figure(300, 150, 2)].join(''));
  assert.equal(permitted.length, 0, 'figures on a system ratio raise nothing');
});
