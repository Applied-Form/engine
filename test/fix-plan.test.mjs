import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFixes, FIXABLE, snap } from '../src/lib/fix/plan.mjs';
import { colors, spacingScale, floors } from '../src/lib/tokens.mjs';

const result = (violations, spec = {}) => [{ spec, violations }];

test('each fixable rule becomes a declaration on the element it names', () => {
  const p = planFixes(result([
    { rule: 'radius-present', absence: { afId: '4' } },
    { rule: 'shadow-present', absence: { afId: '4' } },
    { rule: 'link-not-underlined', link: { afId: '9' } },
    { rule: 'target-size', target: { afId: '11', display: 'inline' } },
    { rule: 'focus-hidden', focus: { afId: '11' } },
  ]));
  // One patch per element per rule, so a rule's fixes can be rolled back without taking another's.
  const by = Object.fromEntries(p.map((x) => [`${x.afId}${x.pseudo}|${x.rules.join()}`, x]));
  assert.deepEqual(by['4|radius-present'].decl, { 'border-radius': '0' });
  assert.deepEqual(by['4|shadow-present'].decl, { 'box-shadow': 'none' });
  assert.equal(by['9|link-not-underlined'].decl['text-decoration-line'], 'underline');
  assert.equal(by['11|target-size'].decl.display, 'inline-block');
  assert.equal(by['11:focus-visible|focus-hidden'].decl.outline, `3px solid ${colors.focus}`);
  for (const x of p) assert.equal(x.rules.length, 1);
});

test('spacing snaps the property that produced the value, keeping its sign', () => {
  const p = planFixes(result([{ rule: 'spacing', value: 13 }], { spacingSources: [{ value: 13, raw: -13, prop: 'marginTop', afId: '2' }, { value: 16, raw: 16, prop: 'paddingTop', afId: '3' }] }));
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].decl, { 'margin-top': `-${snap(13)}px` });
  assert.ok(spacingScale.includes(snap(13)));
});

test('skips violations it cannot locate', () => {
  assert.deepEqual(planFixes(result([{ rule: 'radius-present', absence: {} }, { rule: 'measure', text: { afId: '1' } }, { rule: 'contrast', text: {} }])), []);
});

test('allow limits the rules it touches', () => {
  const p = planFixes(result([{ rule: 'radius-present', absence: { afId: '4' } }, { rule: 'link-not-underlined', link: { afId: '9' } }]), { allow: ['link-not-underlined'] });
  assert.deepEqual(p.map((x) => x.rules[0]), ['link-not-underlined']);
});

test('contrast takes the suggested colour; small text takes the floor', () => {
  const p = planFixes(result([
    { rule: 'contrast', text: { afId: '5' }, suggestion: '#123456' },
    { rule: 'text-too-small', text: { afId: '6', sizePx: 10 } },
  ]));
  const by = Object.fromEntries(p.map((x) => [x.afId, x.decl]));
  assert.equal(by['5'].color, '#123456');
  assert.equal(by['6']['font-size'], `${floors.textMinPx}px`);
});

test('FIXABLE lists only rules the planner handles', () => {
  for (const rule of FIXABLE) assert.ok(typeof rule === 'string');
  assert.ok(FIXABLE.includes('radius-present') && FIXABLE.includes('contrast'));
});

test('text drawn smaller than its own size (a scaled chart) is sized so it renders at the floor', () => {
  const p = planFixes(result([{ rule: 'text-too-small', text: { afId: '7', sizePx: 8.34, cssPx: 10 } }]));
  const px = parseFloat(p[0].decl['font-size']);
  assert.ok(px * (8.34 / 10) >= floors.textMinPx - 0.01, `${px}px renders at ${(px * 0.834).toFixed(2)}px`);
});

test('an off-system aspect ratio snaps to the nearest permitted one', () => {
  const p = planFixes(result([{ rule: 'aspect-ratio', value: '300:170' }], { ratioSources: [{ value: '300:170', w: 300, h: 170, afId: '12' }] }));
  assert.equal(p[0].afId, '12');
  assert.equal(p[0].decl['aspect-ratio'], '16 / 9');
  assert.equal(p[0].decl['object-fit'], 'cover');
});

test('register II accent on non-interactive text takes the text colour', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const p = planFixes(result([{ rule: 'accent-non-interactive-ii', text: { afId: '3' } }]));
  assert.equal(p[0].decl.color, registers.ii.text);
});

