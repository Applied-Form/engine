/**
 * `standards fix`: the deterministic fixer behind a command. A page with four faults the fixer knows how to
 * cure comes out passing and the command exits 0; a page with a fault it cannot cure exits 1 and names
 * the rule and the element; the input is never written; `--json` is a report a script can read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launchBrowser, lintPages } from '../src/lib/page-lint.mjs';
import { fixReport, selectorsOf, withBase, NOT_CHECKED } from '../src/lib/fix/page.mjs';
import { ENV } from '../src/lib/names.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STANDARDS_BIN = join(ROOT, 'bin/standards.mjs');
const TOKENS_CSS = pathToFileURL(join(ROOT, 'dist/tokens.css')).href;

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

/** The clean fixture's page, with four faults the fixer cures and, if asked, one it cannot. */
const page = ({ unfixable = false } = {}) => `<!doctype html>
<html lang="en" data-register="ii">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fixable</title>
<link rel="stylesheet" href="${TOKENS_CSS}">
<style>
  body { margin: 0; background: var(--af-color-white); color: var(--af-color-text-ii); font: var(--af-type-body-weight) var(--af-type-body-size)/var(--af-type-body-leading) var(--af-font-text); }
  main { max-width: 66ch; margin: 0 auto; padding: var(--af-space-04) var(--af-space-03); }
  h1 { font: var(--af-type-heading-02-weight) var(--af-type-heading-02-size)/var(--af-type-heading-02-leading) var(--af-font-text); margin: 0 0 var(--af-space-02); }
  h4 { margin: 0 0 var(--af-space-02); }
  p { margin: 0 0 var(--af-space-02); }
  .card { border-radius: 6px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); }
  p a.plain { text-decoration: none; }
  .tiny { display: inline-block; width: 12px; height: 12px; overflow: hidden; }
</style>
</head>
<body>
<main id="main">
  <h1>A page with four faults the fixer can cure</h1>
  <p class="card">This paragraph sits on a card with rounded corners and a shadow.</p>
  <p>Read the <a class="plain" href="#notes">notes</a> before you start.</p>${unfixable ? '\n  <h4>A heading that skips two levels</h4>' : ''}
  <div><a class="tiny" href="#main" aria-label="Back to the top"></a></div>
</main>
</body>
</html>
`;

const FIXABLE_FAULTS = ['link-not-underlined', 'radius-present', 'shadow-present', 'target-size'];
const WIDTHS = '320,1280';

const env = () => { const e = { ...process.env }; delete e.STANDARDS_SYSTEM; delete e[ENV.STANDARDS_SYSTEM]; return e; };
const standards = (args, cwd) => spawnSync(process.execPath, [STANDARDS_BIN, 'fix', ...args], { cwd, encoding: 'utf8', env: env(), timeout: 300000 });
const workspace = (html, name = 'page.html') => {
  // The command resolves paths against its working directory, which the system reports with links
  // followed: on macOS the temporary directory /var/folders/… is /private/var/folders/….
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'af-fix-cli-')));
  writeFileSync(join(dir, name), html);
  return { dir, file: join(dir, name) };
};

test('a page with four fixable faults comes out passing, beside the input, and exits 0', { skip }, async () => {
  const { dir, file } = workspace(page());
  const before = readFileSync(file);
  const r = standards(['page.html', '--widths', WIDTHS], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readFileSync(file), before, 'the input is untouched');
  const fixed = join(dir, 'page.fixed.html');
  assert.ok(existsSync(fixed), 'written as <name>.fixed.html');
  const html = readFileSync(fixed, 'utf8');
  assert.match(html, /<style data-af-fixes>/);
  assert.doesNotMatch(html, /data-af-base|data-af-id/, 'nothing of the checker is left in the page');
  for (const rule of FIXABLE_FAULTS) assert.match(r.stdout, new RegExp(rule), `${rule} is named in the log`);
  assert.match(r.stdout, /Not checked/);
  assert.match(r.stdout, /docs\/accessibility-scope\.md/);
  // The written page, linted on its own, is clean.
  const results = await lintPages([pathToFileURL(fixed).href], { browser, viewports: [320, 1280] });
  assert.deepEqual(results.flatMap((x) => x.violations.map((v) => v.rule)), []);
});

