/**
 * What the product's names promise. Standards by Applied Form is the command `standards`; the older
 * `af` still runs for one major version, says so once on stderr, and otherwise behaves exactly as
 * `standards` does. After the rename sweep this is the one test file allowed to spell the old
 * command.
 *
 * It uses only files the open export carries (fixtures by path, never brands/), so the open
 * repository runs it too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, readdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { isReport } from '../src/lib/audit-html.mjs';
import { deprecated, TOOL_MAP } from '../src/lib/names.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const AF = join(root, 'bin/af.mjs');
const STANDARDS = join(root, 'bin/standards.mjs');
const AF_MCP = join(root, 'bin/af-mcp.mjs');
const FIXTURES = join(root, 'test/fixtures');

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;
await browser?.close();

// A run starts with neither name of any pair set; a test sets the ones it is about.
const env = () => { const e = { ...process.env }; for (const k of ['AF_BRAND', 'STANDARDS_SYSTEM', 'AF_CHROMIUM', 'STANDARDS_CHROMIUM']) delete e[k]; return e; };
const run = (bin, args = []) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: env() });

test('af rules --json writes what standards rules --json writes, and says once that af is deprecated', () => {
  const now = run(STANDARDS, ['rules', '--json']);
  const old = run(AF, ['rules', '--json']);
  assert.equal(now.status, 0, now.stderr);
  assert.equal(old.status, 0, old.stderr);
  assert.doesNotThrow(() => JSON.parse(now.stdout));
  assert.equal(old.stdout, now.stdout, 'the old command is the new command under another name');
  assert.equal(now.stderr, '', 'the new command prints nothing to stderr');
  assert.equal(old.stderr, `${deprecated('af', 'standards')}\n`, 'the old command prints exactly the one line');
});

test('af with an unknown command exits 2 with nothing on stdout, and bare af exits 0', () => {
  const nope = run(AF, ['nope']);
  assert.equal(nope.status, 2);
  assert.equal(nope.stdout, '');
  assert.ok(nope.stderr.startsWith(`${deprecated('af', 'standards')}\n`), nope.stderr);
  assert.match(nope.stderr, /usage: standards </);
  const bare = run(AF);
  assert.equal(bare.status, 0, 'bare af prints usage and exits 0, as it always has');
  assert.equal(bare.stdout, '');
  const now = run(STANDARDS);
  assert.equal(now.status, 0);
  assert.match(now.stderr, /^usage: standards </);
});

test('standards mcp, af mcp and af-mcp --selftest all pass; only the old routes say they are deprecated', () => {
  const now = run(STANDARDS, ['mcp', '--selftest']);
  assert.equal(now.status, 0, now.stdout + now.stderr);
  assert.match(now.stdout.trim().split('\n').pop(), /protocol clean$/);
  assert.match(now.stdout, /standards_rules/, 'the selftest calls the tools by the names the profile lists');
  assert.equal(now.stderr, '');
  for (const [bin, args, line] of [[AF, ['mcp', '--selftest'], deprecated('af', 'standards')], [AF_MCP, ['--selftest'], deprecated('af-mcp', 'standards mcp')]]) {
    const old = run(bin, args);
    assert.equal(old.status, 0, old.stdout + old.stderr);
    assert.match(old.stdout.trim().split('\n').pop(), /protocol clean$/);
    assert.match(old.stdout, /af_rules/, 'a legacy route is selftested under the names it lists');
    assert.equal(old.stderr, `${line}\n`, 'one line, however many tools the selftest calls');
  }
});

/**
 * A real stdio session: write the messages, close stdin, and read what the server said. The
 * selftest prints for a person by design, so it cannot show that stdout is protocol and nothing
 * else; this can.
 */
const session = (bin, args, messages) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [bin, ...args], { env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  const timer = setTimeout(() => { p.kill(); reject(new Error(`no answer in 60s: ${out}${err}`)); }, 60000);
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', reject);
  p.on('close', (status) => { clearTimeout(timer); resolve({ status, out, err, lines: out.split('\n').filter(Boolean) }); });
  for (const m of messages) p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  p.stdin.end();
});
const hello = [
  { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'compat', version: '0' } } },
  { id: 2, method: 'tools/list', params: {} },
];

