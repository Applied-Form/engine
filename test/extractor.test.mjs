/** The extractor must see what the reference pages never do. Needs Chromium, like pages.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lintPages, launchBrowser } from '../src/lib/page-lint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }

test('deliberate violations are all caught', { skip: browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}` }, async (t) => {
  t.after(() => browser.close());
  const [r] = await lintPages([pathToFileURL(root + 'test/fixtures/violations.html').href], { browser, viewports: [1280] });
  const rules = new Set(r.violations.map((v) => v.rule));
  const has = (rule, pred = () => true) => assert.ok(r.violations.some((v) => v.rule === rule && pred(v)), `${rule}: ${JSON.stringify([...rules])}`);
  has('text-too-small', (v) => v.text?.pseudo === '::before');             // generated content is read
  has('display-voice-in-ii', (v) => /shadow root/.test(v.text?.sample ?? ''));   // shadow DOM is walked
  has('ground-in-ii');                                                      // gradient stops count as grounds
  has('support-as-ground');
  has('link-not-underlined', (v) => /underline is removed/.test(v.link?.sample ?? ''));
  has('body-too-small', (v) => /Fourteen pixel/.test(v.text?.sample ?? ''));
  has('grid-off-column');
  has('spread-in-ii');
  has('layer-unknown');
  has('rotation-off-set', (v) => v.item.rotation === 12);
  has('offset-off-grid');
  has('bleed-off-scale', (v) => v.item.over === 23);
  has('panel-ratio');
  has('recipe-mismatch', (v) => v.item.spread === 'datum');
  has('figure-hand-drawn');
  has('chart-legend');
  has('series-order');
  has('motion-off-scale', (v) => v.item.ms === 300);
  has('target-size', (v) => v.target?.width === 16 && v.target?.height === 16);   // a 16px button
  has('alt-missing', (v) => v.imagery?.tag === 'img');                            // an <img> without alt
  has('shadow-present', (v) => v.absence?.className === 'card');                  // a shadowed card
  has('radius-present', (v) => v.absence?.className === 'rounded-box');           // a rounded box
  has('gradient-fill', (v) => v.absence?.className === 'gradient-heading');       // a gradient-filled heading
});
