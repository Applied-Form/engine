/**
 * The evaluation harness has to be trustworthy before it is pointed at a paid API. These tests are
 * about the integrity of the experiment, not the quality of the code: the leak test and the
 * recovery test are the two that would invalidate a published result if they failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/lib/rules/registry.mjs';
import { split, partition, UNIVERSAL_WITHHELD, TAUGHT_BY_TOKENS } from '../eval/split.mjs';
import { ARMS, promptFor, proseGuide, ruleContext, compiledRuleContext, repairPrompt, CONSTRAINT_BUDGET } from '../eval/arms.mjs';
import { normalise, paletteDistance, spacingDrift, OPPORTUNITY } from '../eval/score.mjs';
import { summarise, pooledRate, rateRatio, consistency, scoreable } from '../eval/analyse.mjs';
import { classifyFailure } from '../eval/run.mjs';
import { disclosedPer100, disclosedRatio, tables } from '../eval/tables.mjs';

const ASSETS = {
  tokenFile: 'eval/fixtures/meridian.merged.tokens.json',
  componentsCss: 'dist/components.css',
  tokensCss: 'dist/tokens.css',
};
const BRIEF = { id: 'b01', register: 'ii', brief: 'A test page.' };

/** A scoreable row: `perRule` maps rule → { v: violations, o: opportunities }. */
const row = (brief, arm, sample, perRule, extra = {}) => ({
  brief, arm, model: 'm', sample,
  universal: Object.values(perRule).reduce((s, x) => s + x.v, 0),
  perRule, ...extra,
});

test('the withheld and disclosed rule sets are disjoint and cover every rule', () => {
  const s = split();
  assert.equal(s.withheld.length + s.disclosed.length, RULES.length);
  assert.equal(s.withheld.filter((id) => s.disclosed.includes(id)).length, 0);
  assert.ok(s.universal.every((id) => s.withheld.includes(id)), 'universal must be a subset of withheld');
  assert.equal(s.universal.length + s.gated.length, s.withheld.length);
});

test('the scoreable set contains only rules any page can break', () => {
  // Every universal rule must be scoreable without the system's own attributes, and must therefore
  // declare an opportunity denominator. A rule with no denominator would be counted per page, which
  // rewards a page for being empty.
  for (const id of UNIVERSAL_WITHHELD) {
    assert.ok(OPPORTUNITY[id], `${id} has no opportunity denominator`);
  }
  assert.equal(Object.keys(OPPORTUNITY).length, UNIVERSAL_WITHHELD.length);
});

test('NO ARM LEAKS A SCOREABLE RULE', () => {
  // The integrity test. If any arm's context names a rule the study scores — by id, or by the
  // summary that gives its requirement away — then that arm is being handed the answer key and
  // every comparison in the study is void. Matched on word boundaries, because several rule ids
  // are ordinary words that appear innocently in prose.
  //
  // Arm D is exempt and is asserted separately below: a component stylesheet encodes rules by
  // construction — that is what a component library is — so it cannot be held to a "says nothing
  // about the rules" standard without ceasing to be the thing we wanted to compare against.
  const scoreable = RULES.filter((r) => UNIVERSAL_WITHHELD.includes(r.id));
  assert.ok(scoreable.length > 0);
  for (const arm of ARMS.filter((a) => a !== 'components')) {
    const prompt = promptFor(BRIEF, arm, ASSETS);
    for (const rule of scoreable) {
      const id = new RegExp(`\\b${rule.id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`);
      assert.ok(!id.test(prompt), `arm "${arm}" leaks the scoreable rule id "${rule.id}"`);
      assert.ok(!prompt.includes(rule.summary), `arm "${arm}" leaks the summary of "${rule.id}"`);
    }
  }
});

test('the component arm teaches by construction, and that is recorded', () => {
  // Not a leak to be fixed but a property to be stated: arm D's stylesheet demonstrates correct
  // aspect ratios and carries no shadows, gradients or rounded corners, so it conveys several
  // scoreable rules by example. Arm D's score therefore measures what a component library hands
  // you, not whether the model generalised, and the write-up must say so.
  const prompt = promptFor(BRIEF, 'components', ASSETS);
  const taughtByExample = RULES
    .filter((r) => UNIVERSAL_WITHHELD.includes(r.id))
    .filter((r) => new RegExp(`\\b${r.id}\\b`).test(prompt));
  assert.ok(taughtByExample.length > 0, 'if this is empty the exemption above is no longer needed');
  assert.ok(taughtByExample.some((r) => r.id === 'aspect-ratio'));
});