for (const [route, bin, args, expected, stderr] of [
  ['standards mcp', STANDARDS, ['mcp'], Object.values(TOOL_MAP), ''],
  ['af mcp', AF, ['mcp'], Object.keys(TOOL_MAP), `${deprecated('af', 'standards')}\n`],
  ['af-mcp', AF_MCP, [], Object.keys(TOOL_MAP), `${deprecated('af-mcp', 'standards mcp')}\n`],
]) {
  test(`a stdio session over ${route} is clean protocol and lists ${expected[0].replace(/_.*/, '_*')} tools`, async () => {
    const r = await session(bin, args, hello);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.lines.length, 2, 'one answer for initialize and one for tools/list');
    for (const line of r.lines) assert.equal(JSON.parse(line).jsonrpc, '2.0', line);
    const tools = JSON.parse(r.lines[1]).result.tools.map((t) => t.name);
    assert.deepEqual([...tools].sort(), [...expected].sort());
    assert.equal(r.err, stderr);
  });
}

test('an old tool name over stdio is answered, carries the notice, and is named on stderr once', async () => {
  const call = (id) => ({ id, method: 'tools/call', params: { name: 'af_contrast', arguments: { foreground: '#1A1A1A', background: '#FFFFFF' } } });
  const r = await session(STANDARDS, ['mcp'], [...hello, call(3), call(4)]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.lines.length, 4);
  for (const line of r.lines) assert.equal(JSON.parse(line).jsonrpc, '2.0', line);
  const [a, b] = [JSON.parse(r.lines[2]), JSON.parse(r.lines[3])];
  assert.equal(a.result.content[1].text, deprecated('af_contrast', 'standards_contrast'));
  assert.equal(b.result.content.length, 2);
  assert.equal(r.err, `${deprecated('af_contrast', 'standards_contrast')}\n`);
});

test('a report is recognised by any of the three generator values it has carried', () => {
  const page = (generator) => `<!doctype html><html><head><meta charset="utf-8"><meta name="generator" content="${generator}"><title>r</title></head><body></body></html>`;
  for (const generator of ['standards audit', 'af audit', 'af report']) assert.equal(isReport(page(generator)), true, generator);
  assert.equal(isReport(page('something else')), false);
  assert.equal(isReport('<!doctype html><title>a page of the set</title>'), false);
});

test('lint --json writes nothing but JSON to stdout, with the sampled widths left to stderr', { skip }, () => {
  // The line that names the two sampled widths used to go to stdout, so `lint --json` was not
  // parseable unless --sample 0 was given. The run is not given --sample 0 here.
  const r = run(STANDARDS, ['lint', join(FIXTURES, 'clean.html'), '--json']);
  assert.doesNotThrow(() => JSON.parse(r.stdout), `stdout is not JSON: ${r.stdout.slice(0, 200)}`);
  assert.match(r.stderr, /sampled widths \d+, \d+px \(--seed \d+ to reproduce\)/);
});

/**
 * The environment names (Q2, stage 6). `STANDARDS_SYSTEM` and `STANDARDS_CHROMIUM` replace `AF_BRAND`
 * and `AF_CHROMIUM`; the old names still work for one major version, resolved on every read, with
 * one stderr line. The system is `test/fixtures/rounded.tokens.json`, a fixture the open export
 * carries, never a name under brands/.
 */
const ROUNDED = join(FIXTURES, 'rounded.tokens.json');
const lines = (stderr, name) => stderr.split('\n').filter((l) => l.startsWith(`${name} is deprecated`));
const runWith = (bin, args, set, cwd = root) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...env(), ...set }, cwd });
const scratch = () => mkdtempSync(join(tmpdir(), 'standards-compat-'));
const child = (code, set = {}) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...env(), ...set }, cwd: root });
const href = (rel) => JSON.stringify(pathToFileURL(join(root, rel)).href);
// The verdict on the page, without the line that says which config file was read: that differs by design.
const verdict = (r) => { const { config, ...rest } = JSON.parse(r.stdout); return rest; };
const lintArgs = ['lint', join(FIXTURES, 'violations.html'), '--json', '--sample', '0'];

