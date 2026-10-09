import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, luminance, hexToRgb, isLargeText, requiredContrast, passes, safeVariant, apca } from '../src/lib/contrast.mjs';
import { colors, registers, floors, fallbacks, colorName, chartSeries, chartSeriesOnLight, chart } from '../src/lib/tokens.mjs';

const c = colors;

test('contrast maths matches WCAG reference values', () => {
  assert.equal(contrast('#000000', '#FFFFFF'), 21);
  assert.equal(contrast('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(luminance('#FFFFFF'), 1);
  assert.equal(luminance('#000000'), 0);
  assert.deepEqual(hexToRgb('#B0502E'), [176, 80, 46]);
  assert.throws(() => hexToRgb('#12'), /Bad hex/);
  assert.ok(Math.abs(contrast('#777777', '#FFFFFF') - 4.48) < 0.01);
});

test('large-text threshold: 24px regular or 18.66px bold', () => {
  assert.equal(isLargeText(24), true);
  assert.equal(isLargeText(23.9), false);
  assert.equal(isLargeText(19, 700), true);
  assert.equal(isLargeText(18, 700), false);
  assert.equal(requiredContrast(19), 4.5);
  assert.equal(requiredContrast(48), 3);
});

test('primary text passes the body floor on its register background', () => {
  assert.ok(contrast(registers.i.text, registers.i.background) >= floors.bodyContrast);
  assert.ok(contrast(registers.ii.text, registers.ii.background) >= floors.bodyContrast);
  assert.ok(contrast(registers.i.text, registers.i.layer) >= floors.bodyContrast);
  assert.ok(contrast(registers.ii.text, registers.ii.layer) >= floors.bodyContrast);
});

test('link colours pass the body floor on their register background', () => {
  assert.ok(contrast(registers.i.link, registers.i.background) >= floors.bodyContrast, 'terracotta on paper');
  assert.ok(contrast(registers.ii.link, registers.ii.background) >= floors.bodyContrast, 'terra deep on white');
});

test('muted text passes body contrast on paper, white and both layers', () => {
  for (const bg of [c.paper, c.white, c.sand, c['layer-ii']]) {
    assert.ok(contrast(c.muted, bg) >= floors.bodyContrast, `muted on ${bg}`);
  }
});

test('light text on every Register I full-bleed ground passes the body floor', () => {
  for (const ground of registers.i.grounds) {
    assert.ok(contrast(c.paper, ground) >= floors.bodyContrast, `paper on ${ground}`);
    assert.ok(contrast(c.white, ground) >= floors.bodyContrast, `white on ${ground}`);
  }
});

test('focus: ink on the focus yellow passes body contrast', () => {
  assert.ok(contrast(c.ink, c.focus) >= floors.bodyContrast);
});

test('semantic colours as text on white: positive and critical pass, caution fails', () => {
  assert.ok(passes(c.positive, c.white, 19));
  assert.ok(passes(c.critical, c.white, 19));
  assert.ok(!passes(c.caution, c.white, 19), 'caution is a fill, never small text');
  assert.ok(!passes(c.caution, c.paper, 19));
});

test('clay-light is the fix for small clay text on dark grounds', () => {
  assert.ok(contrast(c['clay-light'], c.espresso) >= floors.bodyContrast);
  assert.ok(contrast(c['clay-light'], c.ink) >= floors.bodyContrast);
});

test('terracotta and teal fail 4.5:1 on sand; terra deep and teal deep are the fixes', () => {
  assert.ok(contrast(c.terracotta, c.sand) < floors.bodyContrast);
  assert.ok(contrast(c.teal, c.sand) < floors.bodyContrast);
  assert.ok(contrast(c['terra-deep'], c.sand) >= floors.bodyContrast);
  assert.ok(contrast(c['teal-deep'], c.sand) >= floors.bodyContrast);
});

test('every deep variant passes body contrast on white, paper and sand', () => {
  for (const name of ['terra-deep', 'teal-deep', 'clay-deep', 'caution-deep']) {
    for (const bg of ['white', 'paper', 'sand']) {
      assert.ok(contrast(c[name], c[bg]) >= floors.bodyContrast, `${name} on ${bg} = ${contrast(c[name], c[bg]).toFixed(2)}`);
    }
  }
});

test('safeVariant returns the colour when it passes and the first passing fallback when it does not', () => {
  const opts = { fallbacks, colorName, floors };
  assert.equal(safeVariant(c.ink, c.paper, 19, 400, opts), c.ink);
  assert.equal(safeVariant(c.terracotta, c.sand, 17, 400, opts), c['terra-deep']);
  assert.equal(safeVariant(c.teal, c.sand, 17, 400, opts), c['teal-deep']);
  assert.equal(safeVariant(c.caution, c.white, 19, 400, opts), c['caution-deep']);
  assert.equal(safeVariant(c.clay, c.espresso, 15, 400, opts), c['clay-light'], 'dark ground: the light variant');
  assert.equal(safeVariant(c.clay, c.white, 15, 400, opts), c['clay-deep'], 'light ground: the deep variant');
  assert.equal(safeVariant(c.terracotta, c.sand, 48, 400, opts), c.terracotta, 'large text already passes 3:1');
  assert.equal(safeVariant(c.clay, c.terracotta, 15, 400, opts), null, 'no variant rescues clay on terracotta');
});

test('every fallback clears the floor its base colour fails', () => {
  assert.ok(contrast(c['clay-light'], c.espresso) >= floors.bodyContrast);
  assert.ok(contrast(c['clay-deep'], c.white) >= floors.bodyContrast);
  assert.ok(contrast(c['caution-deep'], c.white) >= floors.bodyContrast);
});

test('brand chart series: terracotta and teal are near-equal luminance, so series are always labelled directly', () => {
  assert.ok(contrast(c.terracotta, c.teal) < chart.minNeighbourContrast);
});

test('seriesOnLight keeps the brand order and every colour clears 3:1 on white and paper', () => {
  assert.equal(chartSeriesOnLight.length, chartSeries.length);
  assert.deepEqual(chartSeriesOnLight, [c.terracotta, c.teal, c['clay-deep'], c.espresso, c['caution-deep']]);
  for (const bg of [c.white, c.paper]) {
    for (const hex of chartSeriesOnLight) {
      assert.ok(contrast(hex, bg) >= chart.minMarkContrast, `${colorName(hex)} on ${bg}`);
    }
  }
});

test('APCA matches the published reference values', () => {
  // Reference pairs from the APCA-W3 0.1.9 test suite.
  const close = (a, b) => Math.abs(a - b) < 0.1;
  assert.ok(close(apca('#888888', '#FFFFFF'), 63.056), apca('#888888', '#FFFFFF'));
  assert.ok(close(apca('#FFFFFF', '#888888'), -68.54), apca('#FFFFFF', '#888888'));
  assert.ok(close(apca('#000000', '#AAAAAA'), 58.146), apca('#000000', '#AAAAAA'));
  assert.ok(close(apca('#AAAAAA', '#000000'), -56.24), apca('#AAAAAA', '#000000'));
  assert.ok(close(apca('#112233', '#DDEEFF'), 91.66), apca('#112233', '#DDEEFF'));
  assert.ok(close(apca('#DDEEFF', '#112233'), -93.06), apca('#DDEEFF', '#112233'));
  assert.equal(apca('#777777', '#777777'), 0);
});

test('APCA advisory: register text passes 60 Lc on its background, muted passes the 45 large-text advisory everywhere', () => {
  assert.ok(Math.abs(apca(registers.i.text, registers.i.background)) >= floors.apcaBodyAdvisory);
  assert.ok(Math.abs(apca(registers.ii.text, registers.ii.background)) >= floors.apcaBodyAdvisory);
  assert.ok(Math.abs(apca(registers.ii.link, registers.ii.background)) >= floors.apcaBodyAdvisory, 'terra deep on white');
  for (const bg of [c.paper, c.white, c.sand, c['layer-ii']]) assert.ok(Math.abs(apca(c.muted, bg)) >= floors.apcaLargeAdvisory, `muted on ${bg}`);
});

test('dark surface: light variants clear 4.5:1 on ink and espresso, and safeVariant reaches them', () => {
  for (const name of ['positive-light', 'critical-light', 'teal-light', 'terracotta-light']) {
    for (const bg of ['ink', 'espresso']) assert.ok(contrast(c[name], c[bg]) >= floors.bodyContrast, `${name} on ${bg}`);
  }
  const opts = { fallbacks, colorName, floors };
  assert.equal(safeVariant(c.terracotta, c.ink, 19, 400, opts), c['terracotta-light']);
  assert.equal(safeVariant(c.positive, c.ink, 19, 400, opts), c['positive-light']);
  assert.equal(safeVariant(c.critical, c.espresso, 19, 400, opts), c['critical-light']);
  assert.equal(safeVariant(c.caution, c.ink, 19, 400, opts), c.caution, 'caution itself passes on ink');
});

test('register ii-dark: every role passes its floor on ink', () => {
  const d = registers['ii-dark'];
  assert.equal(d.background, c.ink);
  assert.ok(contrast(d.text, d.background) >= floors.bodyContrast);
  assert.ok(contrast(d.link, d.background) >= floors.bodyContrast);
  assert.ok(contrast(d.support, d.background) >= floors.bodyContrast);
  assert.ok(contrast(c.ink, d.focus) >= floors.bodyContrast);
});
