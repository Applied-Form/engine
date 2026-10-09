/**
 * The gate as tools. The point of these tests is not that JSON-RPC works; it is that a model
 * calling af_lint is told what is wrong *and what to change*, because that is the whole argument
 * for a loop over a paragraph of rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, TOOLS, HANDLERS, SERVER, closeBrowser } from '../src/lib/mcp.mjs';
import { RULES } from '../src/lib/rules/registry.mjs';

const call = (name, args = {}) => handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const payload = (r) => JSON.parse(r.result.content[0].text);

test('the server introduces itself and lists its tools', async () => {
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.serverInfo.name, 'applied-form');
  assert.ok(init.result.capabilities.tools);
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(),
    ['af_brand', 'af_contrast', 'af_drift', 'af_lint', 'af_move', 'af_rules', 'af_system', 'af_tokens']);
  for (const t of list.result.tools) {
    assert.ok(t.description.length > 40, `${t.name} explains itself`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('it serves the gate, not the ruleset: nothing here re-serves a system', () => {
  // appliedform/standards already serves what a system *is*. A second server doing the same job
  // would be two sources of truth for one answer. These tools answer whether an artefact obeys.
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes('af_lint'), 'measuring is the reason this exists');
  assert.ok(!names.some((n) => /get_system|list_systems|instruction/.test(n)));
});

test('af_rules returns the fix beside every rule', async () => {
  const rules = payload(await call('af_rules', { group: 'absence' }));
  assert.ok(rules.length >= 3);
  for (const r of rules) {
    assert.equal(r.group, 'absence');
    assert.ok(r.fix, `${r.id} carries its fix`);
  }
  const wcagOnly = payload(await call('af_rules', { wcag: true }));
  assert.ok(wcagOnly.every((r) => r.wcag.length > 0));
  assert.ok(wcagOnly.length < RULES.length, 'most rules are house style with no WCAG basis');
});

test('af_contrast measures, and says which number is the gate', async () => {
  const r = payload(await call('af_contrast', { foreground: '#8A3B1C', background: '#FFFFFF' }));
  assert.equal(r.ratio, 7.71);
  assert.equal(r.passes, true);
  assert.match(r.note, /WCAG 2 is the gate/);
  const bad = payload(await call('af_contrast', { foreground: '#C98C5C', background: '#FFFFFF', sizePx: 14 }));
  assert.equal(bad.passes, false);
});

test('af_brand refuses a palette it cannot make work, rather than emitting one', async () => {
  const good = payload(await call('af_brand', { hue: 210, paper: '#F4F7FA' }));
  assert.ok(good.derived.primary, 'a workable hue derives');
  const bad = payload(await call('af_brand', { hue: 210, paper: '#333333' }));
  assert.ok(bad.refused, 'a paper too dark to build on is refused');
});

test('af_tokens hands over values instead of letting a model guess one', async () => {
  const all = payload(await call('af_tokens'));
  assert.ok(all.colour.terracotta, 'the palette');
  assert.deepEqual(all.absent, ['shadow', 'gradient-fill', 'radius']);
  const one = payload(await call('af_tokens', { group: 'floors' }));
  assert.equal(one.floors.maxMeasureCh, 66);
});

test('af_move hands over one recipe, not the whole table', async () => {
  const list = payload(await call('af_move'));
  assert.ok(list.moves.includes('colossus'));
  assert.match(list.note, /One move is active per artefact/);
  const one = payload(await call('af_move', { name: 'colossus' }));
  assert.equal(one.recipe.ground, 'paper');
  const missing = payload(await call('af_move', { name: 'nope' }));
  assert.match(missing.error, /no move named nope/);
});

test('af_system imports a foreign pack through the same path the CLI uses', async () => {
  const { readFileSync } = await import('node:fs');
  const pack = JSON.parse(readFileSync(new URL('./fixtures/instrument.tokens.json', import.meta.url), 'utf8'));
  const r = payload(await call('af_system', { pack }));
  assert.equal(r.imported, true);
  assert.equal(r.overlay.color.terracotta.$value.hex, '#C8102E');
  assert.ok(r.report.carried.some((c) => /no display voice/.test(c)));
});

test('an unknown tool is an error; a failing tool is a result the model can act on', async () => {
  const unknown = await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'af_nope' } });
  assert.equal(unknown.error.code, -32602);
  const broken = await call('af_lint', {});
  assert.equal(broken.result.isError, true, 'a tool that cannot run says so in its result');
  assert.match(JSON.parse(broken.result.content[0].text).error, /needs html or url/);
  const unknownMethod = await handle({ jsonrpc: '2.0', id: 10, method: 'nope' });
  assert.equal(unknownMethod.error.code, -32601);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification gets no reply');
});

test('af_lint measures a draft and returns the fix for every violation', { skip: process.env.AF_SKIP_BROWSER ? 'browser skipped' : false }, async () => {
  // The loop, end to end: a page with three deliberate mistakes goes in, and what comes back is
  // actionable rather than merely true.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Draft</title>
    <style>body{font-family:system-ui;background:#FFFFFF;color:#1B1716}a{text-decoration:none;color:#B0502E}
    .card{border-radius:9px;box-shadow:0 2px 8px rgba(0,0,0,.2);padding:11px}</style></head>
    <body><h1>Quarterly review</h1><p>See the <a href="/detail">detail</a>.</p>
    <div class="card">A card that reaches for effects this system declares absent.</div></body></html>`;
  let result;
  try {
    const raw = await HANDLERS.af_lint({ html, register: 'ii', viewports: [1280] });
    result = JSON.parse(raw.content[0].text);
  } catch (e) {
    if (/executable|browser|Chromium/i.test(e.message)) return;
    throw e;
  }
  assert.equal(result.clean, false);
  const found = new Set(result.violations.map((v) => v.rule));
  for (const rule of ['radius-present', 'shadow-present', 'link-not-underlined']) {
    assert.ok(found.has(rule), `${rule} was measured`);
  }
  for (const v of result.violations) assert.ok(v.fix, `${v.rule} came back with its fix`);
  assert.match(result.note, /Do not lower a floor to pass/);
  assert.equal(result.register, 'ii');
  assert.equal(result.assumedRegister, true, 'the draft declared none, so the requested one was assumed');
});

test('af_lint says which register it used when the page overrides the one asked for', { skip: process.env.AF_SKIP_BROWSER ? 'browser skipped' : false }, async () => {
  const url = new URL('./fixtures/clean.html', import.meta.url).href;
  let result;
  try {
    result = JSON.parse((await HANDLERS.af_lint({ url, register: 'i', viewports: [1280] })).content[0].text);
  } catch (e) {
    if (/executable|browser|Chromium/i.test(e.message)) return;
    throw e;
  }
  assert.equal(result.register, 'ii', 'the page declares II and keeps it');
  assert.equal(result.assumedRegister, false);
});

test('af_drift measures a system that is not this one', { skip: process.env.AF_SKIP_BROWSER ? 'browser skipped' : false }, async () => {
  // The pages an agent is handed will not be built to this system, so the tool that reads them
  // must not assume any of its vocabulary. This is the stand-in client site from the drift tests.
  const page = (extra) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Client</title>
    <style>body{background:#FFFFFF;color:#222222;font-family:Georgia,serif;font-size:16px;margin:0;padding:24px}
    h1{font-size:25px;margin-bottom:16px}a{color:#B0502E}.t{color:#B0512E}${extra}</style></head>
    <body><h1>Northwind</h1>
    <p>Measured rather than asserted. <a href="#x">How we work, and why the intervals are published beside every number we report</a>.</p>
    <p><span class="t">Provisional.</span></p></body></html>`;
  let report;
  try {
    const raw = await HANDLERS.af_drift({ html: [page(''), page('p{margin-bottom:16px}')] });
    report = JSON.parse(raw.content[0].text);
  } catch (e) {
    if (/executable|browser|Chromium/i.test(e.message)) return;
    throw e;
  }
  const values = report.system.colour.tokens.map((t) => t.value);
  assert.ok(values.includes('#B0502E'), `the accent survives a full-page ground: ${JSON.stringify(values)}`);
  // The invariant is that the two are collapsed into one token and one near-miss. Which of them
  // is named the token follows weight, so it is the accent here only because the accent carries
  // more text; a site that used the typo more heavily would have them the other way round, and
  // the report cannot know which was intended.
  const pair = ['#B0502E', '#B0512E'];
  const named = [...values, ...report.system.colour.nearMisses.map((m) => m.value)];
  for (const c of pair) assert.ok(named.includes(c), `${c} accounted for: ${JSON.stringify(named)}`);
  assert.equal(values.filter((v) => pair.includes(v)).length, 1, 'one colour, not two tokens');
  assert.ok(report.system.colour.nearMisses.some((m) => m.value === '#B0512E'), 'the indistinguishable duplicate is named');
  assert.ok(report.findings.every((f) => /\d/.test(f)), 'every finding carries a measurement');
  assert.match(report.note, /Waste is the number to read first/);
});

test('af_drift refuses to invent a system from nothing', async () => {
  const r = await call('af_drift', {});
  assert.equal(r.result.isError, true);
  assert.match(payload(r).error, /needs html or urls/);
});

test('one browser serves the whole session, because the loop is the point', { skip: process.env.AF_SKIP_BROWSER ? 'browser skipped' : false }, async () => {
  // The first version launched and destroyed a Chromium per call, paying startup on every turn of
  // the draft-lint-fix-lint cycle this server exists for. Two calls must share one browser.
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><p>Short.</p></body></html>';
  try {
    const first = await HANDLERS.af_lint({ html, register: 'ii', viewports: [1280] });
    const second = await HANDLERS.af_lint({ html, register: 'ii', viewports: [1280] });
    assert.ok(JSON.parse(first.content[0].text).widths.length === 1);
    assert.ok(JSON.parse(second.content[0].text).widths.length === 1);
  } catch (e) {
    if (/executable|browser|Chromium/i.test(e.message)) return;
    throw e;
  }
});

test('the server version moves when its tool surface does', () => {
  // A client caches a tool list. Adding a tool without moving the version is how it never notices.
  assert.match(SERVER.version, /^\d+\.\d+\.\d+$/);
  assert.ok(SERVER.version !== '3.0.0', 'af_drift was added after 3.0.0');
});

test('the registry manifest cannot drift from the package or the server', async () => {
  // Three files carry this version and a client caches the tool list keyed on it. Left to
  // hand-editing, one of the three is always stale.
  const { readFileSync } = await import('node:fs');
  const at = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const [manifest, pkg] = [at('server.json'), at('package.json')];
  assert.equal(manifest.version, SERVER.version, 'server.json is behind src/lib/mcp.mjs');
  assert.equal(manifest.packages[0].version, SERVER.version, 'the npm package entry is behind');
  // The blind spot the first version of this test had. Comparing the manifest only against
  // SERVER.version let both of them run ahead of package.json together: server.json advertised
  // 3.1.0 while the package was still 3.0.0, so the registry entry pointed at an npm version that
  // did not exist. The manifest's package version is a claim about npm, and npm is package.json.
  assert.equal(manifest.packages[0].version, pkg.version, 'the manifest points at an npm version that is not the one this package publishes');
  assert.equal(SERVER.version, pkg.version, 'the server ships inside the package, so it cannot be versioned apart from it');
  assert.equal(manifest.packages[0].identifier, pkg.name, 'the manifest points at a package that is not this one');
  assert.ok(pkg.bin['af-mcp'], 'the manifest runs af-mcp, so the package has to install it');
  assert.match(manifest.name, /^[a-z]+\.[a-z0-9-]+(\.[a-z0-9-]+)*\/[a-z0-9-]+$/, 'reverse-DNS namespace');
  // The registry validates against its schema, which caps both at 100 characters, and checks npm
  // ownership by the package's mcpName matching the server's name.
  assert.ok(manifest.description.length <= 100, `description is ${manifest.description.length} characters; the schema allows 100`);
  assert.ok(manifest.title.length <= 100);
  assert.equal(pkg.mcpName, manifest.name, 'package.json mcpName must match the server name or the registry refuses ownership');
});

test('release the browser', async () => {
  await closeBrowser();
});
