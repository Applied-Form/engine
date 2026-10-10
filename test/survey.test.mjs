/**
 * `af drift` end to end, against a stand-in client site whose defects were planted on purpose.
 *
 * The inference is unit-tested in `test/infer.test.mjs` without a browser. What this covers is
 * the half that only Chromium can answer: whether the survey reads a page that knows nothing
 * about this design system and returns weighted samples the inference can actually use. The
 * fixture's ground truth is written at the top of `test/fixtures/site/home.html`, and every
 * assertion here points at a line of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { surveyPages, mergeSurveys } from '../src/lib/survey.mjs';
import { driftReport } from '../src/lib/drift.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

const SITE = ['test/fixtures/site/home.html', 'test/fixtures/site/about.html'];
let cached = null;
async function report() {
  if (!cached) {
    const { merged, pages } = await surveyPages(SITE.map((p) => pathToFileURL(root + p).href), { browser });
    merged.pages = pages.length;
    cached = driftReport(merged);
  }
  return cached;
}

test('the survey finds the palette a site actually uses', { skip }, async () => {
  const r = await report();
  const values = r.system.colour.tokens.map((t) => t.value);
  for (const planted of ['#FFFFFF', '#222222', '#B0502E']) {
    assert.ok(values.includes(planted), `${planted} is one of the three real colours: got ${JSON.stringify(values)}`);
  }
  const accent = r.system.colour.tokens.find((t) => t.value === '#B0502E');
  assert.ok(accent.roles.includes('text'), 'the accent is set as a text colour on links');
});

test('the two indistinguishable colours are reported as mistakes, not as tokens', { skip }, async () => {
  const r = await report();
  const misses = Object.fromEntries(r.system.colour.nearMisses.map((n) => [n.value, n]));
  assert.equal(r.system.colour.nearMisses.length, 2, JSON.stringify(r.system.colour.nearMisses));
  assert.equal(misses['#B0512E'].nearestToken, '#B0502E');
  assert.equal(misses['#232323'].nearestToken, '#222222');
  for (const m of Object.values(misses)) assert.ok(m.distance < 2.3, 'inside the just-noticeable difference');
  assert.ok(r.numbers.wasteShare > 0, 'waste that exists carries a share above zero');
});

test('the spacing step is found, and what sits off it is named', { skip }, async () => {
  const r = await report();
  assert.equal(r.system.spacing.step, 8);
  assert.equal(r.system.spacing.onScale, true);
  const off = r.system.spacing.offScale.map((o) => o.value);
  for (const planted of [13, 30]) assert.ok(off.includes(planted), `${planted}px was planted off the step: got ${JSON.stringify(off)}`);
  // Found rather than planted: the browser's em-derived default margins on h1 and on the 11px
  // paragraph. A real audit finds exactly this — a default leaking through a half-written rule.
  assert.ok(off.includes(16.75), 'the h1 default margin-top leaks in at 16.75px');
  assert.equal(new Set(off).size, off.length, 'each off-scale value is reported once, not once per page');
});

test('the type scale and its ratio come back', { skip }, async () => {
  const r = await report();
  assert.deepEqual(r.system.type.values.map((v) => v.value), [11, 16, 20, 25]);
  assert.equal(r.system.type.ratio.ratio, 1.25);
  const body = r.system.type.values.find((v) => v.value === 16);
  assert.ok(body.share > 0.5, 'body text carries most of the words');
});

test('no radius anywhere is reported as an absence', { skip }, async () => {
  const r = await report();
  assert.equal(r.system.radius.absent, true);
  assert.ok(r.findings.some((f) => /corner radius/.test(f)));
});

test('own text only: a wrapper does not inherit its children\'s weight', { skip }, async () => {
  // Using textContent would give <body> every character on the page, and the heaviest colour on
  // any site would be whatever the outermost element happened to inherit.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<div style="color:#111111"><p style="color:#222222">the quick brown fox jumps</p></div>');
  const { merged } = await surveyPages([`data:text/html,${encodeURIComponent('<div style="color:#111111"><p style="color:#222222">the quick brown fox jumps</p></div>')}`], { browser });
  await page.close();
  const wrapper = merged.textColor.filter((s) => s.value === '#111111');
  assert.equal(wrapper.length, 0, `the wrapper has no text of its own: ${JSON.stringify(merged.textColor)}`);
});

test('surveys from several pages merge into one set of samples', { skip }, async () => {
  const a = { textColor: [{ value: '#000000', weight: 1 }], elements: 3 };
  const b = { textColor: [{ value: '#FFFFFF', weight: 2 }], elements: 4 };
  const m = mergeSurveys([a, b]);
  assert.equal(m.elements, 7, 'counts add');
  assert.equal(m.textColor.length, 2, 'samples concatenate');
});

/**
 * A brand that ships its palette in a modern colour syntax must not come back half-measured.
 *
 * `getComputedStyle` returns whatever the author wrote for anything newer than rgb(): Chromium
 * hands back `oklch(0.55 0.15 29)` and `color(display-p3 ...)` verbatim. The first version of the
 * survey matched `rgb()`/`rgba()` only, so those parsed as null and were dropped without a word.
 * On this fixture it found three colours out of eight and reported them as the system — the brand's
 * own accents among the five it threw away. That is the worst failure available to a measuring
 * product: quietly incomplete, confidently stated. Hence the canvas read-back.
 *
 * The expected hexes are the sRGB renderings of the fixture's oklch/p3/lab/oklab values, so this
 * also pins the conversion rather than merely counting what survived.
 */