test('AF_BRAND is read like STANDARDS_SYSTEM, with exactly one line', () => {
  const now = runWith(STANDARDS, ['rules', '--json'], { STANDARDS_SYSTEM: ROUNDED });
  const old = runWith(STANDARDS, ['rules', '--json'], { AF_BRAND: ROUNDED });
  assert.equal(now.status, 0, now.stderr);
  assert.equal(old.status, 0, old.stderr);
  assert.equal(old.stdout, now.stdout);
  assert.equal(now.stderr, '', 'the new name says nothing');
  assert.equal(old.stderr, `${deprecated('AF_BRAND', 'STANDARDS_SYSTEM')}\n`, 'the old name says one line');
});

test('AF_BRAND judges a page against the system it names, as STANDARDS_SYSTEM does', { skip }, () => {
  const house = runWith(STANDARDS, lintArgs, {}, scratch());
  const now = runWith(STANDARDS, lintArgs, { STANDARDS_SYSTEM: ROUNDED });
  const old = runWith(STANDARDS, lintArgs, { AF_BRAND: ROUNDED });
  assert.doesNotThrow(() => JSON.parse(now.stdout), now.stderr);
  assert.notEqual(now.stdout, house.stdout, 'the fixture system changes the verdict, so the variable was read');
  assert.equal(old.stdout, now.stdout);
  assert.equal(old.status, now.status);
  assert.equal(now.stderr, '');
  assert.equal(old.stderr, `${deprecated('AF_BRAND', 'STANDARDS_SYSTEM')}\n`);
});

test('both names set to different values exit 2 and name both; the same value in both is not an error', () => {
  const other = join(FIXTURES, 'instrument.tokens.json');
  const r = runWith(STANDARDS, ['rules', '--json'], { AF_BRAND: ROUNDED, STANDARDS_SYSTEM: other });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /AF_BRAND/);
  assert.match(r.stderr, /STANDARDS_SYSTEM/);
  const same = runWith(STANDARDS, ['rules', '--json'], { AF_BRAND: ROUNDED, STANDARDS_SYSTEM: ROUNDED });
  assert.equal(same.status, 0, same.stderr);
  assert.equal(same.stderr, '', 'the new name supplies the value, so the old one is not used');
});

test("AF_BRAND='' is a value, as STANDARDS_SYSTEM='' is", () => {
  const now = runWith(STANDARDS, ['rules', '--json'], { STANDARDS_SYSTEM: '' });
  const old = runWith(STANDARDS, ['rules', '--json'], { AF_BRAND: '' });
  assert.equal(now.status, 0, now.stderr);
  assert.equal(old.status, now.status);
  assert.equal(old.stdout, now.stdout);
  assert.equal(now.stderr, '');
  assert.equal(old.stderr, `${deprecated('AF_BRAND', 'STANDARDS_SYSTEM')}\n`);
});

test("AF_BRAND='' keeps the config out of it, as STANDARDS_SYSTEM='' does", { skip }, () => {
  const dir = scratch();
  writeFileSync(join(dir, 'standards.config.json'), JSON.stringify({ system: ROUNDED }));
  const house = runWith(STANDARDS, lintArgs, {}, scratch());
  const configured = runWith(STANDARDS, lintArgs, {}, dir);
  const now = runWith(STANDARDS, lintArgs, { STANDARDS_SYSTEM: '' }, dir);
  const old = runWith(STANDARDS, lintArgs, { AF_BRAND: '' }, dir);
  assert.notDeepEqual(verdict(configured), verdict(house), 'the config alone would have chosen the fixture system');
  assert.deepEqual(verdict(now), verdict(house), 'an empty value is the house system, so the config is not read');
  assert.deepEqual(verdict(old), verdict(now));
});

test('standards fix, which runs a script of its own, prints one line for AF_BRAND in all', { skip }, () => {
  const dir = scratch();
  const page = join(dir, 'page.html');
  copyFileSync(join(FIXTURES, 'violations.html'), page);
  const r = runWith(STANDARDS, ['fix', page, '--out', join(dir, 'out.html'), '--sample', '0'], { AF_BRAND: ROUNDED }, dir);
  assert.equal(lines(r.stderr, 'AF_BRAND').length, 1, r.stderr);
  assert.equal(lines(r.stderr, 'AF_BRAND')[0], deprecated('AF_BRAND', 'STANDARDS_SYSTEM'));
});

