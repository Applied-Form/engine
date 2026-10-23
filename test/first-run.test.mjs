/**
 * The first ten minutes: install, load a system, lint a page, see something worth fixing.
 *
 * Readiness baseline B4 (2026-10-13): a newcomer's first `standards lint` of an ordinary page reported one
 * violation at every width, "No [data-register] root in the document", a concept they had never met.
 * With no system loaded, a page that declares no register is now judged by the universal rules,
 * which need no system, with one line saying how to load one. A page that declares a register is
 * judged as it always was. `standards init --pack` loads a system for every later command.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lintPages, launchBrowser, DEFAULT_FILE_ROOTS } from '../src/lib/page-lint.mjs';
import { RULES } from '../src/lib/rules/registry.mjs';
import { CLIENT_KEY, COMMAND, ENV } from '../src/lib/names.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const standards = join(root, 'bin/standards.mjs');
let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;
const scopeOf = Object.fromEntries(RULES.map((r) => [r.id, r]));

// Somebody's own page: a rounded, shadowed card, Arial, and a caption too pale to read.
const ORDINARY = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mine</title><style>body{font-family:Arial;margin:24px}.card{border-radius:12px;box-shadow:0 2px 8px #0003;padding:13px}.note{color:#AAAAAA}</style></head><body><main><h1>My page</h1><p class="card">A card someone wrote.</p><p class="note">Last updated yesterday.</p></main></body></html>';
const dirWith = (files) => { const d = mkdtempSync(join(tmpdir(), 'af-first-')); for (const [n, s] of Object.entries(files)) writeFileSync(join(d, n), s); return d; };

test('with no system, an undeclared page is judged by the universal rules, each with a fix', { skip }, async () => {
  const d = dirWith({ 'page.html': ORDINARY });
  const [r] = await lintPages([pathToFileURL(join(d, 'page.html')).href], { browser, viewports: [1280], fileRoots: [d, ...DEFAULT_FILE_ROOTS()], unregistered: 'universal' });
  const rules = r.violations.map((v) => v.rule);
  assert.ok(!rules.includes('register'), 'no register concept on a first run');
  assert.ok(rules.includes('contrast'), `the pale caption is caught: ${rules.join(', ')}`);
  for (const id of rules) {
    assert.equal(scopeOf[id]?.scope, 'universal', `${id} is not universal`);
    assert.ok(scopeOf[id]?.fix, `${id} names its fix`);
  }
  assert.equal(r.scope, 'universal');
});

test('a page that declares a register is still judged by every rule', { skip }, async () => {
  const [r] = await lintPages([pathToFileURL(join(root, 'test/fixtures/violations.html')).href], { browser, viewports: [1280], unregistered: 'universal' });
  assert.ok(r.violations.some((v) => scopeOf[v.rule]?.scope === 'house'), 'house rules still apply to a declared page');
  assert.notEqual(r.scope, 'universal');
});

test('standards lint with no system says so once, and how to load one', { skip }, () => {
  const d = dirWith({ 'page.html': ORDINARY });
  const env = { ...process.env }; delete env.STANDARDS_SYSTEM; delete env[ENV.STANDARDS_SYSTEM];
  const out = spawnSync(process.execPath, [standards, 'lint', 'page.html', '--sample', '0'], { cwd: d, env, encoding: 'utf8' });
  const text = out.stdout + out.stderr;
  assert.equal((text.match(/No system loaded/g) ?? []).length, 1, text);
  assert.match(text, /standards init --pack/);
  assert.match(text, /contrast/);
  assert.doesNotMatch(text, /No \[data-register\] root/);
});

test('standards init --pack instrument loads Instrument for every later standards command', { skip }, () => {
  const d = dirWith({ 'page.html': ORDINARY });
  const env = { ...process.env }; delete env.STANDARDS_SYSTEM; delete env[ENV.STANDARDS_SYSTEM];
  const init = spawnSync(process.execPath, [standards, 'init', '--pack', 'instrument'], { cwd: d, env, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  assert.ok(existsSync(join(d, '.standards/system.json')));
  assert.equal(JSON.parse(readFileSync(join(d, 'standards.config.json'), 'utf8')).system, '.standards/system.json');
  const lint = spawnSync(process.execPath, [standards, 'lint', 'page.html', '--sample', '0'], { cwd: d, env, encoding: 'utf8' });
  const text = lint.stdout + lint.stderr;
  assert.match(text, /register PACK/, text);
  assert.doesNotMatch(text, /No system loaded/);
  assert.match(text, /radius-present/, 'Instrument declares radius 0, so the rounded card is caught');
});

test('standards mcp-config prints a block whose command starts a server that lists standards_lint', async () => {
  for (const client of ['claude-code', 'cursor']) {
    const out = spawnSync(process.execPath, [standards, 'mcp-config', '--client', client], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const cfg = JSON.parse(out.stdout);
    const server = cfg.mcpServers[CLIENT_KEY];
    assert.ok(server?.command, out.stdout);
    assert.deepEqual(Object.keys(cfg.mcpServers), [CLIENT_KEY], 'one server, under the key the server introduces itself by');
    assert.deepEqual([server.command, ...server.args], ['npx', COMMAND, 'mcp'], 'the local install, which npx resolves from node_modules/.bin');
    assert.ok(!server.args.includes('--legacy-tool-names'), 'the new route lists the new names');
  }
  // Start the printed server from this checkout (the printed npx form resolves the installed package).
  const p = spawn(process.execPath, [join(root, 'scripts/mcp.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  p.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  const send = (m) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list', params: {} });
  const deadline = Date.now() + 15000;
  while (!lines.some((l) => l.includes('"id":2')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  p.kill();
  const list = JSON.parse(lines.find((l) => l.includes('"id":2')));
  assert.ok(list.result.tools.some((t) => t.name === 'standards_lint'));
});

test.after(() => browser?.close());