test('a palette written in oklch, display-p3, lab or oklab is measured, not dropped', { skip }, async () => {
  const { merged } = await surveyPages([pathToFileURL(`${root}test/fixtures/modern-colour.html`).href], { browser });
  const seen = new Set(merged.textColor.concat(merged.ground).map((s) => String(s.value).toUpperCase()));
  for (const [hex, syntax] of [
    ['#B9473B', 'oklch(0.55 0.15 29)'],
    ['#BE4721', 'color(display-p3 0.69 0.31 0.18)'],
    ['#A6503A', 'lab(45% 35 30)'],
    ['#CB856D', 'color-mix(), which computes to oklab()'],
    ['#F9ECE1', 'a ground declared in oklch'],
  ]) {
    assert.ok(seen.has(hex), `${syntax} should resolve to ${hex}: got ${JSON.stringify([...seen])}`);
  }
  // The legacy path still works, including a space-separated rgb() with a slash alpha composited
  // over its ground.
  assert.ok(seen.has('#B86243'), 'rgb(176 80 46 / 0.9) over white');
});

test('a colour the browser cannot parse stays null rather than becoming black', { skip }, async () => {
  // The canvas accepts `currentcolor` and paints it black, having no element to read a colour
  // from, so it is refused before it reaches the canvas. Nonsense is refused by the sentinel pair.
  // Either one silently becoming #000000 would invent a colour the site does not use.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<p style="color:#334455">real</p>');
  const resolves = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const read = (sentinel, value) => { ctx.fillStyle = sentinel; ctx.fillStyle = value; return ctx.fillStyle; };
    return {
      nonsense: read('#000000', 'not-a-colour') === read('#ffffff', 'not-a-colour'),
      real: read('#000000', 'oklch(0.55 0.15 29)') === read('#ffffff', 'oklch(0.55 0.15 29)'),
    };
  });
  await page.close();
  assert.equal(resolves.nonsense, false, 'the sentinel pair must reject an unparseable value');
  assert.equal(resolves.real, true, 'and must accept a real one');
});

test('a page that builds itself after load is surveyed once it has settled', { skip }, async () => {
  // Spectrum's site rendered 57 elements across three pages in the survey of 2026-10-08: the
  // pages build themselves in the browser after `load`, and the survey did not wait. A survey
  // of a shell is a measurement of the shell.
  const late = pathToFileURL(root + 'test/fixtures/site/late.html').href;
  const { pages } = await surveyPages([late], { browser });
  const s = pages[0].survey;
  assert.ok(s.elements >= 40, `the elements added after load are counted: got ${s.elements}`);
  assert.ok(s.textColor.some((t) => t.value === '#B0502E'), 'late-rendered text carries its colour');
  assert.ok(pages[0].settled.ms >= 300, `settling waited for the late render: ${JSON.stringify(pages[0].settled)}`);
});

test('a saved survey reproduces its report exactly, with no browser', { skip }, async () => {
  // This is what makes `af drift --save-survey` / `--from-survey` sound, and it is the property
  // the reproducibility claim rests on: measure once on a machine that can reach the site,
  // analyse anywhere, re-run at a different tolerance without going back to a site that has
  // moved underneath the numbers. If the survey did not survive a JSON round trip intact, the
  // replayed report would quietly differ from the one the client was shown.
  const { merged } = await surveyPages(SITE.map((p) => pathToFileURL(root + p).href), { browser });
  merged.pages = 2;
  const live = driftReport(merged);
  const replayed = driftReport(JSON.parse(JSON.stringify(merged)));
  assert.deepEqual(replayed, live, 'a survey that does not survive serialisation cannot be evidence');
  assert.ok(JSON.parse(JSON.stringify(merged)).textColor.length > 0, 'the samples are in the saved file, not just the totals');
});

test('close browser', { skip }, async () => {
  await browser.close();
});