test('a page with a fault the fixer cannot cure exits 1 and names the rule and the element', { skip }, () => {
  const { dir, file } = workspace(page({ unfixable: true }));
  const before = readFileSync(file, 'utf8');
  const r = standards(['page.html', '--widths', WIDTHS], dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(readFileSync(file, 'utf8'), before, 'the input is untouched');
  assert.match(r.stdout, /heading-order {2}html > [^\n]*h4:nth-of-type\(1\) {2}at 320, 1280px/, `the rule and the element are named by its selector:\n${r.stdout}`);
  assert.ok(existsSync(join(dir, 'page.fixed.html')), 'what could be fixed is still written');
});

test('--json is one report: what was fixed, applied, refused and remains, and what was not checked', { skip }, () => {
  const { dir } = workspace(page({ unfixable: true }));
  const r = standards(['page.html', '--widths', WIDTHS, '--json', '--out', 'out/../custom.html'], dir);
  assert.equal(r.status, 1, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.passed, false);
  assert.equal(report.output, join(dir, 'custom.html'));
  assert.ok(existsSync(join(dir, 'custom.html')), '--out names where the page goes');
  assert.deepEqual(report.widths, [320, 1280]);
  assert.equal(report.register, 'ii');
  for (const rule of FIXABLE_FAULTS) assert.ok(report.fixed.includes(rule), `${rule} fixed: ${report.fixed}`);
  assert.ok(report.before.violations > report.after.violations);
  assert.ok(report.applied.length >= 4);
  for (const a of report.applied) {
    assert.match(a.selector, /^html > /);
    assert.ok(a.rules.length && Object.keys(a.declarations).length);
  }
  assert.ok(Array.isArray(report.refused));
  const left = report.remaining.find((x) => x.rule === 'heading-order');
  assert.ok(left, JSON.stringify(report.remaining));
  assert.deepEqual(left.widths, [320, 1280], 'one entry per rule and element, with the widths it failed at');
  assert.ok(left.fix, 'with the fix a person would make');
  assert.equal(report.notChecked.doc, NOT_CHECKED.doc);
  assert.match(NOT_CHECKED.note, /^A pass covers the rules Standards measures and nothing else\./, 'the note names the product Standards');
});

test('usage and load errors exit 2 and write nothing', () => {
  const { dir } = workspace(page());
  for (const args of [[], ['missing.html'], ['page.html', '--register', 'iii'], ['page.html', '--widths', 'wide'], ['page.html', '--system', 'no-such-system'], ['page.html', '--out']]) {
    const r = standards(args, dir);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /standards fix/);
  }
  assert.ok(!existsSync(join(dir, 'page.fixed.html')));
});

test('--system loads a system for the run, as STANDARDS_SYSTEM does for standards lint', { skip }, () => {
  // The rounded fixture permits radius on a scale, so the base system's radius-present cannot fire.
  const { dir } = workspace(page());
  const base = JSON.parse(standards(['page.html', '--widths', '1280', '--json'], dir).stdout);
  assert.ok(base.before.rules['radius-present'], JSON.stringify(base.before));
  const r = standards(['page.html', '--widths', '1280', '--json', '--system', join(ROOT, 'test/fixtures/rounded.tokens.json')], dir);
  const rounded = JSON.parse(r.stdout);
  assert.equal(rounded.system, join(ROOT, 'test/fixtures/rounded.tokens.json'));
  assert.ok(!rounded.before.rules['radius-present'], JSON.stringify(rounded.before));
});

test('the report reads one entry per element, with the selector the checker computed', () => {
  const v = (rule, extra) => ({ rule, message: `${rule} message`, ...extra });
  const spec = { spacingSources: [{ value: 25, sel: 'html > body > p:nth-of-type(2)' }, { value: 8, sel: 'x' }] };
  assert.deepEqual(selectorsOf(v('spacing', { value: 25 }), spec), ['html > body > p:nth-of-type(2)']);
  assert.deepEqual(selectorsOf(v('measure', { text: { sel: 'span', block: { sel: 'p' } } })), ['p']);
  assert.deepEqual(selectorsOf(v('register')), []);
  const results = [320, 1280].map((viewport) => ({ viewport, spec: { register: 'ii' }, violations: [v('heading-order', { text: { sel: 'h4' } })] }));
  const r = fixReport({ initial: [...results, { viewport: 320, spec: {}, violations: [v('radius-present')] }], results, applied: [{ sel: 'p', pseudo: '', rules: ['radius-present'], decl: { 'border-radius': '0' } }], refused: [] }, { widths: [320, 1280] });
  assert.equal(r.passed, false);
  assert.deepEqual(r.fixed, ['radius-present']);
  assert.equal(r.remaining.length, 1);
  assert.deepEqual(r.remaining[0].widths, [320, 1280]);
  assert.deepEqual(r.applied, [{ selector: 'p', pseudo: null, rules: ['radius-present'], declarations: { 'border-radius': '0' } }]);
});

test('the base tag that lets a page find its assets is removed from what is written', () => {
  const html = '<!doctype html><html><head><title>t</title></head><body></body></html>';
  const based = withBase(html, 'file:///some/dir/');
  assert.match(based.html, /<head><base href="file:\/\/\/some\/dir\/" data-af-base><title>/);
  assert.equal(based.strip(based.html), html);
  const own = '<html><head><base href="/x/"></head></html>';
  assert.equal(withBase(own, 'file:///y/').html, own, 'a page that sets its own base keeps it');
});

test('close browser', { skip }, async () => {
  await browser.close();
});
