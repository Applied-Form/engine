/**
 * The first ten minutes: install, load a system, lint a page, see something worth fixing.
 *
 * Readiness baseline B4 (2026-10-13): a newcomer's first `af lint` of an ordinary page reported one
 * violation at every width, "No [data-register] root in the document", a concept they had never met.
 * With no system loaded, a page that declares no register is now judged by the universal rules,
 * which need no system, with one line saying how to load one. A page that declares a register is
 * judged as it always was. `af init --pack` loads a system for every later command.
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

const root = fileURLToPath(new URL('../', import.meta.url));
const af = join(root, 'bin/af.mjs');
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

test('af lint with no system says so once, and how to load one', { skip }, () => {
  const d = dirWith({ 'page.html': ORDINARY });
  const env = { ...process.env }; delete env.AF_BRAND;
  const out = spawnSync(process.execPath, [af, 'lint', 'page.html', '--sample', '0'], { cwd: d, env, encoding: 'utf8' });
  const text = out.stdout + out.stderr;
  assert.equal((text.match(/No system loaded/g) ?? []).length, 1, text);
  assert.match(text, /af init --pack/);
  assert.match(text, /contrast/);
  assert.doesNotMatch(text, /No \[data-register\] root/);
});

test('af init --pack instrument loads Instrument for every later af command', { skip }, () => {
  const d = dirWith({ 'page.html': ORDINARY });
  const env = { ...process.env }; delete env.AF_BRAND;
  const init = spawnSync(process.execPath, [af, 'init', '--pack', 'instrument'], { cwd: d, env, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  assert.ok(existsSync(join(d, '.af/system.json')));
  assert.equal(JSON.parse(readFileSync(join(d, 'af.config.json'), 'utf8')).system, '.af/system.json');
  const lint = spawnSync(process.execPath, [af, 'lint', 'page.html', '--sample', '0'], { cwd: d, env, encoding: 'utf8' });
  const text = lint.stdout + lint.stderr;
  assert.match(text, /register PACK/, text);
  assert.doesNotMatch(text, /No system loaded/);
  assert.match(text, /radius-present/, 'Instrument declares radius 0, so the rounded card is caught');
});

test('af mcp-config prints a block whose command starts a server that lists af_lint', async () => {
  for (const client of ['claude-code', 'cursor']) {
    const out = spawnSync(process.execPath, [af, 'mcp-config', '--client', client], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const cfg = JSON.parse(out.stdout);
    const server = cfg.mcpServers['applied-form'];
    assert.ok(server?.command, out.stdout);
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
  assert.ok(list.result.tools.some((t) => t.name === 'af_lint'));
});

test.after(() => browser?.close());
