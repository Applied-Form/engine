import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { fingerprint, pageKey, severityOf, applyPolicy, buildBaseline, loadConfig, loadBaseline, policyNotes, mergeBaseline, splitArgs } from '../src/lib/policy.mjs';

const v = (rule, extra = {}) => ({ rule, message: `${rule} happened`, ...extra });
const page = (url, viewport, violations) => ({ url, viewport, violations, advisories: [] });

test('a fingerprint identifies rule and place, and ignores the measurement', () => {
  const a = { rule: 'contrast', message: 'Contrast 3.75:1 is below the 4.5:1 floor', text: { sample: 'Skip to content' } };
  const b = { rule: 'contrast', message: 'Contrast 3.91:1 is below the 4.5:1 floor', text: { sample: 'Skip to content' } };
  assert.equal(fingerprint(a), fingerprint(b), 'a colour that moves is the same known violation');
  assert.equal(fingerprint(a), 'contrast|Skip to content');
  assert.notEqual(fingerprint(a), fingerprint({ ...a, text: { sample: 'Read more' } }));
  assert.equal(fingerprint(v('spacing', { value: 7 })), 'spacing|7');
  assert.equal(fingerprint(v('horizontal-overflow')), 'horizontal-overflow|', 'no locator is still stable');
});

test('a page key is stable across machines and environments', () => {
  assert.equal(pageKey('file:///repo/examples/a.html', 1280, '/repo'), 'examples/a.html@1280');
  assert.equal(pageKey('https://staging.example.com/pricing', 320), '/pricing@320');
  assert.equal(pageKey('https://example.com/pricing', 320), '/pricing@320', 'staging and production share a baseline');
});

test('severity defaults to error and is overridden per rule', () => {
  assert.equal(severityOf('measure'), 'error');
  assert.equal(severityOf('measure', { rules: { measure: 'warn' } }), 'warn');
  assert.deepEqual(policyNotes({ rules: { measure: 'warn', spacing: 'off', contrast: 'error' } }), ['measure: warn', 'spacing: off']);
});

test('warnings are reported and do not fail; off is silent', () => {
  const results = [page('file:///r/a.html', 1280, [v('contrast'), v('measure'), v('spacing')])];
  const { summary, failed, results: out } = applyPolicy(results, { config: { rules: { measure: 'warn', spacing: 'off' } }, cwd: '/r' });
  assert.deepEqual(out[0].errors.map((x) => x.rule), ['contrast']);
  assert.deepEqual(out[0].warnings.map((x) => x.rule), ['measure']);
  assert.equal(summary.errors, 1);
  assert.equal(summary.warnings, 1);
  assert.equal(failed, true);
  const clean = applyPolicy(results, { config: { rules: { contrast: 'warn', measure: 'warn', spacing: 'off' } }, cwd: '/r' });
  assert.equal(clean.failed, false, 'a run of warnings does not fail');
  assert.equal(clean.summary.clean, 1);
});

test('a baseline holds known violations and lets new ones through', () => {
  const before = [page('file:///r/a.html', 1280, [v('contrast', { text: { sample: 'old' } }), v('measure', { text: { sample: 'old' } })])];
  const baseline = buildBaseline(before, { cwd: '/r' });
  assert.equal(baseline.version, 1);
  assert.deepEqual(Object.keys(baseline.entries), ['a.html@1280']);

  const same = applyPolicy(before, { baseline, cwd: '/r' });
  assert.equal(same.failed, false, 'a baselined codebase passes unchanged');
  assert.equal(same.summary.known, 2);
  assert.equal(same.summary.errors, 0);

  const worse = [page('file:///r/a.html', 1280, [...before[0].violations, v('contrast', { text: { sample: 'new' } })])];
  const after = applyPolicy(worse, { baseline, cwd: '/r' });
  assert.equal(after.failed, true, 'a new violation still fails');
  assert.deepEqual(after.results[0].errors.map((x) => x.text.sample), ['new']);
  assert.equal(after.summary.known, 2);
});

test('the baseline counts occurrences, so a fourth of three known violations is new', () => {
  const three = [page('file:///r/a.html', 1280, [v('spacing', { value: 7 }), v('spacing', { value: 7 }), v('spacing', { value: 7 })])];
  const baseline = buildBaseline(three, { cwd: '/r' });
  assert.equal(baseline.entries['a.html@1280']['spacing|7'], 3);
  assert.equal(applyPolicy(three, { baseline, cwd: '/r' }).failed, false);
  const four = [page('file:///r/a.html', 1280, [...three[0].violations, v('spacing', { value: 7 })])];
  const run = applyPolicy(four, { baseline, cwd: '/r' });
  assert.equal(run.summary.errors, 1);
  assert.equal(run.summary.known, 3);
});

