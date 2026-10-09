/**
 * Importing a system authored elsewhere. The fixture is Instrument's real published contract
 * (appliedform/standards, CC BY 4.0), not one written to pass: it has six colours where this
 * system has twenty-three, two voices where this one has three, and a twelve-column grid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromPack, hueOf, PACK_ROLE_TO_TOKEN } from '../src/lib/pack.mjs';
import { contrast } from '../src/lib/contrast.mjs';
import { colorHex } from '../src/lib/tokens.mjs';

const instrument = JSON.parse(readFileSync(new URL('./fixtures/instrument.tokens.json', import.meta.url), 'utf8'));
const hexes = (overlay) => Object.fromEntries(Object.entries(overlay.color).map(([k, v]) => [k, colorHex(v.$value)]));

test('hueOf reads a hue a derivation can be anchored on', () => {
  assert.equal(hueOf('#C8102E'), 350, "Instrument's signal red");
  assert.equal(hueOf('#FFFFFF'), 0, 'a grey has no hue and does not throw');
  assert.equal(hueOf('#00FF00'), 120);
});

test("a real pack's own values survive the import exactly", () => {
  const { overlay, report } = fromPack(instrument, { key: 'instrument' });
  assert.ok(overlay, report.refused.join('; '));
  const c = hexes(overlay);
  // Nothing the pack states is nudged to fit this system's palette.
  assert.equal(c.paper, '#FFFFFF');
  assert.equal(c.ink, '#111111');
  assert.equal(c.muted, '#6B6B6B');
  assert.equal(c.terracotta, '#C8102E', "the pack's signal becomes this system's accent");
  assert.equal(c.sand, '#D8D8D8', 'its rule colour becomes the hairline colour');
  assert.equal(report.stated.length, Object.keys(PACK_ROLE_TO_TOKEN).length);
  assert.deepEqual(overlay.font.text.$value, ['Public Sans', 'system-ui', 'sans-serif']);
  assert.deepEqual(overlay.font.data.$value, ['DM Mono', 'ui-monospace', 'monospace']);
});

test('what the pack cannot state is derived from its own accent, and said so', () => {
  const { overlay, report } = fromPack(instrument, { key: 'instrument' });
  const c = hexes(overlay);
  // A six-colour contract has no chart support colour, no caution and no tint. Those come from
  // the pack's own hue rather than from Applied Form's palette, and none of ours survives.
  for (const token of ['teal', 'caution', 'tint', 'clay']) {
    assert.match(c[token], /^#[0-9A-F]{6}$/);
    assert.ok(report.derived.some((d) => d.startsWith(`${token} `)), `${token} is reported as derived`);
  }
  assert.notEqual(c.teal, '#AC5362', "Applied Form's own support colour does not leak in");
  assert.ok(report.derived.every((d) => d.includes('350°')), 'every derivation is anchored on the pack');
});

test("the imported palette is measured, not trusted, and holds the floors", () => {
  const { overlay, report } = fromPack(instrument, { key: 'instrument' });
  const c = hexes(overlay);
  assert.deepEqual(report.refused, []);
  // Instrument's own documentation states its red passes at 5.88:1 on white. Measured here,
  // independently, it does — which is the check an import has to survive.
  assert.equal(contrast(c.terracotta, c.paper).toFixed(2), '5.88');
  assert.ok(contrast(c.ink, c.paper) >= 4.5);
  assert.ok(contrast(c.muted, c.paper) >= 4.5);
  assert.equal(report.notes.length, 4, 'every measurement taken is reported');
});

test('what cannot be carried across is reported rather than quietly dropped', () => {
  const { report } = fromPack(instrument, { key: 'instrument' });
  const carried = report.carried.join('\n');
  assert.match(carried, /no display voice/, 'a two-voice pack cannot fill Register I');
  assert.match(carried, /12 columns/, 'its grid is not this one, and the grid is not yet a parameter');
  assert.match(carried, /radius 0/, 'its radius agrees with this system, and that is stated too');
});

test('a pack whose accent fails the floor is refused with the measurement', () => {
  const bad = JSON.parse(JSON.stringify(instrument));
  bad.colour.muted.value = '#CFCFCF';   // 1.62:1 on white
  const { overlay, report } = fromPack(bad, { key: 'bad' });
  assert.equal(overlay, null, 'no overlay is emitted');
  assert.equal(report.refused.length, 1);
  assert.match(report.refused[0], /muted text on the ground measures 1\.\d\d:1, below the 4\.5:1 floor/);
});

test('a pack missing the two anchors is refused before anything is derived', () => {
  const { overlay, report } = fromPack({ system: 'Nameless', colour: { ink: { value: '#000000' } } });
  assert.equal(overlay, null);
  assert.match(report.refused[0], /no signal or no ground/);
});
