/**
 * The gate beside axe-core and stylelint on the two fixtures whose defects were planted on purpose.
 *
 * These numbers are quoted as the first comparison in this repository
 * made by running third-party instruments rather than by reading about them. A quoted number that
 * nothing measures rots; this holds the shape of the result rather than the exact figures, because
 * both instruments' rule sets move with their releases and a bump should not fail the build for a
 * reason that is not ours.
 *
 * The shape is: on a page of planted design-system defects the gate reports many rules, axe
 * reports few, and stylelint reports the literals typed into the page's own `<style>` block and
 * nothing the browser computed. On the attack fixture axe sees the two attacks that are
 * accessibility defects and not the two that are not, and stylelint sees none of the four, because
 * none of them is a value in a stylesheet. If any of this stops being true, either a third-party
 * tool has grown a design-system conformance checker, which would be news, or the gate has lost
 * rules, which would be a defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { compare, authoredCss } from '../eval/compare.mjs';

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).href;
const example = (name) => new URL(`../examples/${name}`, import.meta.url).href;

test('the static tier reads authored CSS only: style blocks and local sheets, never the generated token definitions', () => {
  const { sources, code } = authoredCss(fixture('violations.html'));
  assert.equal(sources, 1, 'the fixture links two generated sheets and has one style block; only the block is authored');
  assert.match(code, /box-shadow/);
  assert.ok(!/--af-color-ink:/.test(code), 'a token definition is not authored CSS');
  assert.equal(authoredCss('https://example.com/').sources, 0, 'a live URL has no authored CSS on disk to read');
});

test('on the planted-defect fixture the gate reports an order of magnitude more rules than either instrument', { skip }, async () => {
  const r = await compare(fixture('violations.html'), browser);
  const gateRules = Object.keys(r.gate.rules).length;
  const axeRules = Object.keys(r.axe.rules).length;
  const stylelintRules = Object.keys(r.stylelint.rules).length;
  assert.ok(gateRules >= 25, `the gate found ${gateRules} rules; the fixture plants more than twenty-five`);
  assert.ok(axeRules <= 3, `axe-core found ${axeRules} rules on a page of design-system defects`);
  assert.ok(stylelintRules <= 5 && r.stylelint.count >= 10, `stylelint found ${r.stylelint.count} warnings under ${stylelintRules} rules: it sees the literals and groups them under a handful of rules`);
  // The one defect axe does see, the gate sees too: an image with no alt text.
  if (r.axe.rules['image-alt']) assert.ok(r.gate.rules['alt-missing'], 'axe saw a missing alt that the gate did not');
  // The literals stylelint sees are the ones the gate reports as absences and off-palette colour.
  assert.ok(r.stylelint.rules['color-no-hex'], 'the fixture types hex colours and stylelint should see them');
  assert.ok(r.stylelint.rules['declaration-property-value-disallowed-list'], 'the shadow, the radius and the gradient are literals in the style block');
});

test('on the attack fixture axe sees the two accessibility attacks, stylelint sees none, and the gate sees all four', { skip }, async () => {
  const r = await compare(fixture('attacks.html'), browser);
  for (const rule of ['content-not-dom', 'offset-off-grid', 'hidden-interactive', 'alt-missing']) {
    assert.ok(r.gate.rules[rule], `${rule} did not fire`);
  }
  // Attack 6 is an accessibility defect and axe should catch it; it is not a reason to think the
  // gate is redundant, it is a reason to trust the fixture.
  assert.ok(r.axe.rules['aria-hidden-focus'], 'axe should see the focusable control under aria-hidden');
  assert.ok(r.axe.rules['svg-img-alt'], 'axe should see the unnamed SVG figure');
  // Attacks 3 and 4 are design-system defects and nothing in axe is built to see them.
  const ids = Object.keys(r.axe.rules).join(' ');
  assert.ok(!/canvas|position|offset|grid/.test(ids), `axe reported ${ids}, which looks like a design-system rule`);
  // A canvas, an aria attribute and an absolutely placed element are not values in a stylesheet.
  // What stylelint does report here is the system-ui font and two hex colours the fixture types,
  // which are real literals and not attacks.
  for (const id of Object.keys(r.stylelint.rules)) assert.match(id, /^(scale-unlimited\/declaration-strict-value|color-no-hex)$/, `stylelint reported ${id} on the attack page`);
});

const cleanIsClean = async (url) => {
  const r = await compare(url, browser);
  assert.equal(r.gate.count, 0);
  assert.equal(r.axe.count, 0);
  assert.equal(r.stylelint.count, 0, `stylelint found ${JSON.stringify(r.stylelint.rules)} in authored CSS the gate accepts`);
};

test('a page the gate finds clean is clean for axe and for the static tier', { skip }, () => cleanIsClean(fixture('clean.html')));

// The reference pages are the system's identity and are not part of the open distribution
// (decision 0023); where they are present, the claim is held on the real thing as well.
const reference = new URL('../examples/register-ii.html', import.meta.url);
test('so is a reference page', { skip: skip || (!existsSync(reference) && 'the reference pages are not in this distribution') }, () => cleanIsClean(example('register-ii.html')));

test('close browser', { skip }, async () => { await browser.close(); });
