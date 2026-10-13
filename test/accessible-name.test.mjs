/**
 * A figure svg named by aria-labelledby has an accessible name.
 *
 * alt-missing accepted only aria-label or a child <title>. aria-labelledby pointing at visible text is
 * the better pattern for a chart with a printed title, and on engine5 it was how 15 of the 28 chart
 * svgs that a moved data-figure would make eligible were named — scoring them as unnamed would fail
 * correct markup on a scored held-out rule. A reference that resolves to nothing is still no name.
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

const altMissing = async (svgAttrs) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-name-'));
  const file = join(dir, 'p.html');
  writeFileSync(file, `<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>Chart</title></head><body><main><h2 id="t">Weekly sign-ups</h2><p id="empty"></p><svg data-figure="plot" data-generated="line-chart" width="300" height="150" ${svgAttrs}><path d="M0 100L300 20" stroke="black"/></svg></main></body></html>`);
  const [r] = await lintPages([pathToFileURL(file).href], { browser, viewports: [1280], fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
  return r.violations.some((v) => v.rule === 'alt-missing');
};

test('aria-labelledby that resolves to text names a figure svg; one that resolves to nothing does not', { skip }, async () => {
  assert.equal(await altMissing('aria-labelledby="t"'), false, 'named by the visible heading');
  assert.equal(await altMissing('aria-labelledby="missing empty"'), true, 'a dangling or empty reference is no name');
  assert.equal(await altMissing(''), true, 'control: no name at all');
});

/**
 * `alt-missing` must decide "is this a figure" from what the svg IS, not from what the page
 * declared it to be. It read `data-figure`, which `markupContract()` tells the engine's arms to
 * write and the study's arms never see, so a disclosed instruction decided whether a scored,
 * held-out rule could fire at all. These pin the behaviour that has to survive closing that
 * channel: a genuinely decorative graphic is still excused, and one whose content is words is not.
 */
const rulesFor = async (svg) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-figure-'));
  const file = join(dir, 'p.html');
  writeFileSync(file, `<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>Chart</title></head><body><main><h2>Weekly sign-ups</h2>${svg}</main></body></html>`);
  const [r] = await lintPages([pathToFileURL(file).href], { browser, viewports: [1280], fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
  return r.violations.map((v) => v.rule);
};

test('an svg is named or hidden on its own merits, not because it was declared', { skip }, async (t) => {
  t.after(() => browser.close());
  const svg = (attrs, inner = '<path d="M0 100L300 20" stroke="black"/>') =>
    `<svg ${attrs} width="300" height="150">${inner}</svg>`;

  // Undeclared, unnamed, not hidden: a graphic perceivable only by eye. Must fire.
  assert.ok((await rulesFor(svg(''))).includes('alt-missing'), 'an unnamed, unhidden svg needs a name whether or not it was declared');

  // Declared, unnamed, not hidden: fired before the change and must keep firing.
  assert.ok((await rulesFor(svg('data-figure="plot" data-generated="line-chart"'))).includes('alt-missing'));

  // Decorative and properly hidden, carrying no words: the rule's own stated escape. Must NOT fire.
  assert.ok(!(await rulesFor(svg('aria-hidden="true"'))).includes('alt-missing'), 'aria-hidden is an acceptable answer for a figure that carries no information');

  // Named, declared or not: must not fire.
  assert.ok(!(await rulesFor(svg('aria-label="Weekly sign-ups"'))).includes('alt-missing'));
  assert.ok(!(await rulesFor(svg('', '<title>Weekly sign-ups</title><path d="M0 100L300 20" stroke="black"/>'))).includes('alt-missing'));

  // Content is words, hidden anyway: hiding content is not describing it. Must fire.
  assert.ok((await rulesFor(svg('aria-hidden="true"', '<text x="4" y="20">Sign-ups rose sharply in the final quarter of the year</text>'))).includes('alt-missing'),
    'aria-hidden must not excuse an svg whose content is words');
});