test('measure caps the block that set the line length, and only where a cap is safe', async () => {
  const { floors } = await import('../src/lib/tokens.mjs');
  const at = (block) => planFixes(result([{ rule: 'measure', text: { afId: '9', block } }]));
  const ok = at({ afId: '4', sel: 'html > body:nth-of-type(1) > p:nth-of-type(1)', display: 'block', hasLayoutChild: false });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].afId, '4', 'the patch addresses the block, not the text run inside it');
  assert.equal(ok[0].decl['max-width'], `${floors.maxMeasureCh}ch`);
  assert.equal(ok[0].decl['box-sizing'], 'border-box');
  // A cap on a flex or grid container, or on one holding a table or image, changes layout rather
  // than line length, so the model is left to deal with it.
  for (const unsafe of [{ display: 'flex' }, { display: 'grid' }, { display: 'block', hasLayoutChild: true }]) {
    assert.deepEqual(at({ afId: '4', sel: 'p', hasLayoutChild: false, ...unsafe }), [], JSON.stringify(unsafe));
  }
  assert.deepEqual(at(undefined), [], 'a measure violation with no block is left alone');
});

// Contrast with no fallback suggestion: most failing text is a text role (ink, muted, paper) or a
// composite, which the per-colour fallback lists cannot name, so the register's own text-on-ground
// pair is the fix. A text item as the extractor reports it under withIds, and a violation on it.
const run = (over = {}) => ({ afId: '5', sel: 'p', color: '#5B6B74', background: '#22282B', sizePx: 16, weight: 400, groundTrusted: true, opacitySelf: 1, ...over });
const failing = (t, spec = { register: 'i' }) => ({ spec: { ...spec, text: [t] }, violations: [{ rule: 'contrast', text: t, suggestion: null }] });

test('contrast with no suggestion takes the register colour that passes on the measured ground', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const p = planFixes([failing(run())]);
  assert.equal(p.length, 1);
  // Register I text is dark and fails on the dark ground; the on-accent colour is the one that reads.
  assert.deepEqual(p[0].decl, { color: registers.i['on-accent'] });
});

test('the colour must pass at every width the element was measured at, not only where it failed', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  // Large text on a mid grey at 320, where both register colours pass, and on the dark ground at
  // 1280, where it passes as it stands. Fixing for 320 alone picks the text colour, which fails at 1280.
  const narrow = run({ color: '#888888', background: '#7A7A7A', sizePx: 30 });
  const wide = run({ color: '#888888', background: '#22282B', sizePx: 30 });
  const both = [failing(narrow), { spec: { register: 'i', text: [wide] }, violations: [] }];
  assert.deepEqual(planFixes(both).map((x) => x.decl), [{ color: registers.i['on-accent'] }]);
  // Where no register colour passes at every width, nothing is planned.
  const light = run({ color: '#888888', background: '#F6F6F4', sizePx: 16 });
  assert.deepEqual(planFixes([failing(run()), { spec: { register: 'i', text: [light] }, violations: [] }]), []);
});

test('SVG text is painted by fill, so a contrast fix sets it too', () => {
  const p = planFixes(result([{ rule: 'contrast', text: { afId: '5', isSvgText: true }, suggestion: '#123456' }]));
  assert.deepEqual(p[0].decl, { color: '#123456', fill: '#123456' });
});

test('a translucent element is made opaque, since its colour alone cannot pass', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const p = planFixes([failing(run({ opacitySelf: 0.9 }))]);
  assert.deepEqual(p[0].decl, { color: registers.i['on-accent'], opacity: '1' });
});

test('Register II interactive text is left alone: its link colour is required, so only the ground can change', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  assert.deepEqual(planFixes([failing(run({ isInteractive: true }), { register: 'ii' })]), []);
  // The same text that is not interactive is fixed with the Register II colour.
  assert.deepEqual(planFixes([failing(run(), { register: 'ii' })])[0].decl, { color: registers.ii['on-accent'] });
});

test('a ground the checker may have mis-measured is left alone, at any width', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  assert.deepEqual(planFixes([failing(run({ groundTrusted: false }))]), []);
  assert.deepEqual(planFixes([failing(run()), { spec: { register: 'i', text: [run({ groundTrusted: false })] }, violations: [] }]), [], 'doubtful at another width');
  assert.deepEqual(planFixes([failing(run({ groundTrusted: true }))])[0].decl, { color: registers.i['on-accent'] });
});

test('a contrast fix writes only colour, fill and opacity', async () => {
  const p = planFixes([
    failing(run({ isSvgText: true, opacitySelf: 0.5 })),
    { spec: { register: 'i' }, violations: [{ rule: 'contrast', text: { afId: '6', isSvgText: true, opacitySelf: 0.5 }, suggestion: '#123456' }] },
  ]);
  assert.equal(p.length, 2);
  for (const x of p) for (const k of Object.keys(x.decl)) assert.ok(['color', 'fill', 'opacity'].includes(k), k);
});
