/**
 * Rule levels (decision 0027): mandatory, standard or advisory, declared in the token file, with the
 * platform floor locked against a pack, a job and a team policy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES, LEVELS, resolveLevels } from '../src/lib/rules/registry.mjs';
import { loadConfig, applyPolicy } from '../src/lib/policy.mjs';
import { handle } from '../src/lib/mcp.mjs';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { ENV } from '../src/lib/names.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APPROVED = ['alt-missing', 'contrast', 'focus-hidden', 'horizontal-overflow', 'link-not-underlined',
  'target-size', 'text-too-small', 'wordmark-live-text'];
const tokenFile = () => JSON.parse(readFileSync(join(ROOT, 'tokens/applied-form.tokens.json'), 'utf8'));
const scratch = () => mkdtempSync(join(tmpdir(), 'af-levels-'));
const writeJson = (dir, name, data) => { const f = join(dir, name); writeFileSync(f, JSON.stringify(data)); return f; };
const overlay = (mandatory) => ({ $extensions: { 'form.applied': { levels: { mandatory } } } });
const rulesJson = (env = {}) => spawnSync(process.execPath, [join(ROOT, 'bin/standards.mjs'), 'rules', '--json'], { encoding: 'utf8', env: { ...process.env, [ENV.STANDARDS_SYSTEM]: undefined, ...env } });

test('the levels are read from the token file', () => {
  const declared = tokenFile().$extensions['form.applied'].levels.mandatory;
  assert.deepEqual([...declared].sort(), RULES.filter((r) => r.level === 'mandatory').map((r) => r.id).sort());
  // A system that adds a rule to the list gets it as mandatory: the level comes from the data.
  const r = rulesJson({ STANDARDS_SYSTEM: writeJson(scratch(), 'adds.tokens.json', overlay([...declared, 'series-contrast'])) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).find((x) => x.id === 'series-contrast').level, 'mandatory');
});

test('every rule has exactly one level', () => {
  assert.deepEqual(LEVELS, ['mandatory', 'standard', 'advisory']);
  for (const r of RULES) assert.ok(LEVELS.includes(r.level), `${r.id} has level ${JSON.stringify(r.level)}`);
  // Advisory is today's advisory severity, and nothing else.
  assert.deepEqual(RULES.filter((r) => r.level === 'advisory').map((r) => r.id), RULES.filter((r) => r.severity === 'advisory').map((r) => r.id));
});

test('the mandatory set is the one the owner approved', () => {
  assert.deepEqual(RULES.filter((r) => r.level === 'mandatory').map((r) => r.id).sort(), APPROVED);
});

test('a team policy that lowers a mandatory rule is refused, naming the rule and its level', () => {
  for (const sev of ['warn', 'off']) {
    const file = writeJson(scratch(), 'standards.config.json', { rules: { measure: 'warn', contrast: sev } });
    assert.throws(() => loadConfig(file), /"contrast" is mandatory/);
    assert.throws(() => applyPolicy([], { config: { rules: { 'alt-missing': sev } } }), /"alt-missing" is mandatory/);
  }
  // Setting it to error is not a demotion.
  const ok = writeJson(scratch(), 'standards.config.json', { rules: { contrast: 'error' } });
  assert.equal(loadConfig(ok).rules.contrast, 'error');
});

test('a team policy that lowers a standard rule works as before', () => {
  const file = writeJson(scratch(), 'standards.config.json', { rules: { measure: 'warn', spacing: 'off' } });
  const config = loadConfig(file);
  const page = { url: 'file:///r/a.html', viewport: 1280, advisories: [], violations: ['contrast', 'measure', 'spacing'].map((rule) => ({ rule, message: rule })) };
  const { results } = applyPolicy([page], { config, cwd: '/r' });
  assert.deepEqual(results[0].errors.map((x) => x.rule), ['contrast']);
  assert.deepEqual(results[0].warnings.map((x) => x.rule), ['measure']);
  // The example config a team copies lowers only standard rules.
  assert.doesNotThrow(() => loadConfig(join(ROOT, 'standards.config.example.json')));
  // And it names the files a new project has, not the ones a deprecated spelling would fall back from.
  const example = readFileSync(join(ROOT, 'standards.config.example.json'), 'utf8');
  assert.doesNotMatch(example, /af[.-](config|baseline)/);
  assert.equal(JSON.parse(example).baseline, 'standards-baseline.json');
});

test('a pack or a job that drops a mandatory rule is refused', () => {
  const floor = tokenFile().$extensions['form.applied'].levels.mandatory;
  const r = rulesJson({ STANDARDS_SYSTEM: writeJson(scratch(), 'drops.tokens.json', overlay(floor.filter((id) => id !== 'alt-missing'))) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /"alt-missing" is mandatory/);
  assert.throws(() => resolveLevels({ floor, layers: [{ source: 'job brief-7', mandatory: floor.filter((id) => id !== 'contrast') }] }), /job brief-7.*"contrast" is mandatory/);
  // A layer may add to the floor, and one that says nothing leaves it as it is.
  const levels = resolveLevels({ floor, layers: [{ source: 'job', mandatory: [...floor, 'measure'] }, { source: 'pack', mandatory: undefined }] });
  assert.equal(levels.measure, 'mandatory');
  assert.equal(levels.contrast, 'mandatory');
  assert.equal(levels.spacing, 'standard');
});

// The thresholds the mandatory rules read from the loaded system: `contrast` reads the first four,
// `text-too-small` the last. A system may raise one and may not lower it, or the rule is silenced
// without being named (decision 0027).
const THRESHOLDS = ['body-contrast', 'display-contrast', 'large-text-px', 'large-bold-text-px', 'text-min-px'];
const floorsOverlay = (floors) => ({ floors: Object.fromEntries(Object.entries(floors).map(([k, v]) => [k, { $value: v }])) });
const loadedFloors = (env) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { floors } from ${JSON.stringify(new URL('../src/lib/tokens.mjs', import.meta.url).href)}; console.log(JSON.stringify(floors));`],
{ encoding: 'utf8', env: { ...process.env, [ENV.STANDARDS_SYSTEM]: undefined, ...env } });

test('a system that lowers a threshold a mandatory rule reads is refused, naming the threshold, both values and 0027', () => {
  const house = tokenFile().floors;
  for (const key of THRESHOLDS) {
    const floor = house[key].$value;
    const r = rulesJson({ STANDARDS_SYSTEM: writeJson(scratch(), 'lax.tokens.json', floorsOverlay({ [key]: floor - 0.5 })) });
    assert.notEqual(r.status, 0, `${key} lowered to ${floor - 0.5} was accepted`);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, new RegExp(`floors\\.${key} is ${floor - 0.5}, below the platform floor of ${floor}.*decision 0027`), key);
  }
  // A value that is not a number would compare false and silence the rule as surely as a low one.
  for (const bad of [null, '1', { value: 1, unit: 'px' }]) {
    const r = rulesJson({ STANDARDS_SYSTEM: writeJson(scratch(), 'odd.tokens.json', floorsOverlay({ 'text-min-px': bad })) });
    assert.notEqual(r.status, 0, `text-min-px ${JSON.stringify(bad)} was accepted`);
    assert.match(r.stderr, /floors\.text-min-px is .*, not a number.*decision 0027/);
  }
});

test('a system named in standards.config.json that relaxes the contrast and text floors is refused before a page is judged', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'page.html'), '<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>t</title></head><body><p style="color:#ccc;font-size:9px">x</p></body></html>');
  writeJson(dir, 'overlay.tokens.json', floorsOverlay({ 'body-contrast': 1, 'display-contrast': 1, 'text-min-px': 1 }));
  writeJson(dir, 'standards.config.json', { system: 'overlay.tokens.json' });
  const env = { ...process.env }; delete env.STANDARDS_SYSTEM; delete env[ENV.STANDARDS_SYSTEM];
  const r = spawnSync(process.execPath, [join(ROOT, 'bin/standards.mjs'), 'lint', 'page.html', '--json', '--sample', '0'], { cwd: dir, env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /floors\.body-contrast is 1, below the platform floor of 4\.5.*decision 0027/);
});

// A system that declares itself a pack is judged in the register `pack`. Without one, every page
// fails `register` alone, and `register` is a house rule, which a pack drops: lint() returned nothing,
// so all eight mandatory rules went unmeasured. fromPack always writes register.pack.
test('a system that declares a pack but states no pack register is refused before a page is judged', () => {
  const packOnly = { $extensions: { 'form.applied': { pack: {} } } };
  const r = rulesJson({ STANDARDS_SYSTEM: writeJson(scratch(), 'packonly.tokens.json', packOnly) });
  assert.notEqual(r.status, 0, 'a pack with no register was accepted');
  assert.match(r.stderr, /declares a pack.*register\.pack.*decision 0027/);
  const dir = scratch();
  writeFileSync(join(dir, 'bad.html'), '<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><title>t</title></head><body>'
    + '<p style="color:#ccc;font-size:16px">Low contrast body text.</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="64" height="64">'
    + '<div style="width:2000px;height:10px"></div></body></html>');
  writeJson(dir, 'overlay.tokens.json', packOnly);
  writeJson(dir, 'standards.config.json', { system: 'overlay.tokens.json' });
  const env = { ...process.env }; delete env.STANDARDS_SYSTEM; delete env[ENV.STANDARDS_SYSTEM];
  const lint = spawnSync(process.execPath, [join(ROOT, 'bin/standards.mjs'), 'lint', 'bad.html', '--json', '--sample', '0'], { cwd: dir, env, encoding: 'utf8' });
  assert.notEqual(lint.status, 0, 'standards lint passed the page under a pack with no register');
  assert.equal(lint.stdout, '');
  assert.match(lint.stderr, /register\.pack/);
  // A pack register with no background has no ground for `contrast` to fall back on, so it is refused too.
  const noGround = { register: { pack: { text: { $value: '#111111' } } }, $extensions: { 'form.applied': { pack: {} } } };
  const g = rulesJson({ STANDARDS_SYSTEM: writeJson(scratch(), 'noground.tokens.json', noGround) });
  assert.notEqual(g.status, 0, 'a pack register with no background was accepted');
  assert.match(g.stderr, /register\.pack\.background is undefined, not a colour/);
  const blank = rulesJson({ STANDARDS_SYSTEM: writeJson(scratch(), 'blank.tokens.json', { register: { ii: { background: { $value: null } } } }) });
  assert.notEqual(blank.status, 0, 'a house register with no background was accepted');
  assert.match(blank.stderr, /register\.ii\.background is null, not a colour/);
});

test('a system that raises a threshold a mandatory rule reads is accepted, and the raised value is the one judged', () => {
  const house = tokenFile().floors;
  const raised = Object.fromEntries(THRESHOLDS.map((k) => [k, house[k].$value + 1]));
  const r = loadedFloors({ STANDARDS_SYSTEM: writeJson(scratch(), 'strict.tokens.json', floorsOverlay(raised)) });
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(r.stdout);
  assert.deepEqual([f.bodyContrast, f.displayContrast, f.largeTextPx, f.largeBoldTextPx, f.textMinPx], THRESHOLDS.map((k) => raised[k]));
  // Equal to the floor is not laxer.
  const same = loadedFloors({ STANDARDS_SYSTEM: writeJson(scratch(), 'same.tokens.json', floorsOverlay(Object.fromEntries(THRESHOLDS.map((k) => [k, house[k].$value])))) });
  assert.equal(same.status, 0, same.stderr);
});

test('every shipped system, pack and brand still loads under the threshold floor', async () => {
  const { existsSync, readdirSync } = await import('node:fs');
  const { fromPack } = await import('../src/lib/pack.mjs');
  const files = [
    ...(existsSync(join(ROOT, 'brands')) ? readdirSync(join(ROOT, 'brands')).filter((f) => f.endsWith('.tokens.json')).map((f) => join(ROOT, 'brands', f)) : []),
    ...['open/reference.tokens.json', 'eval/fixtures/meridian.tokens.json', 'eval/fixtures/meridian.merged.tokens.json'].map((f) => join(ROOT, f)).filter(existsSync),
  ];
  // A Standards pack is loaded as the overlay `standards init --pack` derives from it.
  for (const f of readdirSync(join(ROOT, 'packs')).filter((x) => x.endsWith('.tokens.json'))) {
    const { overlay } = fromPack(JSON.parse(readFileSync(join(ROOT, 'packs', f), 'utf8')), { key: f.split('.')[0] });
    assert.ok(overlay, `${f} was refused on import`);
    files.push(writeJson(scratch(), f, overlay));
  }
  assert.ok(files.length >= 2, `found only ${files.length} systems to load`);
  for (const f of files) {
    const r = rulesJson({ STANDARDS_SYSTEM: f });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('the mandatory list names only rules that exist and can fail a page', () => {
  assert.throws(() => resolveLevels({ floor: ['no-such-rule'] }), /no-such-rule/);
  assert.throws(() => resolveLevels({ floor: ['apca-advisory'] }), /apca-advisory.*advisory/);
});

// The open owner question in decision 0027. Under a brand overlay, a page that declares no register
// is judged by `register` alone, so a policy that lowers `register`, a standard rule, leaves every
// mandatory rule unmeasured on it. This test holds the gap as it is, so the record that describes it
// stays true. If the owner closes the gap, this test changes with the record.
let chromium = null;
try { chromium = await launchBrowser(); await chromium.close(); } catch (e) { if (process.env.CI) throw e; }
test('under a brand overlay, a policy that lowers register leaves the mandatory rules unmeasured on a page with no register', { skip: chromium ? false : 'no Chromium' }, () => {
  const dir = scratch();
  writeFileSync(join(dir, 'bad.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>t</title></head><body style="background:#fff">'
    + '<p style="color:#ccc;font-size:9px">Low contrast tiny text</p><a href="#x" style="text-decoration:none;outline:none">link</a>'
    + '<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22/%3E" width="64" height="64">'
    + '<div style="width:2000px">wide</div></body></html>');
  writeJson(dir, 'overlay.tokens.json', overlay(tokenFile().$extensions['form.applied'].levels.mandatory));
  writeJson(dir, 'standards.config.json', { system: 'overlay.tokens.json', rules: { register: 'off' } });
  const env = { ...process.env }; delete env.STANDARDS_SYSTEM; delete env[ENV.STANDARDS_SYSTEM];
  const lint = (...args) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin/standards.mjs'), 'lint', 'bad.html', '--json', '--sample', '0', ...args], { cwd: dir, env, encoding: 'utf8' });
    return { status: r.status, pages: JSON.parse(r.stdout).pages, stderr: r.stderr };
  };
  const quiet = lint();
  assert.equal(quiet.status, 0, quiet.stderr);
  for (const p of quiet.pages) assert.deepEqual(p.violations.map((v) => v.rule), ['register'], `${p.viewport}px`);
  // The same page, given a register, fails five of the mandatory rules.
  const judged = lint('--register', 'ii');
  assert.equal(judged.status, 1, judged.stderr);
  const failed = new Set(judged.pages.flatMap((p) => p.errors.map((e) => e.rule)));
  for (const id of ['contrast', 'text-too-small', 'link-not-underlined', 'alt-missing', 'horizontal-overflow']) assert.ok(failed.has(id), `${id} is not among ${[...failed].join(', ')}`);
});

// The same gap with no system loaded. A page that declares a register the system does not define
// (here `zz`) is judged by `register` alone, so a config that lowers `register` leaves every
// mandatory rule unmeasured on it. Held as it is; if the gap is closed, this test changes with the record.
test('with no system loaded, a policy that lowers register leaves the mandatory rules unmeasured on a page whose register the system does not define', { skip: chromium ? false : 'no Chromium' }, () => {
  const dir = scratch();
  writeFileSync(join(dir, 'bad.html'), '<!doctype html><html lang="en" data-register="zz"><head><meta charset="utf-8"><title>t</title></head><body>'
    + '<p style="color:#ccc;font-size:16px">Low contrast body text that is plainly too faint to read.</p>'
    + '<button style="width:10px;height:10px;outline:none;padding:0;border:0" onfocus="this.style.outline=\'none\'">x</button>'
    + '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="64" height="64">'
    + '<div style="width:2000px;height:10px;background:#000"></div></body></html>');
  writeJson(dir, 'standards.config.json', { rules: { register: 'off' } });
  const env = { ...process.env }; delete env.STANDARDS_SYSTEM; delete env[ENV.STANDARDS_SYSTEM];
  const lint = (...args) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin/standards.mjs'), 'lint', 'bad.html', '--json', '--sample', '0', ...args], { cwd: dir, env, encoding: 'utf8' });
    return { status: r.status, pages: JSON.parse(r.stdout).pages, stderr: r.stderr };
  };
  const quiet = lint();
  assert.equal(quiet.status, 0, quiet.stderr);
  for (const p of quiet.pages) assert.deepEqual(p.violations.map((v) => v.rule), ['register'], `${p.viewport}px`);
  // The same page declaring `ii` fails five of the mandatory rules.
  writeFileSync(join(dir, 'bad.html'), readFileSync(join(dir, 'bad.html'), 'utf8').replace('data-register="zz"', 'data-register="ii"'));
  const judged = lint();
  assert.equal(judged.status, 1, judged.stderr);
  const failed = new Set(judged.pages.flatMap((p) => p.errors.map((e) => e.rule)));
  for (const id of ['contrast', 'target-size', 'focus-hidden', 'alt-missing', 'horizontal-overflow']) assert.ok(failed.has(id), `${id} is not among ${[...failed].join(', ')}`);
});

// The fourth gap in decision 0027. The MCP standards_lint tool measures the widths its caller names, so a
// call without 320 never measures horizontal-overflow there and returns clean. This holds the gap
// as it is; if it is closed, this test changes with the record.
test('the MCP standards_lint tool measures only the widths its caller names', { skip: chromium ? false : 'no Chromium' }, async () => {
  const { HANDLERS, closeBrowser } = await import('../src/lib/mcp.mjs');
  const html = '<!doctype html><html lang="en" data-register="ii"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>t</title></head>'
    + '<body style="font-family:\'Libre Franklin\';font-size:19px"><main><p style="margin:0">Body text.</p><div style="width:600px;height:8px"></div></main></body></html>';
  try {
    const read = async (args) => JSON.parse((await HANDLERS.standards_lint({ html, ...args })).content[0].text);
    const narrow = await read({ viewports: [1280] });
    assert.deepEqual(narrow.widths, [1280]);
    assert.equal(narrow.clean, true, JSON.stringify(narrow.violations));
    const wide = await read({});
    assert.ok(wide.violations.some((v) => v.rule === 'horizontal-overflow' && v.viewport === 320), JSON.stringify(wide.violations.map((v) => [v.viewport, v.rule])));
  } finally { await closeBrowser(); }
});

test('standards rules --json and the MCP rules tool carry the level', async () => {
  const r = rulesJson();
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, RULES.length);
  for (const row of rows) assert.equal(row.level, RULES.find((x) => x.id === row.id).level);
  const res = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'standards_rules', arguments: {} } });
  const served = JSON.parse(res.result.content[0].text);
  assert.equal(served.find((x) => x.id === 'contrast').level, 'mandatory');
  assert.equal(served.find((x) => x.id === 'spacing').level, 'standard');
  assert.equal(served.find((x) => x.id === 'apca-advisory').level, 'advisory');
});
