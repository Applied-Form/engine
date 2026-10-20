import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFixes, FIXABLE, snap, snapOther } from '../src/lib/fix/plan.mjs';
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

test('spacing snaps any value that is not 0 to a step of the scale, and offers 0 only as the second answer below half the first step', () => {
  // Spacing that is there stays there: a 1px to 7px gap or label margin goes to the first step,
  // not to 0. 0, which the rule also accepts, is the second answer for when the step is refused,
  // as the browser's own 1px padding on a table cell was at 320px (engine8 mini b36-s0). From half
  // the first step up, a value is spacing an author chose (6px of cell padding on engine8 mini
  // b12-s0), and taking it to 0 would remove it rather than correct it, so there is no second answer.
  const first = Math.min(...spacingScale);
  for (const px of [1, 3, first / 2, first - 1]) assert.equal(snap(px), first, `snap(${px})`);
  for (const px of [1, 3]) assert.equal(snapOther(px), 0, `snapOther(${px})`);
  for (const px of [first / 2, first - 2, first - 1]) assert.equal(snapOther(px), null, `snapOther(${px})`);
  assert.equal(snap(13), 16);
  const p = planFixes(result([{ rule: 'spacing', value: 1 }], { spacingSources: [{ value: 1, raw: 1, prop: 'paddingLeft', afId: '2' }] }), { secondAnswers: true });
  assert.deepEqual(p[0].decl, { 'padding-left': `${first}px` });
  assert.deepEqual(p[0].alt, { 'padding-left': '0px' });
});

test('spacing and raised sizes carry a second answer for the fixer to try when the first makes a rule worse', () => {
  assert.equal(snapOther(20), 24, '20 snaps to 16; the far side is 24');
  assert.equal(snapOther(13), 8);
  assert.equal(snapOther(1), 0);
  assert.equal(snapOther(100), 96, 'beyond the scale, the other multiple of the unit');
  const p = planFixes(result([
    { rule: 'spacing', value: 20 },
    { rule: 'body-too-small', text: { afId: '6', sizePx: 13 } },
    { rule: 'radius-present', absence: { afId: '4' } },
  ], { spacingSources: [{ value: 20, raw: 20, prop: 'paddingLeft', afId: '2' }] }), { secondAnswers: true });
  const by = Object.fromEntries(p.map((x) => [x.rules[0], x]));
  assert.deepEqual(by.spacing.alt, { 'padding-left': '24px' });
  assert.deepEqual(by['body-too-small'].alt, { 'font-size': `${floors.bodyMinPxRegisterII}px`, 'overflow-wrap': 'anywhere' });
  assert.equal(by['radius-present'].alt, undefined, 'a remedy with one answer has no second');
  const svg = planFixes(result([{ rule: 'text-too-small', text: { afId: '7', sizePx: 8, isSvgText: true } }]), { secondAnswers: true });
  assert.equal(svg[0].alt, undefined, 'svg text does not wrap');
});

test('with no option, a fixer plans no second answers: a caller opts in, so no arm gets them by omission', () => {
  const p = planFixes(result([
    { rule: 'spacing', value: 20 },
    { rule: 'body-too-small', text: { afId: '6', sizePx: 13 } },
  ], { spacingSources: [{ value: 20, raw: 20, prop: 'paddingLeft', afId: '2' }] }));
  assert.equal(p.length, 2);
  for (const x of p) assert.equal(x.alt, undefined, `${x.rules} carries a second answer by default`);
});

