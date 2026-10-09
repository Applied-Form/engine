/**
 * The judging runner, driven offline by the stub judge.
 *
 * The stub judge has one fixed preference — the larger screenshot — which is wrong in a known
 * way and therefore useful: it should lose the unstyled floor anchor (less rendered content),
 * pass the truncated attention check (less again), and produce a round the summary calls valid.
 * If any of that stops being true, the round's own instruments have broken, which is the thing
 * this file is for. Nothing here says anything about design quality.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { unstyle, truncate, parseChoice, prepare, judgeRound } from '../eval/judge-run.mjs';
import { judge } from '../eval/providers.mjs';

test('unstyle removes every styling a page carries and nothing else', () => {
  const html = '<html><head><style>body{color:red}</style><link rel="stylesheet" href="x.css"><title>T</title></head><body style="margin:0"><p class="k" style=\'color:blue\'>Text</p></body></html>';
  const out = unstyle(html);
  assert.ok(!/<style|stylesheet|style=/.test(out), out);
  assert.match(out, /<title>T<\/title>/);
  assert.match(out, /<p class="k">Text<\/p>/);
});

test('an answer is one of three words or it is nothing', () => {
  assert.equal(parseChoice('a'), 'a');
  assert.equal(parseChoice(' B. '), 'b');
  assert.equal(parseChoice('"tie"'), 'tie');
  assert.equal(parseChoice('Answer: a'), 'a');
  assert.equal(parseChoice('I prefer the left one'), null, 'prose is not a vote, and must not become one for b');
  assert.equal(parseChoice(''), null);
});

test('the stub judge prefers the larger image, deterministically', async () => {
  const big = Buffer.alloc(10), small = Buffer.alloc(3);
  assert.equal((await judge([big, small], 'q', 'stub')).text, 'a');
  assert.equal((await judge([small, big], 'q', 'stub')).text, 'b');
  assert.equal((await judge([big, big], 'q', 'stub')).text, 'tie');
});

/** A tiny study: two briefs, one model, three arms, with pages that differ in how much they render. */
function tinyRun() {
  const dir = mkdtempSync(join(tmpdir(), 'af-judge-'));
  mkdirSync(join(dir, 'pages'));
  const page = (title, n, styled = true) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${styled ? '<style>body{font-family:system-ui;margin:0;padding:32px;background:#F2F6F3;color:#222B26}main{max-width:640px}h1{font-size:40px}p{font-size:19px;line-height:1.5}</style>' : ''}</head><body><main><h1>${title}</h1>${'<p>A paragraph of body copy that fills the page with text so that the rendered area grows with the content.</p>'.repeat(n)}</main></body></html>`;
  const rows = [];
  for (const brief of ['b01', 'b02']) {
    for (const [arm, n] of [['none', 2], ['prose', 4], ['rules-run', 6]]) {
      const file = join(dir, 'pages', `${brief}-${arm}-stub-r0.html`);
      writeFileSync(file, page(`${brief} ${arm}`, n));
      rows.push({ brief, register: 'ii', arm, model: 'stub', route: 'stub', sample: 0, failed: false, file, universal: 6 - n, perRule: { 'target-size': { v: 6 - n, o: 10 } }, styling: { declarations: 8, fonts: 1 } });
    }
  }
  const jsonl = join(dir, 'tiny.jsonl');
  writeFileSync(jsonl, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, jsonl };
}

test('prepare builds within-brief items, a floor anchor per group, and interleaved checks', () => {
  const { jsonl } = tinyRun();
  const { items, files, conformance } = prepare(jsonl, { seed: 3 });
  const arm = items.filter((i) => i.kind === 'arm');
  const anchor = items.filter((i) => i.kind === 'anchor');
  const check = items.filter((i) => i.kind === 'check');
  assert.ok(arm.length >= 4, 'two briefs × at least one pre-registered pair × both orders');
  for (const i of arm) assert.equal(i.left.split('|')[0], i.right.split('|')[0], 'a pair never crosses briefs');
  assert.equal(anchor.length, 4, 'one floor anchor per group, both orders');
  assert.ok(anchor.every((i) => i.anchor === 'floor'), 'no ceiling anchor is invented');
  assert.ok(check.length >= 1, 'at least one attention check was placed');
  for (const i of items) for (const k of [i.left, i.right]) assert.ok(files.has(k), `${k} has no file behind it`);
  assert.ok(Number.isFinite(conformance['rules-run']), 'conformance per arm comes from the run');
});

test('a round resumes only under the panel that started it', async () => {
  const { jsonl, dir } = tinyRun();
  const out = join(dir, 'judging.jsonl');
  writeFileSync(out, JSON.stringify({ item: 'x', judge: 'stub', panel: 'stub', choice: 'a' }) + '\n');
  await assert.rejects(judgeRound(jsonl, { judges: ['stub', 'stub-flaky'], out, browser: null }), /panel stub,.*stub,stub-flaky/s, 'a judge added mid-round');
  writeFileSync(out, JSON.stringify({ item: 'x', judge: 'stub-old', panel: 'stub,stub-old', choice: 'a' }) + '\n');
  await assert.rejects(judgeRound(jsonl, { judges: ['stub'], out, browser: null }), /stub,stub-old/, 'a judge dropped mid-round');
  writeFileSync(out, JSON.stringify({ item: 'x', judge: 'stub', panel: 'stub', round: 'an-older-round:seed1', choice: 'a' }) + '\n');
  await assert.rejects(judgeRound(jsonl, { judges: ['stub'], out, seed: 1, browser: null }), /round an-older-round/, 'the judging code changed mid-round');
});

test('a page changed in place is a different round', async () => {
  const { jsonl, dir } = tinyRun();
  const out = join(dir, 'judging.jsonl');
  // The round identity is computed before any judging; capture it from a refusal against a stale row.
  writeFileSync(out, JSON.stringify({ item: 'x', judge: 'stub', panel: 'stub', round: 'stale', choice: 'a' }) + '\n');
  const roundOf = async () => { try { await judgeRound(jsonl, { judges: ['stub', 'stub'], out, browser: null }); } catch (e) { return /this one is (\S+)/.exec(e.message)?.[1]; } };
  const before = await roundOf();
  assert.ok(before, 'the refusal names the current round');
  writeFileSync(join(dir, 'pages', 'b01-none-stub-r0.html'), '<!doctype html><html><body><p>replaced</p></body></html>');
  assert.notEqual(await roundOf(), before, 'the same paths with different pages');
});

test('a record whose page is gone is counted, not silently dropped', () => {
  const { jsonl, dir } = tinyRun();
  rmSync(join(dir, 'pages', 'b01-none-stub-r0.html'));
  const { missing, usable } = prepare(jsonl, { seed: 3 });
  assert.equal(missing, 1);
  assert.equal(usable.length, 5);
});

test('a full round with the stub judge: the floor anchor loses, the check passes, the round is valid', async () => {
  let browser = null;
  try { browser = await launchBrowser(); } catch (e) { if (process.env.CI) throw e; return; }
  try {
    const { jsonl, dir } = tinyRun();
    const summary = await judgeRound(jsonl, { judges: ['stub'], out: join(dir, 'judging.jsonl'), seed: 3, browser });
    assert.equal(summary.valid, true, JSON.stringify(summary));
    assert.equal(summary.floorAnchorLost, true, 'an unstyled page renders less and the stub should not prefer it');
    assert.deepEqual(summary.judges.excluded, [], 'the stub passes the truncated-page check');
    assert.equal(summary.unparsed, 0);
    assert.equal(summary.arms[0].arm, 'rules-run', 'the arm with the most rendered content wins under this judge');
    assert.match(summary.ceilingAnchor, /absent/);
    // Resumable: a second round over the same file answers nothing new and reaches the same result.
    const again = await judgeRound(jsonl, { judges: ['stub'], out: join(dir, 'judging.jsonl'), seed: 3, browser });
    assert.equal(again.judgements, summary.judgements);
  } finally { await browser.close(); }
});

test('a panel drawn entirely from the generators’ family is refused unless explicitly allowed', async () => {
  const { jsonl } = tinyRun();
  // The tiny run's generator route is `stub`, so a real route is substituted on the rows to make the check bite.
  const { readFileSync, writeFileSync: w } = await import('node:fs');
  w(jsonl, readFileSync(jsonl, 'utf8').replaceAll('"route":"stub"', '"route":"anthropic"'));
  process.env.ANTHROPIC_API_KEY = 'x';
  await assert.rejects(() => judgeRound(jsonl, { judges: ['haiku-5-5'], browser: null }), /shares a family/);
  delete process.env.ANTHROPIC_API_KEY;
});

test('truncate cuts mid-page', () => {
  assert.equal(truncate('0123456789').length, 6);
});
