/**
 * The study's pipeline, end to end, on the stub — generate, extract, normalise, score, record.
 *
 * `eval/README.md` has said from the start that `--models stub` proves the plumbing for free. It
 * did, until 3.1.0 moved `paletteDistance` into `src/lib/lab.mjs` and left `eval/score.mjs` with a
 * re-export: importers still got the function, the scorer's own scope did not, and every cell of
 * every run from then on recorded `failure: "error"`. The unit suite passed throughout, because it
 * imported the function and never called `score()`. The documented dry run would have caught it on
 * the first cell, and nobody ran it. This test is that dry run, made unavoidable: one brief, two
 * arms, both stubs, through a real browser, asserting that a cell scores rather than errors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { generate, extractHtml } from '../eval/providers.mjs';
import { score, paletteFrom, normalise } from '../eval/score.mjs';
import { classifyFailure, harnessFingerprint, fileSafe } from '../eval/run.mjs';

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

const palette = paletteFrom('eval/fixtures/meridian.merged.tokens.json');
const dir = mkdtempSync(join(tmpdir(), 'af-harness-'));

async function cell(modelKey, prompt) {
  const out = await generate([{ role: 'user', content: prompt }], modelKey);
  const html = normalise(extractHtml(out.text).html, 'ii').html;
  const file = join(dir, `${modelKey}-${prompt.length}.html`);
  writeFileSync(file, html);
  const failure = classifyFailure({ stop: out.stop, html });
  const s = await score(pathToFileURL(file).href, { register: 'ii', palette, browser });
  return { out, failure, s };
}

test('a stub cell scores: the scorer returns rates, drift and an axe count rather than throwing', { skip }, async () => {
  const { out, failure, s } = await cell('stub', 'A page. '.repeat(3));
  assert.equal(out.route, 'stub');
  assert.equal(failure, null);
  assert.equal(typeof s.universal, 'number');
  assert.ok(s.perRule && Object.keys(s.perRule).length > 0, 'per-rule opportunities are recorded');
  assert.equal(typeof s.axe.count, 'number');
  assert.ok(s.drift && 'palette' in s.drift && 'spacing' in s.drift, 'drift is measured against the study palette');
  // The key being present is not the measure being taken: an empty palette returned null here for
  // every page of the first real run, and this test still passed.
  assert.equal(typeof s.drift.palette, 'number', 'palette drift was not computed: is the study palette empty?');
});

test('a sloppy stub page scores worse than a clean one, so the metric moves in the direction it should', { skip }, async () => {
  // The stub's output depends on the prompt length: one residue class is clean, the others sloppy.
  const results = [];
  for (const len of [3, 4, 5]) results.push((await cell('stub', 'A page. '.repeat(len))).s.universal);
  assert.ok(Math.max(...results) > Math.min(...results), `all three stub pages scored ${results[0]}; the stub is not varying or the scorer is not seeing it`);
});

test('the flaky stub reaches the failure accounting, and a failed page is labelled rather than scored clean', { skip }, async () => {
  const labels = new Set();
  for (let len = 1; len <= 10; len++) labels.add((await cell('stub-flaky', 'A page. '.repeat(len))).failure);
  for (const expected of ['refused', 'truncated', 'incomplete-html']) assert.ok(labels.has(expected), `${expected} never occurred across ten flaky cells`);
});

test('close browser', { skip }, async () => { await browser.close(); });

test('the study palette is read from the 2025.10 colour form, not only the string form', () => {
  const merged = JSON.parse(readFileSync('eval/fixtures/meridian.merged.tokens.json', 'utf8'));
  assert.ok(palette.length >= 10, `the study palette has ${palette.length} colours`);
  assert.ok(palette.includes(merged.color.paper.$value.hex.toUpperCase()));
});

test('a run measures the system the model was given, and keeps what the model cost', { skip }, () => {
  // The first real run linted every page against Applied Form's own tokens while the model held
  // Meridian's, and recorded no token usage because the scorer's result overwrote it. One stub cell
  // through the real entry point holds all three: the system, the cost, and the drift.
  const out = join(dir, 'run', 'r.jsonl');
  const r = spawnSync(process.execPath, ['eval/run.mjs', '--models', 'stub', '--briefs', 'b01', '--arms', 'components', '--samples', '1', '--out', out], { encoding: 'utf8', env: { ...process.env, AF_BRAND: '' } });
  assert.equal(r.status, 0, r.stderr);
  const merged = JSON.parse(readFileSync('eval/fixtures/meridian.merged.tokens.json', 'utf8'));
  assert.match(r.stdout, new RegExp(`study system: .*meridian\\.merged\\.tokens\\.json \\(paper ${merged.color.paper.$value.hex}\\)`));
  const [row] = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(row.usage.input > 0 && row.usage.output > 0, `token usage was lost: ${JSON.stringify(row.usage)}`);
  assert.equal(typeof row.computed.colours, 'number');
  assert.equal(typeof row.drift.palette, 'number');
});

test('cells run concurrently and each is recorded exactly once, and a re-run resumes rather than repeats', { skip }, () => {
  const out = join(dir, 'conc', 'c.jsonl');
  const args = ['eval/run.mjs', '--models', 'stub', '--briefs', 'b01,b07', '--arms', 'none,prose', '--samples', '2', '--concurrency', '3', '--out', out];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const keys = (f) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => `${r.brief}|${r.arm}|${r.sample}`);
  const once = keys(out);
  assert.equal(once.length, 8);
  assert.equal(new Set(once).size, 8, 'no cell twice');
  const files = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l).file);
  assert.equal(new Set(files).size, 8, 'two samples of one cell write two pages, not one page twice');
  const again = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(keys(out).length, 8, 'the second run skipped every recorded cell');
  assert.match(again.stdout, /skip/);
  const other = spawnSync(process.execPath, [...args, '--repairs', '1'], { encoding: 'utf8' });
  assert.equal(other.status, 2, 'a resume with a different repair cap would mix two treatments in one arm');
  assert.match(other.stderr, /repairs 3.*repairs 1/s);
  assert.equal(keys(out).length, 8, 'and it wrote nothing');
  const narrower = spawnSync(process.execPath, args.map((a) => (a === '2' ? '1' : a)), { encoding: 'utf8' });
  assert.equal(narrower.status, 2, 'a resume with fewer samples would leave the second sample in a run that claims one');
  assert.match(narrower.stderr, /scope/);
  const faster = spawnSync(process.execPath, args.map((a) => (a === '3' ? '2' : a)), { encoding: 'utf8' });
  assert.equal(faster.status, 0, 'concurrency is the one setting a resume may change');
  const repeated = spawnSync(process.execPath, args.map((a) => (a === 'none,prose' ? 'none,prose,none' : a)), { encoding: 'utf8' });
  assert.equal(repeated.status, 0, 'a repeated selector is the same scope, not a second copy of each cell');
  assert.equal(keys(out).length, 8);
});

test('a count that is not a whole number in range is refused before anything runs', () => {
  for (const [flag, bad] of [['concurrency', 'four'], ['concurrency', '0'], ['concurrency', '2.5'], ['samples', 'two'], ['repairs', 'three'], ['repairs', '-1']]) {
    const out = join(dir, 'bad', `${flag}-${bad}.jsonl`);
    const r = spawnSync(process.execPath, ['eval/run.mjs', '--models', 'stub', '--briefs', 'b01', '--arms', 'none', `--${flag}`, bad, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 2, `--${flag} ${bad} exited ${r.status}`);
    assert.match(r.stderr, new RegExp(`--${flag}`));
  }
});

test('the harness fingerprint moves when anything that defines the experiment moves', () => {
  const root = mkdtempSync(join(tmpdir(), 'af-fp-'));
  mkdirSync(join(root, 'eval', 'fixtures'), { recursive: true });
  mkdirSync(join(root, 'src', 'lib'), { recursive: true });
  writeFileSync(join(root, 'eval', 'arms.mjs'), 'export const A = 1;');
  writeFileSync(join(root, 'eval', 'fixtures', 'study.tokens.json'), '{}');
  writeFileSync(join(root, 'src', 'lib', 'rules.mjs'), 'export {}');
  const a = harnessFingerprint(root);
  assert.equal(harnessFingerprint(root), a, 'stable');
  writeFileSync(join(root, 'eval', 'fixtures', 'study.tokens.json'), '{"x":1}');
  const b = harnessFingerprint(root);
  assert.notEqual(b, a, 'the study system changed');
  writeFileSync(join(root, 'src', 'lib', 'rules.mjs'), 'export const x = 1;');
  const c = harnessFingerprint(root);
  assert.notEqual(c, b, 'the gate changed');
  mkdirSync(join(root, 'tokens'), { recursive: true });
  writeFileSync(join(root, 'tokens', 'applied-form.tokens.json'), '{}');
  const d = harnessFingerprint(root);
  assert.notEqual(d, c, 'the base tokens the study system is merged over changed');
  mkdirSync(join(root, 'fonts'), { recursive: true });
  writeFileSync(join(root, 'fonts', 'Face.woff2'), 'x');
  assert.notEqual(harnessFingerprint(root), d, 'a font the CSS builder would declare was added');
  const e = harnessFingerprint(root);
  mkdirSync(join(root, 'eval', 'results'), { recursive: true });
  mkdirSync(join(root, 'eval', 'runs', 'x', 'pages'), { recursive: true });
  writeFileSync(join(root, 'eval', 'results', 'pilot.jsonl'), '{}');
  writeFileSync(join(root, 'eval', 'runs', 'x', 'pages', 'p.html'), '<p>');
  writeFileSync(join(root, 'eval', 'README.md'), 'prose');
  assert.equal(harnessFingerprint(root), e, 'what a run writes, and what only describes it, are not the experiment');
  const out = join(root, 'eval', 'pilots', 'run.jsonl');
  const before = harnessFingerprint(root, undefined, { outputs: [out, join(root, 'eval', 'pilots', 'pages')] });
  mkdirSync(join(root, 'eval', 'pilots', 'pages'), { recursive: true });
  writeFileSync(out, '{"brief":"b01"}\n');
  writeFileSync(join(root, 'eval', 'pilots', 'pages', 'p.html'), '<p>');
  assert.equal(harnessFingerprint(root, undefined, { outputs: [out, join(root, 'eval', 'pilots', 'pages')] }), before, 'an --out anywhere is its own output, not the experiment');
});

test('a route:id model key names a page file an artifact can carry', () => {
  // The pilot of azure:gpt-5-mini generated every page and lost them all: the artifact upload
  // refuses a colon in a file name, and an OpenRouter id's slash would have made a directory.
  assert.equal(fileSafe('azure:gpt-5-mini'), 'azure_gpt-5-mini');
  assert.equal(fileSafe('openrouter:anthropic/claude-sonnet-5'), 'openrouter_anthropic_claude-sonnet-5');
  // A table key is already safe and keeps its name, so the committed pilots still find their pages.
  for (const key of ['opus-5', 'haiku-4-5', 'sonnet-5-5', 'stub-flaky']) assert.equal(fileSafe(key), key);
});
