/**
 * H4's operational half, tested without a browser or an API key.
 *
 * The judging itself needs humans or model access; everything that decides what a judging round
 * *means* — which items exist, which judges count, and how preference is related to conformance —
 * is arithmetic, and it is the part that must be fixed before any judgement exists rather than
 * chosen after seeing some. So it is tested against inputs whose right answer is known by
 * construction, the same way the drift inference is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItems, summarise, spearman, readCorrelation, PAIRS, QUESTION } from '../eval/judge.mjs';

const page = (brief, arm, model = 'opus') => ({ brief, model, arm, sample: 0, file: `/pages/${brief}-${arm}.html` });
const KEY = (brief, arm, model = 'opus') => `${brief}|${model}|${arm}|0`;

const RECORDS = ['b01', 'b02'].flatMap((b) =>
  ['none', 'prose', 'tokens', 'components', 'rules-read', 'rules-run', 'rules-run-primed'].map((a) => page(b, a)));

test('every item compares pages from the same brief, and only the pre-registered pairs', () => {
  // Across briefs the content differs, so a judge rates subject matter as much as execution and
  // arm is confounded with whatever the brief was about.
  const items = buildItems(RECORDS, { seed: 7 });
  const arms = items.filter((i) => i.kind === 'arm');
  assert.ok(arms.length > 0);
  for (const i of arms) {
    assert.equal(i.left.split('|')[0], i.right.split('|')[0], `${i.id} crosses briefs`);
    assert.equal(i.left.split('|')[1], i.right.split('|')[1], `${i.id} crosses models`);
    const pair = new Set([i.left.split('|')[2], i.right.split('|')[2]]);
    assert.ok(PAIRS.some((p) => pair.has(p.a) && pair.has(p.b)), `${i.id} is not a registered pair`);
  }
});

test('two samples are two groups, and the order records arrive in changes nothing', () => {
  // Cells run concurrently, so records land in whatever order the model answered. Grouped by brief
  // and model alone, each arm kept its last row, and the pages a judge saw depended on latency.
  const two = ['none', 'rules-run'].flatMap((arm) => [0, 1].map((sample) => ({ ...page('b01', arm), sample, file: `/pages/b01-${arm}-s${sample}.html` })));
  const ids = (rs) => buildItems(rs, { seed: 5 }).map((i) => `${i.id}:${i.left}:${i.right}`).sort();
  assert.deepEqual(ids(two), ids([...two].reverse()), 'arrival order changed the item set');
  const arm = buildItems(two, { seed: 5 }).filter((i) => i.kind === 'arm');
  assert.equal(arm.length, 4, 'one pair, two samples, both orders');
  for (const i of arm) assert.equal(i.left.split('|')[3], i.right.split('|')[3], `${i.id} pairs two different samples`);
});

test('without a rules arm, the anchor is cut from the same page whatever order the records came in', () => {
  const rs = ['prose', 'none', 'tokens'].map((a) => page('b01', a));
  const anchors = [{ kind: 'floor', key: 'anchors/unstyled.html' }];
  const against = (x) => buildItems(x, { seed: 2, anchors }).filter((i) => i.kind === 'anchor').map((i) => i.against);
  assert.deepEqual(against(rs), against([...rs].reverse()));
});

test('each pair appears in both orders, so position cannot become the finding', () => {
  // A judge who always picks the right-hand side has to cancel out rather than produce a result.
  const items = buildItems(RECORDS, { seed: 7 }).filter((i) => i.kind === 'arm');
  const seen = new Map();
  for (const i of items) {
    const unordered = [i.left, i.right].sort().join('::');
    seen.set(unordered, (seen.get(unordered) ?? 0) + 1);
  }
  for (const [pair, n] of seen) assert.equal(n, 2, `${pair} appears ${n} times, not twice`);
});

test('the item set is reproducible from its seed, so it can be pre-registered', () => {
  const a = buildItems(RECORDS, { seed: 42 }).map((i) => i.id);
  const b = buildItems(RECORDS, { seed: 42 }).map((i) => i.id);
  assert.deepEqual(a, b);
});

test('failed generations never reach a judge', () => {
  const withFailures = [...RECORDS, { brief: 'b03', model: 'opus', arm: 'rules-run', failed: true, failure: 'truncated' }];
  const items = buildItems(withFailures, { seed: 1 });
  assert.ok(!items.some((i) => i.id.includes('b03')), 'a page that was never produced is not a page');
});

test('a judge who prefers a page truncated mid-tag is excluded, and the exclusion is reported', () => {
  const items = buildItems(RECORDS, { seed: 3, broken: [{ key: 'broken/a.html', against: KEY('b01', 'rules-run') }], attentionEvery: 4 });
  const checks = items.filter((i) => i.kind === 'check');
  assert.ok(checks.length > 0, 'the set carries an attention check');
  const arm = items.find((i) => i.kind === 'arm');
  const judgements = [
    ...checks.map((c) => ({ item: c.id, judge: 'careless', choice: 'a' })),   // prefers the broken page
    ...checks.map((c) => ({ item: c.id, judge: 'careful', choice: 'b' })),
    { item: arm.id, judge: 'careless', choice: 'a' },
    { item: arm.id, judge: 'careful', choice: 'a' },
  ];
  const out = summarise(items, judgements);
  assert.deepEqual(out.judges.kept, ['careful']);
  assert.equal(out.judges.excluded.length, 1);
  assert.equal(out.judges.excluded[0].judge, 'careless');
  // A round that excluded its whole panel must not look like a clean result.
  const allCareless = summarise(items, checks.map((c) => ({ item: c.id, judge: 'careless', choice: 'a' })));
  assert.equal(allCareless.valid, false);
});

test('a tie counts half to each side', () => {
  const items = buildItems(RECORDS, { seed: 5 }).filter((i) => i.kind === 'arm');
  const one = items[0];
  const out = summarise([one], [{ item: one.id, judge: 'j', choice: 'tie' }]);
  assert.deepEqual(out.arms.map((r) => r.wins), [0.5, 0.5]);
});

test('THE check that can fail the round: if the unstyled floor anchor wins, nothing is valid', () => {
  // The floor anchor is a page the conformance rate scores well and no designer would ship. It
  // must lose. If it does not, the panel is not judging design, and no arm comparison from the
  // same round means anything — so the round is marked invalid rather than reported.
  const anchors = [{ kind: 'floor', key: 'anchors/unstyled.html' }, { kind: 'ceiling', key: 'anchors/human.html' }];
  const items = buildItems(RECORDS, { seed: 11, anchors });
  const anchorItems = items.filter((i) => i.kind === 'anchor' && i.anchor === 'floor');
  assert.ok(anchorItems.length > 0);

  const voteFor = (item, who) => ({ item: item.id, judge: 'j', choice: item.left === item.anchorKey ? (who === 'anchor' ? 'a' : 'b') : (who === 'anchor' ? 'b' : 'a') });

  const healthy = summarise(items, anchorItems.map((i) => voteFor(i, 'arm')));
  assert.equal(healthy.floorAnchorLost, true);
  assert.equal(healthy.valid, true);

  const broken = summarise(items, anchorItems.map((i) => voteFor(i, 'anchor')));
  assert.equal(broken.floorAnchorLost, false, 'the floor anchor won');
  assert.equal(broken.valid, false, 'a round whose floor anchor wins is not a result');
});

test('Spearman handles ties by mean rank, and refuses what it cannot answer', () => {
  assert.equal(spearman([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null, 'no variance, no correlation');
  assert.equal(spearman([1, 2], [1, 2]), null, 'two points are not a correlation');
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [1, 3, 2, 4])) < 1);
});

test('the conformance-to-preference reading names all three outcomes, and claims no test', () => {
  const items = buildItems(RECORDS, { seed: 9 }).filter((i) => i.kind === 'arm');
  const votes = items.map((i) => ({ item: i.id, judge: 'j', choice: 'a' }));
  // Conformance here is a rate where lower is better, so a positive Spearman against preference
  // share would mean worse-conforming pages are preferred.
  const out = summarise(items, votes, { conformance: { none: 0.9, prose: 0.5, 'rules-read': 0.3, 'rules-run': 0.1, 'rules-run-primed': 0.1, components: 0.4, tokens: 0.6 } });
  assert.ok(out.conformanceVsPreference.spearman !== null);
  assert.match(out.conformanceVsPreference.caveat, /not a test/);
  assert.ok(out.conformanceVsPreference.arms >= 3);
});

test('each of the three pre-registered outcomes is reachable and says the right thing', () => {
  // The first version of this test asserted `phrase instanceof RegExp`, which is true of every
  // regex and therefore tested nothing. The branches are the whole point of pre-registering an
  // interpretation, so they are driven directly.
  assert.match(readCorrelation(0.8), /usable proxy/);
  assert.match(readCorrelation(-0.8), /making pages worse.*publish first/);
  assert.match(readCorrelation(0.0), /enforces conformance and nothing more/);
  assert.match(readCorrelation(0.2), /unrelated here/, 'a weak positive is not a proxy at this scale');
  assert.match(readCorrelation(-0.2), /unrelated here/);
  assert.match(readCorrelation(null), /not computable/);
});

test('the question put to a judge is one question, and gives them a way to say "I cannot tell"', () => {
  assert.match(QUESTION, /"tie"/);
  assert.equal(QUESTION.split('?').length - 1, 1, 'one question mark, one question');
});