test('AF_CHROMIUM alone is honoured, with one line; both names set apart exit 2', () => {
  const bad = join(scratch(), 'no-such-chromium');
  const args = ['lint', join(FIXTURES, 'clean.html'), '--sample', '0'];
  const old = runWith(STANDARDS, args, { AF_CHROMIUM: bad });
  const now = runWith(STANDARDS, args, { STANDARDS_CHROMIUM: bad });
  for (const r of [old, now]) { assert.notEqual(r.status, 0); assert.ok(r.stderr.includes(bad), `the executable that was asked for is named: ${r.stderr.slice(0, 300)}`); }
  assert.equal(lines(old.stderr, 'AF_CHROMIUM').length, 1, old.stderr);
  assert.equal(lines(old.stderr, 'AF_CHROMIUM')[0], deprecated('AF_CHROMIUM', 'STANDARDS_CHROMIUM'));
  assert.equal(lines(now.stderr, 'AF_CHROMIUM').length, 0);
  const both = runWith(STANDARDS, args, { AF_CHROMIUM: bad, STANDARDS_CHROMIUM: join(bad, 'x') });
  assert.equal(both.status, 2, both.stderr);
  assert.match(both.stderr, /AF_CHROMIUM/);
  assert.match(both.stderr, /STANDARDS_CHROMIUM/);
});

test('AF_BRAND beats a config that names another system, under either config name', { skip }, () => {
  const bare = runWith(STANDARDS, lintArgs, { AF_BRAND: ROUNDED }, scratch());
  assert.equal(bare.status, 1, 'the fixture page has violations');
  for (const name of ['standards.config.json', 'af.config.json']) {
    const dir = scratch();
    writeFileSync(join(dir, name), JSON.stringify({ system: join(dir, 'a-system-that-is-not-there.json') }));
    const r = runWith(STANDARDS, lintArgs, { AF_BRAND: ROUNDED }, dir);
    assert.equal(r.status, bare.status, `${name}: ${r.stderr}`);
    assert.deepEqual(verdict(r), verdict(bare), `${name}: the variable wins over the config`);
    assert.equal(lines(r.stderr, 'AF_BRAND').length, 1, `${name}: ${r.stderr}`);
  }
});

test('a write to AF_BRAND after env.mjs and system-arg.mjs are imported, and before the tokens are, is still read', () => {
  // eval/builders-report.mjs does exactly this. A shim that copied the variable when it was imported would judge the house system.
  const r = child(`import ${href('src/lib/system-arg.mjs')}; import ${href('src/lib/env.mjs')};
    process.env.AF_BRAND = ${JSON.stringify(ROUNDED)};
    const { brand } = await import(${href('src/lib/tokens.mjs')}); console.log(brand);`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), ROUNDED);
  assert.equal(lines(r.stderr, 'AF_BRAND').length, 1, r.stderr);
});