test('a fixer told to offer no second answers plans none', () => {
  const p = planFixes(result([
    { rule: 'spacing', value: 20 },
    { rule: 'body-too-small', text: { afId: '6', sizePx: 13 } },
  ], { spacingSources: [{ value: 20, raw: 20, prop: 'paddingLeft', afId: '2' }] }), { secondAnswers: false });
  assert.equal(p.length, 2, 'the first answers are still planned');
  for (const x of p) assert.equal(x.alt, undefined, `${x.rules} carries a second answer`);
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

test('a register II link takes the register\'s link colour, on the link itself', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const p = planFixes(result([{ rule: 'link-colour-ii', link: { afId: '3', sel: 'a', color: '#222222', background: registers.ii.background } }], { register: 'ii' }));
  assert.equal(p.length, 1);
  assert.equal(p[0].afId, '3');
  assert.deepEqual(p[0].decl, { color: registers.ii.link });
  assert.deepEqual(p[0].rules, ['link-colour-ii']);
  assert.equal(p[0].subtree, undefined, 'the rule reads the link\'s own colour, so nothing inside it is touched');
});

test('a register II link on the dark theme takes the dark palette\'s link colour', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  if (!registers['ii-dark']) return;
  const p = planFixes(result([{ rule: 'link-colour-ii', link: { afId: '3', sel: 'a', background: registers['ii-dark'].background } }], { register: 'ii', theme: 'dark' }));
  assert.deepEqual(p[0].decl, { color: registers['ii-dark'].link });
});

test('a link whose ground the link colour cannot read on is left alone: only the ground can change', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  // A link on a band in the text colour, which is not one of the dark grounds: the link colour on it
  // would trade link-colour-ii for contrast.
  assert.deepEqual(planFixes(result([{ rule: 'link-colour-ii', link: { afId: '3', sel: 'a', background: registers.ii.text } }], { register: 'ii' })), []);
});

test('a register II link in neither accepted colour, with no fill of its own on ink or espresso, takes the on-dark link colour', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  // engine11: 7 of the 18 pages failing link-colour-ii carried a link on the ink masthead, where the
  // link colour reads 2.05:1. The rule accepts the link colour or the on-dark one there (decision 0025),
  // and the fixer recommends the on-dark one: on 5722c0a it planned nothing for these links.
  for (const ground of [colors.ink, colors.espresso]) {
    for (const extra of [{}, { paintsGround: false, underlined: true }]) {
      const link = { afId: '3', sel: 'a', color: '#FFFFFF', background: ground, groundTrusted: true, hasText: true, ...extra };
      const p = planFixes(result([{ rule: 'link-colour-ii', link }], { register: 'ii' }));
      assert.equal(p.length, 1);
      assert.deepEqual(p[0].decl, { color: registers.ii['link-on-dark'] }, ground);
      assert.deepEqual(p[0].rules, ['link-colour-ii']);
    }
  }
});

test('on ink, a link with no text of its own, an untrusted ground, the dark theme and the dark register are planned as on 5722c0a', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const link = { afId: '3', sel: 'a', color: colors.paper, background: colors.ink, groundTrusted: true, hasText: true };
  const plan = (l, spec = { register: 'ii' }) => planFixes(result([{ rule: 'link-colour-ii', link: l }], spec));
  // A link with no text of its own: one whose only content is an svg or an img, such as the outlined
  // wordmark used as the home link, even with a <title>, which gives it a text run (underlined is then
  // not null). Its colour paints only the image, so it is left to the model, as on 5722c0a.
  assert.deepEqual(plan({ ...link, hasText: false }), []);
  assert.deepEqual(plan({ ...link, hasText: false, underlined: true }), []);
  assert.deepEqual(plan({ ...link, hasText: undefined }), [], 'a link the extractor did not report on is not recoloured');
  // A ground the checker cannot vouch for, as for a contrast fix.
  assert.deepEqual(plan({ ...link, groundTrusted: false }), []);
  assert.deepEqual(plan({ ...link, groundTrusted: undefined }), []);
  // The dark theme is judged against the dark palette, which declares no on-dark colour.
  assert.deepEqual(plan(link, { register: 'ii', theme: 'dark' })[0].decl, { color: registers['ii-dark'].link });
  // A page that declares the dark register: nothing is planned, as before.
  assert.deepEqual(plan(link, { register: 'ii-dark' }), []);
});