test('violations that disappear are reported as fixed, so a burn-down is visible', () => {
  const before = [page('file:///r/a.html', 1280, [v('contrast', { text: { sample: 'a' } }), v('measure', { text: { sample: 'b' } })])];
  const baseline = buildBaseline(before, { cwd: '/r' });
  const after = applyPolicy([page('file:///r/a.html', 1280, [v('contrast', { text: { sample: 'a' } })])], { baseline, cwd: '/r' });
  assert.equal(after.summary.fixed, 1);
  assert.deepEqual(after.summary.fixedRules, ['measure']);
  assert.equal(after.failed, false);
});

test('a baseline never hides a violation on a page it did not cover', () => {
  const baseline = buildBaseline([page('file:///r/a.html', 1280, [v('contrast')])], { cwd: '/r' });
  const other = applyPolicy([page('file:///r/b.html', 1280, [v('contrast')])], { baseline, cwd: '/r' });
  assert.equal(other.failed, true);
  const otherViewport = applyPolicy([page('file:///r/a.html', 320, [v('contrast')])], { baseline, cwd: '/r' });
  assert.equal(otherViewport.failed, true, 'a violation at another viewport is a different violation');
});

test('config: a missing implicit file is fine, a bad severity is not', () => {
  // Given a directory with no af.config.json, the system's defaults apply. (Given an explicit path
  // that does not exist, it throws — see the test below.)
  const c = loadConfig('/nonexistent');
  assert.deepEqual(c, { rules: {}, baseline: null, source: null });
  assert.throws(() => loadConfig(fileURLToPath(new URL('../test/fixtures/af.config.bad.json', import.meta.url))), /expected one of/);
});

test('a page the run did not visit is not reported as fixed', () => {
  // Otherwise `af lint a.html` says "N fixed, re-run --baseline-write", the user does, and every
  // held violation on b.html is forgotten. "Not linted today" is not "fixed".
  const a = { url: 'file:///r/a.html', viewport: 1280, violations: [{ rule: 'measure', text: { sample: 'x' } }] };
  const b = { url: 'file:///r/b.html', viewport: 1280, violations: [{ rule: 'spacing', value: 13 }] };
  const baseline = buildBaseline([a, b], { cwd: '/r' });
  const { summary } = applyPolicy([a], { baseline, cwd: '/r' });
  assert.equal(summary.known, 1);
  assert.equal(summary.fixed, 0, 'b.html was not linted, so nothing on it is fixed');
});

test('rewriting a baseline keeps the pages it did not visit', () => {
  const a = { url: 'file:///r/a.html', viewport: 1280, violations: [{ rule: 'measure', text: { sample: 'x' } }] };
  const b = { url: 'file:///r/b.html', viewport: 1280, violations: [{ rule: 'spacing', value: 13 }] };
  const previous = buildBaseline([a, b], { cwd: '/r' });
  // a.html is now clean; only a.html was linted.
  const fresh = buildBaseline([{ ...a, violations: [] }], { cwd: '/r' });
  const { baseline, kept } = mergeBaseline(previous, fresh, new Set(['a.html@1280']));
  assert.deepEqual(kept, ['b.html@1280']);
  assert.equal(baseline.entries['a.html@1280'], undefined, 'a visited, now-clean page loses its entries');
  assert.deepEqual(baseline.entries['b.html@1280'], previous.entries['b.html@1280'], 'an unvisited page keeps its entries');
});

test('an explicitly named config or baseline file must exist', () => {
  assert.throws(() => loadConfig('test/fixtures/does-not-exist.json'), /config file not found/);
  assert.throws(() => loadBaseline('test/fixtures/does-not-exist.json', { required: true }), /baseline file not found/);
  // The implicit default may be absent: that just means the system's defaults apply.
  assert.deepEqual(loadConfig('/nonexistent-dir').rules, {});
  assert.deepEqual(loadBaseline('test/fixtures/does-not-exist.json').entries, {});
});

test('--baseline without a value does not swallow the next page', () => {
  assert.deepEqual(splitArgs(['--baseline', 'a.html', 'b.html']), { files: ['a.html', 'b.html'], opts: { baseline: true } });
  assert.deepEqual(splitArgs(['--baseline', 'bl.json', 'a.html']), { files: ['a.html'], opts: { baseline: 'bl.json' } });
  assert.deepEqual(splitArgs(['a.html', '--config', 'c.json', '--json']), { files: ['a.html'], opts: { config: 'c.json', json: true } });
  assert.deepEqual(splitArgs(['a.html', '--baseline-write', '--out', 'o.json']), { files: ['a.html'], opts: { 'baseline-write': true, out: 'o.json' } });
});

test('page keys are stable across the directory the linter is run from', () => {
  // Keyed relative to a fixed base (the baseline file's directory), the same page produces the same
  // key whether the command was run from the repo root or from inside examples/.
  const url = 'file:///repo/examples/register-ii.html';
  assert.equal(pageKey(url, 1280, '/repo'), pageKey(url, 1280, '/repo'));
  assert.equal(pageKey(url, 1280, '/repo'), 'examples/register-ii.html@1280');
  assert.notEqual(pageKey(url, 1280, '/repo/examples'), pageKey(url, 1280, '/repo'), 'the base is what fixes the key; callers must pass the same one');
});