test('rules an arm is taught are excluded from the score', () => {
  // The token file states the spacing scale, the motion durations, the focus colour and the
  // register link colours. Scoring those as held-out would measure JSON comprehension, not
  // conformance, so they are named and excluded rather than quietly left in.
  const scoreable = new Set(UNIVERSAL_WITHHELD);
  for (const id of TAUGHT_BY_TOKENS) {
    assert.ok(split().withheld.includes(id), `${id} should still be withheld from the arms`);
    assert.ok(!scoreable.has(id), `${id} is taught by the token file and must not be scored`);
  }
  const tokens = promptFor(BRIEF, 'tokens', ASSETS);
  assert.ok(tokens.includes('spacing'), 'the token arm is expected to teach the spacing scale');
});

test('the prose arm and the rules arm carry the same rules', () => {
  // B → E is meant to isolate precision of expression, so the two must be information-equivalent.
  const disclosed = RULES.filter((r) => split().disclosed.includes(r.id));
  const prose = proseGuide();
  const rules = ruleContext();
  for (const r of disclosed) {
    const stem = r.summary.replace(/\.$/, '').slice(0, 40);
    assert.ok(prose.includes(stem), `the prose guide omits ${r.id}`);
    assert.ok(rules.includes(r.id), `the rule list omits ${r.id}`);
  }
  assert.ok(!prose.includes('**'), 'the prose guide should not carry rule identifiers');
});

test('the repair loop is only ever shown disclosed failures', () => {
  const violations = [
    { rule: 'alt-missing', message: 'no alt text' },        // scored — must never be shown
    { rule: 'target-size', message: 'too small' },          // scored
    { rule: 'background', message: 'wrong ground' },        // disclosed
  ];
  const { disclosed, universal } = partition(violations);
  assert.equal(universal.length, 2);
  assert.deepEqual(disclosed.map((v) => v.rule), ['background']);
  const prompt = repairPrompt(disclosed);
  assert.ok(prompt.includes('background'));
  assert.ok(!prompt.includes('alt-missing') && !prompt.includes('target-size'));
});

test('repair feedback richness is a real ablation', () => {
  const v = [{ rule: 'background', message: 'wrong ground' }];
  assert.ok(!repairPrompt(v, 'exit').includes('background'));
  assert.ok(repairPrompt(v, 'id').includes('background'));
  assert.ok(!repairPrompt(v, 'id').includes('wrong ground'));
  assert.ok(repairPrompt(v, 'full').includes('wrong ground'));
  assert.equal(repairPrompt([], 'full'), null);
});

test('normalising a page does not credit an arm for knowing our attributes', () => {
  const bare = normalise('<html><body><p>hi</p></body></html>', 'ii');
  assert.ok(bare.injected);
  assert.ok(bare.html.includes('data-register="ii"'));
  const already = normalise('<html><body data-register="i"><p>hi</p></body></html>', 'ii');
  assert.equal(already.injected, false);
  assert.ok(already.html.includes('data-register="i"'), 'an existing register is never overwritten');
});

test('drift measures behave at their extremes', () => {
  assert.equal(paletteDistance('#B0502E', ['#B0502E']), 0);
  assert.ok(paletteDistance('#FFFFFF', ['#000000']) > 90);
  assert.equal(paletteDistance('not-a-colour', ['#000000']), null);
  assert.equal(spacingDrift([8, 16, 32]), 0);
  assert.ok(spacingDrift([9, 17, 33]) > 0.9);
  assert.equal(spacingDrift([]), null);
});

test('a rate is per opportunity, so an empty page cannot win by being empty', () => {
  // Arm a: a rich page, 4 of 40 links un-underlined. Arm b: a tiny page, 2 of 4 links un-underlined —
  // fewer violations in absolute terms, but half its links are wrong.
  const rows = [
    row('b1', 'a', 0, { 'link-not-underlined': { v: 4, o: 40 } }),
    row('b1', 'b', 0, { 'link-not-underlined': { v: 2, o: 4 } }),
  ];
  const a = pooledRate(rows.filter((r) => r.arm === 'a'));
  const b = pooledRate(rows.filter((r) => r.arm === 'b'));
  assert.ok(b > a, 'the sparse page must not score better merely for offering less to break');
});