test('a link measured on ink at one width and on the page at another is not given the on-dark colour', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const at = (background) => ({ afId: '3', sel: 'a', color: colors.paper, background, groundTrusted: true, hasText: true });
  const results = [
    { url: 'p', viewport: 1280, spec: { register: 'ii', links: [at(colors.ink)] }, violations: [{ rule: 'link-colour-ii', link: at(colors.ink) }] },
    { url: 'p', viewport: 320, spec: { register: 'ii', links: [at(registers.ii.background)] }, violations: [{ rule: 'link-colour-ii', link: at(registers.ii.background) }] },
  ];
  // The 320 width plans the link colour, as on 5722c0a; the 1280 width plans nothing of its own.
  assert.deepEqual(planFixes(results).map((p) => p.decl), [{ color: registers.ii.link }]);
});

/** A contrast violation on a run inside a link, as the fixer's run reports both. */
const linkRun = (link, run = {}) => {
  const t = { afId: '7', sel: `${link.sel} > span:nth-of-type(1)`, color: link.color, background: link.background, isInteractive: true, sizePx: 18, weight: 400, groundTrusted: true, ...run };
  return [{ spec: { register: 'ii', links: [link], text: [t] }, violations: [{ rule: 'contrast', text: t, ratio: 2.04, need: 4.5, suggestion: null }] }];
};

test('a register II link in the link colour on ink, whose text fails contrast, takes the on-dark link colour on the link', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  // link-colour-ii passes it, as on 5722c0a; contrast fails it, and on 5722c0a the fixer left that to the
  // model, since a Register II link's colour is the register's. The on-dark colour passes both rules.
  for (const ground of [colors.ink, colors.espresso]) {
    const link = { afId: '5', sel: 'html > body:nth-of-type(1) > header:nth-of-type(1) > a:nth-of-type(1)', color: registers.ii.link, background: ground, groundTrusted: true, hasText: true };
    for (const run of [{}, { afId: link.afId, sel: link.sel }]) {
      const p = planFixes(linkRun(link, run));
      assert.equal(p.length, 1, ground);
      assert.equal(p[0].afId, link.afId, 'the patch is on the link, whose colour the run inherits');
      assert.deepEqual(p[0].decl, { color: registers.ii['link-on-dark'] });
      assert.deepEqual(p[0].rules, ['contrast']);
    }
    // Planned for contrast, so only where the fixer may fix contrast.
    assert.deepEqual(planFixes(linkRun(link), { allow: ['link-colour-ii'] }), []);
  }
});

test('a contrast failure inside a link is planned as on 5722c0a where the link cannot take the on-dark colour', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const link = { afId: '5', sel: 'html > body:nth-of-type(1) > header:nth-of-type(1) > a:nth-of-type(1)', color: registers.ii.link, background: colors.ink, groundTrusted: true, hasText: true };
  // Untrusted ground, no text of its own, a link not in the link colour, a run in a colour of its own,
  // a link on another ground, a page on the dark theme: the Register II link colour stays the model's call.
  for (const [l, run, spec] of [
    [{ ...link, groundTrusted: false }, {}],
    [{ ...link, hasText: false }, {}],
    [{ ...link, color: colors.paper }, { color: registers.ii.link }],
    [link, { color: registers.ii.text }],
    [{ ...link, background: registers.ii.text }, {}],
    [link, {}, { register: 'ii', theme: 'dark' }],
  ]) {
    const results = linkRun(l, run);
    if (spec) results[0].spec = { ...results[0].spec, ...spec };
    assert.deepEqual(planFixes(results), [], JSON.stringify([l, run, spec]));
  }
  // A run in no link is planned as before: on the run, in the register's own colour that reads there.
  const plain = planFixes(linkRun(link, { sel: 'html > body:nth-of-type(1) > p:nth-of-type(1)', isInteractive: false }));
  assert.deepEqual(plain.map((p) => [p.afId, p.rules]), [['7', ['contrast']]]);
  assert.notEqual(plain[0].decl.color, registers.ii['link-on-dark']);
});

/** A link on ink holding runs, each a span of it measured as `run` says, and the violations given. */
const holding = (link, runs, violations) => {
  const text = runs.map((run, i) => ({ afId: String(20 + i), sel: `${link.sel} > span:nth-of-type(${i + 1})`, isInteractive: true, sizePx: 18, weight: 400, groundTrusted: true, alpha: 1, ...run }));
  return [{ spec: { register: 'ii', links: [link], text }, violations: violations(text) }];
};
const failsContrast = (...runs) => (text) => runs.map((i) => ({ rule: 'contrast', text: text[i], ratio: 2.04, need: 4.5, suggestion: null }));

