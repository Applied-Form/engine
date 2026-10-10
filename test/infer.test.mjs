/**
 * The inference behind `af drift`, tested without a browser.
 *
 * Everything here is pure arithmetic over weighted samples, which is deliberate: the survey needs
 * Chromium, but deciding what counts as a token, a step or a mistake does not, and those are the
 * decisions a client will argue with. They are tested against inputs whose right answer is known
 * by construction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { srgbToLab, deltaE, nearest, paletteDistance, JND } from '../src/lib/lab.mjs';
import { inferPalette, inferStep, clusterNumeric, scaleRatio, inferAbsence } from '../src/lib/infer.mjs';
import { driftReport } from '../src/lib/drift.mjs';

const w = (value, weight) => ({ value, weight });

test('Lab distance tracks perception, not bytes', () => {
  // A hand-typed hex one digit out is one colour and a typo, and must measure as such.
  assert.ok(deltaE('#B0512E', '#B0502E') < JND, 'a one-digit typo must fall inside the JND');
  assert.equal(Math.round(deltaE('#000000', '#FFFFFF')), 100);
  assert.equal(deltaE('#FFFFFF', '#FFFFFF'), 0);
  // Symmetric, or "nearest" depends on argument order.
  assert.equal(deltaE('#123456', '#654321'), deltaE('#654321', '#123456'));
});

test('a colour that is not a colour returns null rather than zero', () => {
  // A survey of a real site hands back `transparent` and `currentcolor`. Coercing those to 0
  // would report them as sitting exactly on palette, which is the opposite of the truth.
  for (const bad of ['transparent', 'currentcolor', '', null, undefined, '#GGG', 'rgb(0,0,0)']) {
    assert.equal(srgbToLab(bad), null, `${bad} is not a hex`);
    assert.equal(deltaE(bad, '#FFFFFF'), null);
  }
  assert.equal(nearest('nonsense', ['#FFFFFF']), null);
  assert.equal(paletteDistance('#FFFFFF', []), null, 'no palette is not the same as on palette');
});

test('a palette is the few colours that carry the page, and the rest are named as mistakes', () => {
  const p = inferPalette([
    w('#FFFFFF', 1000), w('#1B1716', 400), w('#B0502E', 100),
    w('#B0512E', 3),    // indistinguishable from the accent
    w('#00FF00', 1),    // real, and too slight to be a decision
  ]);
  assert.deepEqual(p.tokens.map((t) => t.value), ['#FFFFFF', '#1B1716', '#B0502E']);
  assert.equal(p.nearMisses.length, 1);
  assert.equal(p.nearMisses[0].value, '#B0512E');
  assert.equal(p.nearMisses[0].nearestToken, '#B0502E');
  assert.equal(p.distinct, 5);
  assert.deepEqual(p.tail.map((t) => t.value), ['#00FF00']);
});

test('the palette stops on insignificance, not on cumulative coverage', () => {
  // The first version stopped once 95% of the weight was explained. A page is mostly its
  // background, so it stopped after one token and never found the accent — the colour a brand
  // is actually recognised by. This is that regression.
  const p = inferPalette([w('#FFFFFF', 100000), w('#B0502E', 900), w('#1B1716', 900)]);
  assert.ok(p.tokens.length >= 3, `expected the accent to survive a huge ground, got ${JSON.stringify(p.tokens.map((t) => t.value))}`);
  assert.ok(p.tokens.map((t) => t.value).includes('#B0502E'));
});

test('the palette honours its budget and its floor', () => {
  // Spread around the hue circle: forty blues one red step apart are one colour, correctly, and
  // would test nothing but the clustering.
  const many = Array.from({ length: 40 }, (_, i) => {
    const [r, g, b] = [0, 1, 2].map((k) => Math.round(127 + 127 * Math.sin((i / 40) * 2 * Math.PI + (k * 2 * Math.PI) / 3)));
    return w(`#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`, 100 - i);
  });
  assert.equal(inferPalette(many, { maxTokens: 5 }).tokens.length, 5);
  // Everything under the floor is the tail by definition, so nothing below it becomes a token.
  const floored = inferPalette([w('#FFFFFF', 1000), w('#FF0000', 1)], { minShare: 0.01 });
  assert.deepEqual(floored.tokens.map((t) => t.value), ['#FFFFFF']);
  assert.deepEqual(floored.tail.map((t) => t.value), ['#FF0000']);
});

test('an empty or unusable survey reports nothing rather than inventing a system', () => {
  for (const empty of [[], null, undefined, [w('transparent', 5)], [w('#FFFFFF', 0)], [w('#FFFFFF', NaN)]]) {
    const p = inferPalette(empty);
    assert.deepEqual(p.tokens, [], JSON.stringify(empty));
    assert.equal(p.coverage, 0);
  }
});

test('the spacing step is the largest that explains the values, not the smallest', () => {
  // 1px, 2px and 4px all explain an 8px system perfectly. Only one of them is the decision.
  const s = inferStep([w(8, 10), w(16, 10), w(24, 5), w(32, 5)]);
  assert.equal(s.step, 8);
  assert.equal(s.onScale, true);
  assert.equal(s.coverage, 1);
});

test('off-scale spacing is grouped by value, not listed once per occurrence', () => {
  const s = inferStep([w(8, 50), w(16, 50), w(13, 1), w(13, 1), w(13, 1)]);
  assert.equal(s.step, 8);
  const thirteen = s.offScale.filter((o) => o.value === 13);
  assert.equal(thirteen.length, 1, 'one off-scale value used three times is one finding');
  assert.equal(thirteen[0].weight, 3);
  assert.equal(thirteen[0].off, 3);
});

test('a site with no spacing system says so instead of asserting one', () => {
  const s = inferStep([w(3, 1), w(7, 1), w(11, 1), w(19, 1), w(23, 1), w(29, 1)]);
  assert.equal(s.onScale, false, 'nothing should clear the target');
  assert.ok(s.step !== null, 'the closest candidate is still reported, because a shrug is not a finding');
  assert.ok(s.coverage < 0.9);
});

test('a 2px or 3px step is not a finding: the smallest step named is 4px', () => {
  // Almost every integer a browser renders is even, so a 2px step clears the target on nearly any
  // site and says nothing. The nine-system survey of 2026-10-08 named 2px for five of them. A site
  // of even values with no coarser structure has no spacing system the instrument can see.
  const s = inferStep([w(6, 1), w(10, 1), w(14, 1), w(18, 1), w(22, 1), w(26, 1)]);
  assert.equal(s.onScale, false, 'nothing from 4px up explains these');
  assert.ok(s.step >= 4, `the candidate named must be at least 4px, got ${s.step}`);
  assert.ok(s.considered.every((c) => c.step >= 4), 'no candidate below 4px is scored as a step');
  // The fine steps are still measured, so the report can say what 2px would have explained.
  assert.equal(s.fine.find((f) => f.step === 2).coverage, 1);
});

test('a 4px system is still found when 2px would also explain it', () => {
  const s = inferStep([w(4, 5), w(12, 5), w(20, 5), w(28, 5)]);
  assert.equal(s.step, 4);
  assert.equal(s.onScale, true);
});

test('numeric clusters merge within tolerance and flag what is too slight to be a step', () => {
  const c = clusterNumeric([w(16, 1000), w(16.2, 50), w(20, 300), w(11, 2)], { tolerance: 0.5, minShare: 0.01 });
  assert.deepEqual(c.values.map((v) => v.value), [11, 16, 20]);
  assert.equal(c.values.find((v) => v.value === 16).members, 2, '16 and 16.2 are one size');
  assert.deepEqual(c.incidental.map((v) => v.value), [11]);
  assert.equal(c.distinct, 4, 'distinct counts what was rendered, before any merging');
});

test('a type scale ratio needs three sizes and reports how far the sizes stray from it', () => {
  assert.equal(scaleRatio([16, 20, 25, 31.25]).ratio, 1.25);
  assert.equal(scaleRatio([16, 20, 25, 31.25]).spread, 0);
  assert.equal(scaleRatio([16, 20]).ratio, null, 'two sizes are not a scale');
  assert.ok(scaleRatio([16, 20, 25, 40]).spread > 0, 'a stray size widens the spread');
});

test('no radius anywhere is an absence, which is a decision, not a gap', () => {
  assert.equal(inferAbsence([w(0, 50), w(0, 20)]).absent, true);
  const present = inferAbsence([w(4, 10), w(8, 5)]);
  assert.equal(present.absent, false);
  assert.equal(present.scale.length, 2);
});

test('a full-page ground cannot outvote every word on the page', () => {
  // Ground weight is area and text weight is characters, so a single background arrives three
  // orders of magnitude heavier than all the type. Pooled raw, the first run of this reported
  // one token — #FFFFFF at 96% — and found no accent. The roles are normalised before pooling.
  const report = driftReport({
    ground: [{ value: '#FFFFFF', weight: 1152000 }],
    textColor: [{ value: '#222222', weight: 800 }, { value: '#B0502E', weight: 120 }],
    borderColor: [], spacing: [], fontSize: [], fontFamily: [], lineHeight: [],
    radius: [], borderWidth: [], shadow: [], elements: 10, textElements: 5,
  });
  const values = report.system.colour.tokens.map((t) => t.value);
  assert.ok(values.includes('#B0502E'), `the accent must survive the ground: ${JSON.stringify(values)}`);
  assert.ok(values.includes('#FFFFFF') && values.includes('#222222'));
});

test('waste is reported as a share of the same total the palette was inferred in', () => {
  // Dividing a normalised near-miss weight by the raw survey total reported 0% waste on a page
  // that provably had two near-misses. A wrong number is worse than a missing one.
  const report = driftReport({
    ground: [{ value: '#FFFFFF', weight: 100000 }],
    textColor: [{ value: '#222222', weight: 900 }, { value: '#232323', weight: 100 }],
    borderColor: [], spacing: [], fontSize: [], fontFamily: [], lineHeight: [],
    radius: [], borderWidth: [], shadow: [], elements: 10, textElements: 5,
  });
  assert.equal(report.numbers.wasteValues, 1);
  assert.ok(report.numbers.wasteShare > 0, 'a near-miss that exists must carry a share above zero');
});

test('a declared palette is compared in both directions', () => {
  const report = driftReport({
    ground: [{ value: '#FFFFFF', weight: 1000 }],
    textColor: [{ value: '#222222', weight: 500 }],
    borderColor: [], spacing: [], fontSize: [], fontFamily: [], lineHeight: [],
    radius: [], borderWidth: [], shadow: [], elements: 4, textElements: 2,
  }, { declared: ['#FFFFFF', '#222222', '#00AA55'] });
  assert.equal(report.declared.adherence, 100);
  assert.deepEqual(report.declared.undeclared, []);
  assert.deepEqual(report.declared.unused, ['#00AA55'], 'a token nobody renders is as much a finding as a colour nobody declared');
});

test('a site with only a 2px step is told so, and 2px is not called its system', () => {
  const report = driftReport({
    ground: [{ value: '#FFFFFF', weight: 1000 }],
    textColor: [{ value: '#222222', weight: 500 }],
    borderColor: [], spacing: [6, 10, 14, 18, 22, 26].map((value) => ({ value, weight: 1 })),
    fontSize: [{ value: 16, weight: 400 }], fontFamily: [], lineHeight: [],
    radius: [], borderWidth: [], shadow: [], elements: 9, textElements: 3,
  });
  assert.equal(report.system.spacing.onScale, false);
  assert.ok(report.system.spacing.step >= 4);
  const sentence = report.findings.find((f) => f.startsWith('Spacing follows no consistent step'));
  assert.ok(sentence, JSON.stringify(report.findings));
  assert.match(sentence, /A 2px step would explain 100%, which is not a spacing system\./);
});

test('every finding carries the measurement that produced it', () => {
  const report = driftReport({
    ground: [{ value: '#FFFFFF', weight: 1000 }],
    textColor: [{ value: '#222222', weight: 500 }, { value: '#232323', weight: 30 }],
    borderColor: [], spacing: [{ value: 8, weight: 5 }, { value: 16, weight: 5 }],
    fontSize: [{ value: 16, weight: 400 }], fontFamily: [], lineHeight: [],
    radius: [{ value: 0, weight: 9 }], borderWidth: [], shadow: [], elements: 9, textElements: 3,
  });
  assert.ok(report.findings.length > 0);
  for (const f of report.findings) {
    assert.match(f, /\d/, `a finding with no number in it is an opinion: "${f}"`);
    assert.match(f, /\.$/, `findings are sentences: "${f}"`);
  }
});