test('a page with no links earns nothing on the link rules, rather than a perfect score', () => {
  // Arm "textonly" emits no links, no images, no buttons: only the per-element rules apply, and it
  // breaks one of them. Arm "full" emits everything and breaks nothing at all. The text-only arm must
  // not come out ahead just because six of the nine rules never had a chance to fire.
  const rows = [
    row('b1', 'textonly', 0, { 'radius-present': { v: 10, o: 100 }, 'shadow-present': { v: 0, o: 100 }, 'gradient-fill': { v: 0, o: 100 } }),
    row('b1', 'full', 0, {
      'radius-present': { v: 0, o: 100 }, 'shadow-present': { v: 0, o: 100 }, 'gradient-fill': { v: 0, o: 100 },
      'link-not-underlined': { v: 0, o: 12 }, 'alt-missing': { v: 0, o: 3 }, 'target-size': { v: 0, o: 5 },
    }),
  ];
  const t = pooledRate(rows.filter((r) => r.arm === 'textonly'));
  const f = pooledRate(rows.filter((r) => r.arm === 'full'));
  assert.ok(t > f, 'absent opportunity must be excluded from the mean, not counted as compliance');
  assert.equal(f, 0);
});

test('every scoreable rule weighs the same in the primary metric', () => {
  // Three rules are per-element and would swamp the per-link rules under a pooled-over-everything
  // denominator. One wrong link out of two must matter as much as fifty wrong corners out of a hundred.
  const rows = [
    row('b1', 'a', 0, { 'link-not-underlined': { v: 1, o: 2 }, 'radius-present': { v: 0, o: 100 } }),
    row('b1', 'b', 0, { 'link-not-underlined': { v: 0, o: 2 }, 'radius-present': { v: 50, o: 100 } }),
  ];
  const a = pooledRate(rows.filter((r) => r.arm === 'a'));
  const b = pooledRate(rows.filter((r) => r.arm === 'b'));
  assert.ok(Math.abs(a - b) < 1e-9, `expected equal rates, got ${a} and ${b}`);
});

test('the analysis recovers an effect of known size', () => {
  // Construct data where the treatment arm has exactly half the violation rate of the control, then
  // check the bootstrap finds a ratio near 0.5 with an interval that excludes 1. If this fails, no
  // number the harness reports can be believed.
  const rows = [];
  for (let b = 0; b < 12; b++) {
    for (let s = 0; s < 4; s++) {
      rows.push(row(`b${b}`, 'control', s, { 'link-not-underlined': { v: 8, o: 40 } }, { drift: { palette: 5 + s } }));
      rows.push(row(`b${b}`, 'treated', s, { 'link-not-underlined': { v: 4, o: 40 } }, { drift: { palette: 5 } }));
    }
  }
  const rr = rateRatio(rows, 'treated', 'control');
  assert.ok(Math.abs(rr.ratio - 0.5) < 1e-9, `expected a ratio of 0.5, got ${rr.ratio}`);
  assert.ok(rr.hi < 1, 'the interval should exclude 1 for an effect this large');

  // And the consistency measure should see that the treated arm does not vary between generations.
  const c = consistency(rows);
  assert.equal(c.treated.withinCellSd, 0);
  assert.ok(c.control.withinCellSd > 1);

  const s = summarise(rows);
  assert.equal(s.pages, 96);
  assert.equal(s.perArm.find((a) => a.arm === 'treated').clean, 0);
});

test('the interval does not depend on the order records were written in', () => {
  // Cells run concurrently append in the order models answer, so the same run can be written in
  // any order. The seeded bootstrap must give the same bounds for all of them.
  const rows = [];
  for (let b = 0; b < 6; b++) {
    for (let s = 0; s < 2; s++) {
      rows.push(row(`b${b}`, 'control', s, { 'link-not-underlined': { v: 10 + 3 * b, o: 40 } }));
      rows.push(row(`b${b}`, 'treated', s, { 'link-not-underlined': { v: [1, 9, 2, 14, 3, 20][b], o: 40 } }));
    }
  }
  const a = rateRatio(rows, 'treated', 'control', { iterations: 400 });
  const order = [5, 2, 0, 4, 1, 3];
  const shuffled = [...rows].sort((x, y) => order.indexOf(Number(x.brief.slice(1))) - order.indexOf(Number(y.brief.slice(1))));
  const b = rateRatio(shuffled, 'treated', 'control', { iterations: 400 });
  assert.deepEqual([b.lo, b.hi], [a.lo, a.hi]);
});