test('a link is given the on-dark colour only when every run it colours reads in it, not only the one that fails', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const ii = registers.ii;
  const sel = 'html > body:nth-of-type(1) > header:nth-of-type(1) > a:nth-of-type(1)';
  const onInk = (color) => ({ color, paint: color, background: colors.ink });
  const onChip = (color) => ({ color, paint: color, background: ii.background });
  // contrast: a link in the link colour on ink, holding a plain run on the ink, which fails, and a run
  // on a white chip, in the link colour it inherits, which passes. The on-dark colour would fail the
  // chip's run (1.43:1 on Applied Form; the open engine's palette differs), so the link is not
  // recoloured, and nothing else is planned for it.
  const link = { afId: '5', sel, color: ii.link, background: colors.ink, groundTrusted: true, hasText: true };
  const { contrast } = await import('../src/lib/contrast.mjs');
  assert.ok(contrast(ii['link-on-dark'], ii.background) < floors.bodyContrast, 'the on-dark colour fails the body floor on the chip');
  assert.deepEqual(planFixes(holding(link, [onInk(ii.link), onChip(ii.link)], failsContrast(0))), []);
  // Every run on the ink: the link takes the on-dark colour, for contrast.
  const fixed = planFixes(holding(link, [onInk(ii.link), onInk(ii.link)], failsContrast(0, 1)));
  assert.deepEqual(fixed.map((p) => [p.afId, p.decl, p.rules]), [[link.afId, { color: ii['link-on-dark'] }, ['contrast']]]);
  // A chip run in a colour of its own takes nothing from the link, so it does not hold the fix back.
  assert.equal(planFixes(holding(link, [onInk(ii.link), onChip(ii.text)], failsContrast(0)))[0].decl.color, ii['link-on-dark']);

  // link-colour-ii: the same check, on a link in neither accepted colour.
  const paper = { ...link, color: colors.paper };
  const flagged = () => [{ rule: 'link-colour-ii', link: paper }];
  assert.deepEqual(planFixes(holding(paper, [onInk(colors.paper), onChip(colors.paper)], flagged)), []);
  assert.deepEqual(planFixes(holding(paper, [onInk(colors.paper), onInk(colors.paper)], flagged)).map((p) => p.decl), [{ color: ii['link-on-dark'] }]);
  assert.deepEqual(planFixes(holding(paper, [onInk(colors.paper), onChip(ii.text)], flagged)).map((p) => p.decl), [{ color: ii['link-on-dark'] }]);

  // A run the link colours at reduced opacity is read as it would paint: the on-dark colour at 50%
  // on ink (#8B7C71 on Applied Form, 3.79:1) is under the floor, so the link is left alone. The
  // fixer's run reports the run's colour before opacity, which is how it is known to be the link's.
  const half = (fg, bg) => '#' + [1, 3, 5].map((i) => Math.round((parseInt(fg.slice(i, i + 2), 16) + parseInt(bg.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, '0')).join('').toUpperCase();
  const faded = { color: half(colors.paper, colors.ink), paint: colors.paper, alpha: 0.5, background: colors.ink };
  assert.ok(contrast(half(ii['link-on-dark'], colors.ink), colors.ink) < floors.bodyContrast, 'the on-dark colour at 50% on ink is under the floor');
  assert.deepEqual(planFixes(holding(paper, [onInk(colors.paper), faded], flagged)), []);
  // A run with no measured ground cannot be judged, so the link is left alone.
  assert.deepEqual(planFixes(holding(paper, [onInk(colors.paper), { ...onInk(colors.paper), background: null }], flagged)), []);

  // onDark: false plans neither fix, so both links are planned as on 5722c0a: nothing for either.
  assert.deepEqual(planFixes(holding(link, [onInk(ii.link)], failsContrast(0)), { onDark: false }), []);
  assert.deepEqual(planFixes(holding(paper, [onInk(colors.paper)], flagged), { onDark: false }), []);
});

test('a link that paints its own ground is planned exactly as on 5722c0a, on ink as anywhere else', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  const ii = registers.ii;
  const plan = (link) => planFixes(result([{ rule: 'link-colour-ii', link: { afId: '3', sel: 'a', paintsGround: true, behindTrusted: true, ...link } }], { register: 'ii' })).map((x) => x.decl);
  const lifted = { color: ii.link, 'background-color': 'transparent', 'background-image': 'none' };
  // Filled with ink or espresso on a white page: it loses its fill and takes the link colour.
  for (const fill of [colors.ink, colors.espresso]) assert.deepEqual(plan({ color: '#FFFFFF', background: fill, behind: ii.background }), [lifted], fill);
  // Filled with the accent on the ink masthead: the link colour reads neither on the fill nor on the
  // ink behind it, so nothing is planned.
  assert.deepEqual(plan({ color: colors.paper, background: ii.accent, behind: colors.ink }), []);
  // Filled with ink on the ink masthead: nothing is planned either.
  assert.deepEqual(plan({ color: colors.paper, background: colors.ink, behind: colors.ink }), []);
  // A skip link filled with white on the ink masthead: the link colour reads on its fill, which stays.
  assert.deepEqual(plan({ color: ii['link-on-dark'], background: ii.background, behind: colors.ink }), [{ color: ii.link }]);
});

