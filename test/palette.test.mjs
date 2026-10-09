import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorHex, colorLike } from '../src/lib/tokens.mjs';
import { derivePalette, toOverlay, ROLE_TO_TOKEN, hslToHex, hexToHsl } from '../src/lib/palette.mjs';
import { contrast } from '../src/lib/contrast.mjs';

test('hsl round-trips', () => {
  assert.equal(hslToHex(0, 0, 1), '#FFFFFF');
  assert.equal(hslToHex(0, 0, 0), '#000000');
  const h = hexToHsl('#B0502E');
  assert.ok(Math.abs(h.h - 17) < 2 && h.s > 0.5);
});

test('a derived palette satisfies every floor for several hues and papers', () => {
  for (const [hue, paper] of [[210, '#F4F7FA'], [120, '#F3F7F0'], [280, '#F7F3FA'], [17, '#F9F4EB'], [45, '#FBF7EE']]) {
    const p = derivePalette({ hue, paper });
    const c = p.colors;
    assert.ok(contrast(c.primary, paper) >= 4.5, `${hue} primary on paper`);
    assert.ok(contrast(c['primary-deep'], '#FFFFFF') >= 7, `${hue} deep on white`);
    assert.ok(contrast(c['primary-light'], c.ink) >= 4.5, `${hue} light on ink`);
    assert.ok(contrast(c.muted, paper) >= 4.5 && contrast(c.muted, c.sand) >= 4.5, `${hue} muted`);
    assert.ok(contrast(c.paper, c.ink) >= 7 && contrast(c.paper, c.espresso) >= 4.5, `${hue} paper on grounds`);
    assert.ok(contrast(c['text-ii'], '#FFFFFF') >= 7, `${hue} text-ii`);
    assert.ok(contrast(c.positive, '#FFFFFF') >= 4.5 && contrast(c.critical, '#FFFFFF') >= 4.5 && contrast(c['caution-deep'], '#FFFFFF') >= 4.5, `${hue} semantics`);
    assert.ok(contrast(c.ink, c.focus) >= 4.5, `${hue} focus`);
    assert.ok(contrast(c['soft-light'], c.espresso) >= 4.5 && contrast(c['soft-light'], c.ink) >= 4.5, `${hue} soft-light on dark grounds`);
    assert.ok(contrast(c['soft-deep'], '#FFFFFF') >= 4.5 && contrast(c['soft-deep'], c.sand) >= 4.5, `${hue} soft-deep on light grounds`);
    assert.ok(contrast(c['support-deep'], c.sand) >= 4.5, `${hue} support-deep on sand`);
    assert.ok(contrast(c.soft, c.ink) >= 3, `${hue} soft as a mark on ink`);
    assert.equal(p.register.ii.link, c['primary-deep']);
    assert.equal(p.register['ii-dark'].link, c['primary-light']);
  }
});

test('the Applied Form hue and paper reproduce a palette in the same family', () => {
  const p = derivePalette({ hue: 17, paper: '#F9F4EB', saturation: 0.59 });
  const h = hexToHsl(p.colors.primary);
  assert.ok(Math.abs(h.h - 17) < 1);
  assert.ok(contrast(p.colors.primary, '#F9F4EB') >= 4.5);
});

test('an impossible brand is refused with reasons', () => {
  assert.throws(() => derivePalette({ hue: 210, paper: '#888888' }), (e) => /too dark/.test(e.message) && Array.isArray(e.reasons));
});

test('derivation is deterministic', () => {
  assert.deepEqual(derivePalette({ hue: 200, paper: '#F2F6F8' }).colors, derivePalette({ hue: 200, paper: '#F2F6F8' }).colors);
});

test('toOverlay emits the derived roles under system colour names, and nothing else', () => {
  const p = derivePalette({ hue: 285, paper: '#F7F4FA' });
  const o = toOverlay(p, { name: 'Lilac Press', key: 'lilac', wordmark: 'brands/lilac/wordmark.svg' });
  assert.deepEqual(Object.keys(o).sort(), ['$description', '$extensions', 'color']);
  assert.equal(o.$extensions['form.applied'].brand.name, 'Lilac Press');
  assert.equal(colorHex(o.color.terracotta.$value), p.colors.primary, 'the accent lands on the terracotta token');
  assert.equal(colorHex(o.color['terra-deep'].$value), p.colors['primary-deep']);
  assert.equal(colorHex(o.color['clay-light'].$value), p.colors['soft-light']);
  assert.equal(colorHex(o.color['teal-deep'].$value), p.colors['support-deep']);
  assert.ok(!('register' in o), 'registers reach the colours through the base file aliases');
  assert.ok(!('font' in o), 'a derived brand inherits the type voices');
  for (const token of Object.values(ROLE_TO_TOKEN)) assert.ok(o.color[token], `${token} is emitted`);
});