test('every way a page can be unusable is told apart from the others', () => {
  const page = '<html><body><p>hi</p></body></html>';
  assert.equal(classifyFailure({ stop: 'end_turn', html: page }), null);
  assert.equal(classifyFailure({ stop: 'max_tokens', html: page }), 'truncated');
  assert.equal(classifyFailure({ stop: 'length', html: page }), 'truncated');
  assert.equal(classifyFailure({ stop: 'end_turn', html: '<html><body><p>cut off' }), 'incomplete-html');

  // The precedence that matters. A refusal is a sentence with no markup, so a completeness test
  // reaches it first and files it as broken HTML — which would hide "the model declined" inside
  // "the model produced garbage". Those need different responses from whoever reads the run.
  assert.equal(classifyFailure({ stop: 'refusal', html: 'I can not help with that.' }), 'refused');
  assert.notEqual(classifyFailure({ stop: 'refusal', html: 'I can not help with that.' }), 'incomplete-html');

  // Truncation outranks completeness for the same reason: a page cut at the token cap is also
  // unclosed, and "ran out of room" is the useful diagnosis, not "markup was malformed".
  assert.equal(classifyFailure({ stop: 'max_tokens', html: '<html><body><p>cut' }), 'truncated');
});

test('an arm cannot improve its score by failing to produce pages', () => {
  // The survivorship trap. A model that truncates, refuses, or emits unparseable markup would
  // otherwise vanish from its own denominator — the pages it managed to finish are the easy ones,
  // so dropping the rest makes the weakest model look strongest. Failures stay in the record, are
  // reported as a rate, and are excluded from the violation rates only after being counted.
  const rows = [];
  for (let b = 0; b < 12; b++) {
    // Honest arm: finishes every page, some violations on each.
    rows.push(row(`b${b}`, 'honest', 0, { 'target-size': { v: 6, o: 30 } }));
    // Fragile arm: finishes a third of its pages cleanly and fails the rest outright.
    rows.push(row(`b${b}`, 'fragile', 0, { 'target-size': { v: 1, o: 30 } }));
    rows.push({ brief: `b${b}`, arm: 'fragile', model: 'm', sample: 1, failed: true, failure: 'truncated' });
    rows.push({ brief: `b${b}`, arm: 'fragile', model: 'm', sample: 2, failed: true, failure: 'error' });
  }
  const s = summarise(rows);
  const fragile = s.perArm.find((a) => a.arm === 'fragile');
  const honest = s.perArm.find((a) => a.arm === 'honest');

  assert.equal(fragile.attempted, 36, 'failed attempts must stay in the record');
  assert.equal(fragile.failed, 24);
  assert.ok(Math.abs(fragile.failureRate - 2 / 3) < 1e-9);
  assert.deepEqual(fragile.failures, ['error', 'truncated']);
  assert.equal(honest.failed, 0);

  // The fragile arm still shows a lower violation rate — that is expected and is exactly why the
  // failure rate has to be printed beside it rather than left for a reader to infer.
  assert.ok(fragile.rate < honest.rate);
  assert.ok(s.pages > scoreable(rows).length, 'the record count must include failures');
});

test('a failed page is never counted as a clean one', () => {
  const rows = [
    { brief: 'b1', arm: 'a', model: 'm', sample: 0, failed: true, failure: 'truncated' },
    row('b1', 'a', 1, { 'alt-missing': { v: 3, o: 4 } }),
  ];
  const s = summarise(rows);
  const arm = s.perArm.find((x) => x.arm === 'a');
  assert.equal(arm.clean, 0, 'a truncated page must not count towards the clean rate');
  assert.equal(arm.pages, 1);
  assert.equal(arm.attempted, 2);
});

test('a failed page does not count against an arm\'s consistency', () => {
  const ok = (s, palette) => row('b01', 'treated', s, { 'link-not-underlined': { v: 1, o: 10 } }, { drift: { palette } });
  const rows = [ok(0, 5), ok(1, 5), { ...ok(2, 40), failed: true, failure: 'truncated' }];
  assert.equal(summarise(rows).consistency.palette.treated.withinCellSd, 0, 'the truncated page was measured');
});