test('setSystem puts the system under the new name and removes the old one, so an inherited value cannot conflict', () => {
  const r = child(`const { setSystem, systemFromEnv } = await import(${href('src/lib/env.mjs')});
    setSystem('x');
    console.log(JSON.stringify({ system: systemFromEnv(), now: process.env.STANDARDS_SYSTEM, old: process.env.AF_BRAND ?? null }));`, { AF_BRAND: 'y' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { system: 'x', now: 'x', old: null });
  assert.equal(r.stderr, '', 'no line and no error');
});

test('childEnv resolves both pairs to the new names, applies what it is given, and leaves this process alone', () => {
  const r = child(`const { childEnv } = await import(${href('src/lib/env.mjs')});
    const e = childEnv({ KEPT: 'k', STANDARDS_SYSTEM: undefined });
    console.log(JSON.stringify({ e: Object.fromEntries(Object.entries(e).filter(([k]) => /^(AF_BRAND|AF_CHROMIUM|STANDARDS_SYSTEM|STANDARDS_CHROMIUM|KEPT)$/.test(k))), own: process.env.AF_BRAND, ownChromium: process.env.AF_CHROMIUM }));`,
  { AF_BRAND: ROUNDED, AF_CHROMIUM: '/some/chromium' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.e, { STANDARDS_CHROMIUM: '/some/chromium', KEPT: 'k' }, 'old names gone, resolved values under the new ones, undefined removes');
  assert.equal(out.own, ROUNDED, 'this process keeps what it was given');
  assert.equal(out.ownChromium, '/some/chromium');
  const twice = child(`const { childEnv } = await import(${href('src/lib/env.mjs')}); const a = childEnv({}); childEnv({}); console.log(a.STANDARDS_SYSTEM, a.AF_BRAND);`, { AF_BRAND: ROUNDED });
  assert.equal(twice.stdout.trim(), `${ROUNDED} undefined`);
  assert.equal(lines(twice.stderr, 'AF_BRAND').length, 1, 'once per process however often it is read');
});

test('systemFromEnv and chromiumFromEnv read the object they are given, and throw when a pair disagrees', async () => {
  const { systemFromEnv, chromiumFromEnv } = await import('../src/lib/env.mjs');
  const given = Object.freeze({ STANDARDS_SYSTEM: 'a', STANDARDS_CHROMIUM: '/c' });
  assert.equal(systemFromEnv(given), 'a');
  assert.equal(chromiumFromEnv(given), '/c');
  assert.equal(systemFromEnv({}), undefined);
  assert.equal(chromiumFromEnv({}), undefined);
  assert.equal(systemFromEnv({ STANDARDS_SYSTEM: '' }), '', 'a defined but empty value is a value');
  assert.equal(systemFromEnv({ STANDARDS_SYSTEM: 'a', AF_BRAND: 'a' }), 'a');
  assert.equal(systemFromEnv({ STANDARDS_SYSTEM: '', AF_BRAND: '' }), '');
  assert.throws(() => systemFromEnv({ STANDARDS_SYSTEM: 'a', AF_BRAND: 'b' }), /AF_BRAND.*STANDARDS_SYSTEM|STANDARDS_SYSTEM.*AF_BRAND/);
  assert.throws(() => systemFromEnv({ STANDARDS_SYSTEM: '', AF_BRAND: 'b' }), /AF_BRAND/, 'empty and set still differ');
  assert.throws(() => chromiumFromEnv({ STANDARDS_CHROMIUM: '/a', AF_CHROMIUM: '/b' }), /AF_CHROMIUM.*STANDARDS_CHROMIUM|STANDARDS_CHROMIUM.*AF_CHROMIUM/);
});

// The suite is hermetic about the old name. A shell that still exports AF_BRAND (a person mid-migration, or a
// CI image) must not change what a test judges: a test that deletes or sets STANDARDS_SYSTEM clears both names.
test('a test file that sets or deletes STANDARDS_SYSTEM in a child env clears the old name on the same line', () => {
  const files = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.mjs') && !['compat.test.mjs', 'names.test.mjs'].includes(f));
  const sites = [];
  for (const f of files) {
    readFileSync(join(root, 'test', f), 'utf8').split('\n').forEach((line, i) => {
      if (/process\.env, (\[ENV\.STANDARDS_SYSTEM\]: undefined, )?STANDARDS_SYSTEM:|delete \w+\.STANDARDS_SYSTEM\b/.test(line)) sites.push({ at: `test/${f}:${i + 1}`, line });
    });
  }
  // The private tree has 22 sites and the open export, which ships fewer test files, 13. The floor holds in both:
  // it is there to notice that the pattern has stopped matching, not to count the tests.
  assert.ok(sites.length >= 10, `only ${sites.length} sites found: the pattern no longer matches how the tests write the variable`);
  assert.deepEqual(sites.filter((x) => !x.line.includes('[ENV.STANDARDS_SYSTEM]')).map((x) => x.at), []);
});

test('the level tests pass in a shell that exports AF_BRAND', () => {
  const e = { ...env(), AF_BRAND: ROUNDED };
  delete e.NODE_TEST_CONTEXT; // this file runs under the test runner, which would make the child run its tests unreported
  const r = spawnSync(process.execPath, ['--test', join(root, 'test/levels.test.mjs')], { encoding: 'utf8', cwd: root, env: e });
  assert.match(r.stdout, /^# pass [1-9]\d*$/m, 'the level tests ran');
  assert.equal(r.status, 0, r.stdout.split('\n').filter((l) => /^\s*not ok/.test(l)).join('\n') || r.stderr);
});

// package.json's brand scripts read the variable in a shell. A person who still exports AF_BRAND (the README
// said `AF_BRAND=lilac npm run build:brand` until this release) must get what they asked for, not a conflict.
// `node` is a probe here: it prints the system the script's own environment resolves to, then the arguments.
const SCRIPTS = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
const probeNode = () => {
  const dir = scratch();
  const probe = `import(${href('src/lib/env.mjs')}).then((m) => console.log('system=' + m.systemFromEnv() + ' ' + process.argv.slice(1).join(' ')))`;
  writeFileSync(join(dir, 'node'), `#!/bin/sh\nexec "${process.execPath}" -e "$PROBE" "$@"\n`);
  chmodSync(join(dir, 'node'), 0o755);
  return { dir, probe };
};
const script = (name, set) => {
  const { dir, probe } = probeNode();
  const r = spawnSync('/bin/sh', ['-c', SCRIPTS[name]], { encoding: 'utf8', cwd: root, env: { ...env(), PATH: `${dir}:${process.env.PATH}`, PROBE: probe, ...set } });
  return { status: r.status, out: r.stdout.trim().split('\n').map((l) => l.replace(/ scripts\/\S+/, '')), stderr: r.stderr };
};
const skipScripts = SCRIPTS['build:brand'] ? false : 'the open package has no brand scripts';

test('npm run build:brand, lint:brand and golden:brand take the system from the old name, from the new one, and default to north', { skip: skipScripts }, () => {
  for (const name of ['build:brand', 'lint:brand', 'golden:brand']) {
    const fromOld = script(name, { AF_BRAND: 'lilac' });
    assert.equal(fromOld.status, 0, `${name} under AF_BRAND=lilac: ${fromOld.stderr}`);
    assert.match(fromOld.out[0], /^system=lilac/, name);
    assert.equal(fromOld.stderr, '', `${name}: the script hands its child the new name, so no line is printed`);
    const fromNew = script(name, { STANDARDS_SYSTEM: 'lilac' });
    assert.equal(fromNew.status, 0, fromNew.stderr);
    assert.match(fromNew.out[0], /^system=lilac/, name);
    assert.match(script(name, {}).out[0], /^system=north/, `${name} defaults to north`);
    const same = script(name, { STANDARDS_SYSTEM: 'lilac', AF_BRAND: 'lilac' });
    assert.equal(same.status, 0, `${name}: both names agreeing is not a conflict: ${same.stderr}`);
    // 3.3.0 read the old name with ${AF_BRAND:-north}, so an old name that is set and empty meant nothing, and still does here.
    const emptyOld = script(name, { AF_BRAND: '' });
    assert.equal(emptyOld.status, 0, `${name} under AF_BRAND=: ${emptyOld.stderr}`);
    assert.match(emptyOld.out[0], /^system=north/, `${name} under an empty AF_BRAND defaults to north`);
    const emptyOldNew = script(name, { AF_BRAND: '', STANDARDS_SYSTEM: 'lilac' });
    assert.equal(emptyOldNew.status, 0, `${name} under AF_BRAND= and STANDARDS_SYSTEM=lilac: ${emptyOldNew.stderr}`);
    assert.match(emptyOldNew.out[0], /^system=lilac/, name);
    // Two different values are the person's own conflict, and the script reports it as the command does.
    const both = script(name, { STANDARDS_SYSTEM: 'vellum', AF_BRAND: 'lilac' });
    assert.notEqual(both.status, 0, name);
    assert.match(both.stderr, /AF_BRAND and STANDARDS_SYSTEM are both set, to different values/, name);
  }
  assert.match(script('lint:brand', { AF_BRAND: 'lilac' }).out[0], /dist\/brands\/lilac\/examples\//, 'the glob follows the system');
});

test('npm run build:brands and golden:brands render every brand under its own name, whatever the shell exports', { skip: skipScripts }, () => {
  for (const name of ['build:brands', 'golden:brands']) {
    for (const set of [{}, { AF_BRAND: 'lilac' }, { AF_BRAND: ROUNDED }, { STANDARDS_SYSTEM: 'lilac' }]) {
      const r = script(name, set);
      assert.equal(r.status, 0, `${name} under ${JSON.stringify(set)}: ${r.stderr}`);
      assert.deepEqual(r.out.slice(0, 3).map((l) => l.split(' ')[0]), ['system=north', 'system=lilac', 'system=vellum'], `${name} under ${JSON.stringify(set)}`);
    }
  }
});

// Both names of a pair set to different values is a usage error wherever it is read, not a stack trace:
// every entry point that reads the system or the Chromium variable exits 2 with one line, as `standards` does.
// The system is read when the tokens load. The Chromium is read when a browser starts, so the scripts that
// start one read it, and so does the MCP server: it starts one on its first lint call, and a conflict found
// then would end the session after the handshake and drop the requests queued behind it.
const ENTRY_POINTS = [
  ['bin/af-mcp.mjs', [], true], ['bin/af.mjs', ['rules'], false], ['scripts/mcp.mjs', ['--selftest'], true],
  ['scripts/lint-page.mjs', [join(FIXTURES, 'clean.html')], true], ['scripts/audit-pages.mjs', [join(FIXTURES, 'clean.html')], true],
  ['scripts/fix-page.mjs', [join(FIXTURES, 'clean.html')], true], ['scripts/rules.mjs', [], false], ['scripts/drift.mjs', [], false],
  ['scripts/golden.mjs', [], false], ['scripts/build-brand.mjs', [], false],
  // report.mjs loads the tokens by a dynamic import, and only for --tokens. builders-report is private (the export lacks it),
  // and with no brief on every side it lints nothing, so only the Chromium pair is read: the fourth value says so.
  ['scripts/report.mjs', ['--tokens', join(FIXTURES, 'clean.html')], false],
  ['eval/builders-report.mjs', [join(FIXTURES, 'builders'), '--ours', join(FIXTURES, 'builders/pipeline'), '--out', join(tmpdir(), 'standards-compat-builders.html')], true, 'chromium only'],
].filter(([file]) => existsSync(join(root, file)));

test('a conflict between the old and the new name exits 2 with one line from every entry point, and no stack', () => {
  assert.ok(ENTRY_POINTS.length >= 8, `only ${ENTRY_POINTS.length} entry points exist`);
  for (const [file, args, startsBrowser, only] of ENTRY_POINTS) {
    const pairs = [...(only ? [] : [['STANDARDS_SYSTEM', 'AF_BRAND']]), ...(startsBrowser ? [['STANDARDS_CHROMIUM', 'AF_CHROMIUM']] : [])];
    for (const [now, old] of pairs) {
      const r = runWith(join(root, file), args, { [now]: 'a', [old]: 'b' });
      const where = `${file} under ${now} and ${old}`;
      assert.equal(r.status, 2, `${where}: ${r.stderr}`);
      assert.match(r.stderr, new RegExp(`^standards: ${old} and ${now} are both set, to different values`, 'm'), where);
      assert.doesNotMatch(r.stderr, /\n\s+at |Error:/, `${where}: no stack trace`);
      assert.equal(r.stdout, '', `${where}: nothing is written to stdout before the conflict is reported`);
    }
  }
});

// The library throws; only a process that is the entry point exits. A program that imports the package
// (src/index.mjs, or the ./mcp export that agent hosts embed) gets an error it can catch and carries on.
test('a host that imports the library under a conflict gets a catchable error, and its process survives', () => {
  // The open export has no src/index.mjs; tokens.mjs is where the package's own entry reads the variable as it loads.
  const index = href(existsSync(join(root, 'src/index.mjs')) ? 'src/index.mjs' : 'src/lib/tokens.mjs');
  const importing = child(`let message = null;
    try { await import(${index}); } catch (e) { message = e.message; }
    console.log(JSON.stringify({ message, alive: true }));`, { STANDARDS_SYSTEM: 'a', AF_BRAND: 'b' });
  assert.equal(importing.status, 0, `the host was ended by the library: ${importing.stderr}`);
  const seen = JSON.parse(importing.stdout);
  assert.match(seen.message, /AF_BRAND and STANDARDS_SYSTEM are both set, to different values/, 'the import rejects, and says why');
  assert.equal(seen.alive, true);

  // The pair can also change while a host runs. The MCP handler turns a failed measurement into a result the model can act on.
  const calling = child(`const index = await import(${index});
    const { handle } = await import(${href('src/lib/mcp.mjs')});
    const { chromiumFromEnv } = await import(${href('src/lib/env.mjs')});
    process.env.STANDARDS_CHROMIUM = '/a'; process.env.AF_CHROMIUM = '/b';
    let direct = null;
    try { chromiumFromEnv(); } catch (e) { direct = e.message; }
    const lint = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'standards_lint', arguments: { html: '<!doctype html><title>t</title>' } } });
    const after = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    console.log(JSON.stringify({ loaded: typeof index.brand, direct, isError: lint.result?.isError, text: lint.result?.content?.[0]?.text, tools: after.result?.tools?.length }));`);
  assert.equal(calling.status, 0, `the host was ended by the library: ${calling.stderr}`);
  const got = JSON.parse(calling.stdout);
  assert.match(got.direct, /AF_CHROMIUM and STANDARDS_CHROMIUM are both set, to different values/);
  assert.equal(got.isError, true, 'standards_lint reports the conflict as a failed measurement');
  assert.match(got.text, /AF_CHROMIUM and STANDARDS_CHROMIUM are both set/);
  assert.ok(got.tools > 0, 'the handler still answers after it');
});

// Every script that is run directly and reads either variable, whether in a call or where the tokens load,
// imports src/lib/env-guard.mjs before anything else, which is what turns the library's error into
// `standards: <message>` and exit 2. A file that does not would give a stack trace and exit 1.
test('every entry point that reads the system or the Chromium variable imports the guard first', () => {
  const packageScripts = JSON.stringify(SCRIPTS);
  const LOAD_READERS = new Set(['src/lib/tokens.mjs', 'src/lib/build-utils.mjs', 'scripts/golden.mjs']);
  const deps = (rel) => {
    const out = [];
    for (const m of readFileSync(join(root, rel), 'utf8').matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]+)['"]/g)) {
      out.push({ path: normalize(join(dirname(rel), m[1])), dynamic: /import\s*\(/.test(m[0]) });
    }
    return out;
  };
  const readsAtLoad = (rel, seen = new Set()) => {
    if (LOAD_READERS.has(rel)) return true;
    if (seen.has(rel) || !existsSync(join(root, rel))) return false;
    seen.add(rel);
    return deps(rel).some((d) => readsAtLoad(d.path, seen));
  };
  const entries = [];
  for (const dir of ['bin', 'scripts', 'eval']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir)).filter((f) => f.endsWith('.mjs'))) {
      const rel = `${dir}/${name}`;
      const text = readFileSync(join(root, rel), 'utf8');
      const run = dir !== 'eval' || text.startsWith('#!') || packageScripts.includes(rel);
      if (run && (readsAtLoad(rel) || /systemFromEnv|chromiumFromEnv|childEnv|setSystem/.test(text))) entries.push({ rel, text });
    }
  }
  assert.ok(entries.length >= 8, `only ${entries.length} entry points found: the search no longer matches how they are written`);
  const guard = /^import\s+(?:[^'"]*\sfrom\s+)?['"][^'"]*\/src\/lib\/env-guard\.mjs['"];/m;
  const bad = entries.filter(({ text }) => {
    const first = text.search(/^import\s+(?:[^'"]*\sfrom\s+)?['"]/m);
    const at = text.search(guard);
    const dynamic = text.search(/\bimport\(/);
    return at === -1 || at !== first || (dynamic !== -1 && dynamic < at);
  });
  assert.deepEqual(bad.map((x) => x.rel), []);
});