test('a link drawn as a filled button gives up its fill and takes the link colour, where that reads on the ground behind it', async () => {
  const { registers } = await import('../src/lib/tokens.mjs');
  // engine10: 13 of 18 pages failing link-colour-ii carried a link painted as a filled button, white on
  // the accent, where the link colour reads at 1.41:1. On the page's own ground it reads.
  const button = { afId: '3', sel: 'a.btn', color: '#FFFFFF', background: '#257E4F', paintsGround: true, behind: registers.ii.background, behindTrusted: true };
  const p = planFixes(result([{ rule: 'link-colour-ii', link: button }], { register: 'ii' }));
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].decl, { color: registers.ii.link, 'background-color': 'transparent', 'background-image': 'none' });
  // Not where the ground behind it is one the checker cannot vouch for, or one the link colour fails on.
  assert.deepEqual(planFixes(result([{ rule: 'link-colour-ii', link: { ...button, behindTrusted: false } }], { register: 'ii' })), []);
  assert.deepEqual(planFixes(result([{ rule: 'link-colour-ii', link: { ...button, behind: registers.ii.text } }], { register: 'ii' })), []);
  // A link that paints no ground of its own keeps the ground it has: on a band in the text colour nothing is planned.
  assert.deepEqual(planFixes(result([{ rule: 'link-colour-ii', link: { ...button, paintsGround: false, background: registers.ii.text } }], { register: 'ii' })), []);
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

// Tier 1 (protocol, seventh amendment): the defects behind the guaranteed rules that still failed on engine7.

test('an svg takes the nearest permitted ratio no wider than its own, so a drawing scaled to fit never shrinks', () => {
  // 720:500 is nearer 3:2 than 4:3, but at the same width 3:2 is a shorter box, and an svg scaled
  // to fit it draws every label 4% smaller; 4:3 is taller, and the drawing keeps its size.
  const at = (element) => planFixes(result([{ rule: 'aspect-ratio', value: '720:500' }], { ratioSources: [{ value: '720:500', w: 720, h: 500, afId: '12', element }] }))[0].decl;
  assert.equal(at('svg')['aspect-ratio'], '4 / 3');
  assert.equal(at('img')['aspect-ratio'], '3 / 2', 'an image crops, so it takes the nearest');
  // Narrower than every permitted ratio: nothing qualifies, so the nearest is taken.
  assert.equal(planFixes(result([{ rule: 'aspect-ratio', value: '100:300' }], { ratioSources: [{ value: '100:300', w: 100, h: 300, afId: '12', element: 'svg' }] }))[0].decl['aspect-ratio'], '2 / 3');
});