test('a reference arm with nothing to compare against yields no ratio, not Infinity', () => {
  const rows = [
    row('b1', 'clean', 0, { 'target-size': { v: 0, o: 10 } }),
    row('b1', 'dirty', 0, { 'target-size': { v: 3, o: 10 } }),
  ];
  const rr = rateRatio(rows, 'dirty', 'clean');
  assert.equal(rr.ratio, null);
  assert.match(rr.note, /no violations/);
  assert.ok(!Number.isFinite(rr.ratio), 'must not report Infinity as a point estimate');
});

test('a null effect is reported as a null effect', () => {
  // The guard against a harness that always finds something: identical arms must produce an
  // interval that includes 1.
  const rows = [];
  for (let b = 0; b < 12; b++) {
    for (const arm of ['control', 'treated']) {
      rows.push(row(`b${b}`, arm, 0, { 'target-size': { v: 5, o: 30 } }));
    }
  }
  const rr = rateRatio(rows, 'treated', 'control');
  assert.ok(rr.lo <= 1 && rr.hi >= 1, 'identical arms must not produce a significant difference');
});

test('the compiled arm stays inside the constraint budget, and states the floors at both ends', () => {
  // Arm E hands a model forty-six rules. The instruction-following work says follow rate collapses
  // well before that, so a win for the loop over arm E would be partly a measurement of prompt
  // length. This arm is the control: the same rules, compiled, so the comparison is the loop
  // against the rules rather than the loop against a prompt we overloaded.
  const compiled = compiledRuleContext();
  const statements = compiled.split('\n').filter((l) => l.startsWith('- ') || l.startsWith('**'));
  assert.ok(statements.length <= CONSTRAINT_BUDGET + 6, `compiled to ${statements.length} statements`);
  assert.ok(compiled.length < ruleContext().length / 2, 'it is materially shorter than the full list');
  const firstFloor = compiled.split('\n').find((l) => l.startsWith('- '));
  assert.notEqual(compiled.indexOf(firstFloor), compiled.lastIndexOf(firstFloor),
    'the floors are stated at both ends, which is where compliance is highest');
});

test('the primed arm differs from the plain one only by the brief', () => {
  const violations = [{ rule: 'measure', message: 'Measure must be under the ceiling' }];
  const plain = repairPrompt(violations, 'full', null);
  const primed = repairPrompt(violations, 'full', 'A page announcing a research toolkit.');
  assert.ok(!plain.includes('research toolkit'));
  assert.ok(primed.includes('research toolkit'), 'the primed arm is told what the page is for');
  assert.equal(primed.slice(primed.indexOf('The page failed')), plain.slice(plain.indexOf('The page failed')),
    'everything after the intent is identical, so the intent is the only variable between F and G');
});

test('the disclosed rate is per rendered element, and the loop ratio recovers a known effect', () => {
  const page = (brief, arm, disclosed) => ({ ...row(brief, arm, 0, { 'link-not-underlined': { v: 1, o: 10 } }), disclosed, opportunity: { elements: 100 } });
  assert.equal(disclosedPer100([page('b01', 'x', 3), page('b02', 'x', 5)]), 4);
  const rows = ['b01', 'b02', 'b03', 'b04'].flatMap((b) => [page(b, 'rules-read', 20), page(b, 'rules-run', 5)]);
  const rr = disclosedRatio(rows, 'rules-run', 'rules-read', { iterations: 200 });
  assert.equal(rr.ratio, 0.25);
  assert.ok(rr.lo <= 0.25 && rr.hi >= 0.25);
  assert.deepEqual(disclosedRatio(rows, 'rules-run', 'rules-read', { iterations: 200 }), rr, 'seeded: the same records give the same table');
  assert.equal(disclosedRatio(rows, 'rules-compiled', 'rules-read', { iterations: 200 }), null, 'an arm the run left out has no ratio');
  assert.doesNotThrow(() => tables(rows.filter((r) => r.arm === 'rules-read').map((r) => ({ ...r, model: 'stub' }))), 'a scoped run still renders');
  const text = tables(rows.map((r) => ({ ...r, model: 'stub', usage: { input: 10, output: 10 }, drift: { palette: 1 } })));
  for (const heading of ['Held-out rate', 'Disclosed-rule violations', 'axe-core', 'Palette drift', 'Cost per page', 'Failures']) assert.match(text, new RegExp(heading));
});