test('a letterboxed svg may take a ratio up to its drawing\'s own, since the box held it wider than the drawing needed', () => {
  // A 3:1 wordmark drawn into a 272:220 box is bound by the width, so a box as wide as 3:1 still
  // draws it at the same size and the nearest ratio, 4:3, is allowed; held to the box's own 1.24
  // it would have to take 1:1.
  const at = (intrinsic) => planFixes(result([{ rule: 'aspect-ratio', value: '272:220' }], { ratioSources: [{ value: '272:220', w: 272, h: 220, afId: '12', element: 'svg', intrinsic }] }))[0].decl['aspect-ratio'];
  assert.equal(at(3), '4 / 3');
  assert.equal(at(null), '1 / 1', 'without a viewBox nothing scales, so the box only grows taller');
  // Bound by the height instead: the box's own ratio is the wider one, and the limit.
  assert.equal(planFixes(result([{ rule: 'aspect-ratio', value: '848:220' }], { ratioSources: [{ value: '848:220', w: 848, h: 220, afId: '12', element: 'svg', intrinsic: 3 }] }))[0].decl['aspect-ratio'], '2 / 1');
});

test('an aspect-ratio fix lifts what would hold the height: a max-height, a flex or grid stretch, a flex basis', () => {
  const p = planFixes(result([{ rule: 'aspect-ratio', value: '880:260' }], { ratioSources: [{ value: '880:260', w: 880, h: 260, afId: '12', element: 'svg' }] }));
  assert.equal(p[0].decl.height, 'auto');
  assert.equal(p[0].decl['max-height'], 'none');
  assert.equal(p[0].decl['min-height'], '0');
  assert.equal(p[0].decl['align-self'], 'start');
  assert.equal(p[0].decl['flex-basis'], 'auto');
  // And what would hold the width past its row: a flex item's automatic minimum, which a box
  // with an aspect ratio takes from its content.
  assert.equal(p[0].decl['min-width'], '0');
});

test('a link fix underlines every run inside the link, not only the link itself', async () => {
  const { cssOf } = await import('../src/lib/fix/apply.mjs');
  // The checker wants the underline on every text-bearing descendant, and a descendant that is
  // not inline (a flex item, a block, an svg's title) does not inherit the link's own.
  const sel = 'html > body:nth-of-type(1) > a:nth-of-type(1)';
  const p = planFixes(result([{ rule: 'link-not-underlined', link: { afId: '9', sel } }]));
  assert.equal(p[0].subtree, true);
  assert.equal(cssOf(p)[0], `${sel}, ${sel} * { text-decoration-line: underline !important; }`);
  // Nothing else widens its reach.
  const q = planFixes(result([{ rule: 'radius-present', absence: { afId: '4', sel } }]));
  assert.equal(q[0].subtree, undefined);
  assert.equal(cssOf(q)[0], `${sel} { border-radius: 0 !important; }`);
});

test('text measured at two widths takes the larger size it needs, not the last one planned', () => {
  // A chart's label at 13px css renders at 3px in a narrow column and 9.36px in a wide one; one
  // patch serves both widths, so it has to be sized for the narrow one.
  const at = (sizePx) => ({ spec: {}, violations: [{ rule: 'text-too-small', text: { afId: '7', sizePx, cssPx: 13 } }] });
  for (const order of [[3, 9.36], [9.36, 3]]) {
    const p = planFixes(order.map(at));
    assert.equal(p.length, 1);
    const px = parseFloat(p[0].decl['font-size']);
    assert.ok(px * (3 / 13) >= floors.textMinPx, `${px}px renders at ${(px * 3 / 13).toFixed(2)}px at the narrow width`);
  }
});

test('scaled text is sized with headroom, so a two-decimal reading or a shifted layout cannot leave it just under the floor', () => {
  // The checker reported 11.49px for 30.79px of css. Sized by that ratio exactly, the text renders
  // at the floor only if nothing else moves; the other fixes in the same pass reflow the page, the
  // svg loses a pixel of width, and the re-check reads 11.49 again.
  const p = planFixes(result([{ rule: 'text-too-small', text: { afId: '7', sizePx: 11.49, cssPx: 30.79 } }]));
  const px = parseFloat(p[0].decl['font-size']);
  const drifted = (11.49 / 30.79) * 0.995;
  assert.ok(Math.round(px * drifted * 100) / 100 >= floors.textMinPx, `${px}px renders at ${(px * drifted).toFixed(3)}px after a half-percent reflow`);
  assert.equal(planFixes(result([{ rule: 'text-too-small', text: { afId: '8', sizePx: 10, cssPx: 10 } }]))[0].decl['font-size'], `${floors.textMinPx}px`, 'unscaled text takes the floor exactly');
  // The checker rounds the rendered size to two decimals and the css size not at all, so a
  // button's 13.333px reads 13.33: a rounding difference, not a scale.
  assert.equal(planFixes(result([{ rule: 'body-too-small', text: { afId: '9', sizePx: 13.33, cssPx: 13.333 } }]))[0].decl['font-size'], `${floors.bodyMinPxRegisterII}px`);
});

test('a run drawn by ::before or ::after is patched on the pseudo-element, under its host\'s id', async () => {
  const { cssOf } = await import('../src/lib/fix/apply.mjs');
  const sel = 'html > body:nth-of-type(1) > li:nth-of-type(1)';
  const p = planFixes(result([
    { rule: 'font-off-system', text: { afId: '3', sel, pseudo: '::before', isData: false } },
    { rule: 'text-too-small', text: { afId: '3', sel, pseudo: '::before', sizePx: 10, cssPx: 10 } },
    { rule: 'text-too-small', text: { afId: '3', sel, sizePx: 10, cssPx: 10 } },
  ]));
  const by = Object.fromEntries(p.map((x) => [`${x.pseudo}|${x.rules.join()}`, x]));
  assert.equal(cssOf([by['::before|font-off-system']])[0].split(' {')[0], `${sel}::before`);
  assert.equal(by['::before|text-too-small'].decl['font-size'], `${floors.textMinPx}px`);
  assert.equal(by['|text-too-small'].pseudo, '', 'the host\'s own run is a separate patch');
});

test('in Register II a font fix on small running text lifts it to the body floor the new voice would expose', () => {
  // Setting the text voice on 15px button text makes it body text, which Register II holds to
  // 19px; the re-check saw body-too-small rise and rolled the font fix back (b11, b27 on mini).
  const at = (spec, text) => planFixes([{ spec, violations: [{ rule: 'font-off-system', text: { afId: '3', sizePx: 15, cssPx: 15, role: 'other', ...text } }] }])[0].decl;
  assert.equal(at({ register: 'ii' }, {})['font-size'], `${floors.bodyMinPxRegisterII}px`);
  assert.equal(at({ register: 'i' }, {})['font-size'], undefined, 'Register I has no body floor');
  assert.equal(at({ register: 'ii' }, { isData: true })['font-size'], undefined, 'data takes the data voice, which the floor exempts');
  assert.equal(at({ register: 'ii' }, { role: 'heading' })['font-size'], undefined);
  assert.equal(at({ register: 'ii' }, { sizePx: 19, cssPx: 19 })['font-size'], undefined);
});

test('register II accent on svg text is recoloured through fill as well', async () => {
  // The one accent failure left on engine7 (b12 on mini) was an svg label: it is painted by
  // fill, which a colour declaration does not touch.
  const { registers } = await import('../src/lib/tokens.mjs');
  const p = planFixes(result([{ rule: 'accent-non-interactive-ii', text: { afId: '3', isSvgText: true } }]));
  assert.deepEqual(p[0].decl, { color: registers.ii.text, fill: registers.ii.text });
  assert.deepEqual(planFixes(result([{ rule: 'accent-non-interactive-ii', text: { afId: '3' } }]))[0].decl, { color: registers.ii.text });
});

test('an svg measured at two widths takes the narrower of the two snapped ratios', () => {
  const r = (w, h) => ({ spec: { ratioSources: [{ value: `${w}:${h}`, w, h, afId: '12', element: 'svg' }] }, violations: [{ rule: 'aspect-ratio', value: `${w}:${h}` }] });
  const p = planFixes([r(272, 220), r(848, 220)]);
  assert.equal(p.length, 1);
  assert.equal(p[0].decl['aspect-ratio'], '1 / 1');
});
