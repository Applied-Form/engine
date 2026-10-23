#!/usr/bin/env node
/**
 * standards fix — lint a rendered page, apply the fixes Standards can make on its own, and write the result.
 *
 *   standards fix <page.html | url> [--out fixed.html] [--json] [--system <tokens.json | pack | name>]
 *          [--register i|ii] [--widths 320,1280] [--sample n] [--seed n]
 *
 * The fixes are declarations in one appended `<style data-af-fixes>` block, addressed to the elements
 * the checker measured. The page's own markup is not edited. A fix that makes any checked rule worse
 * at any width measured is not shipped, and the log says which and why. No model is called.
 *
 * The page is written to `<name>.fixed.html` beside the input, or to `--out`. The input is written
 * only when `--out` names it.
 *
 *   --system    a token overlay, a Standards pack tokens.json, a bundled pack (instrument) or a brand
 *               name. Without it the system is STANDARDS_SYSTEM, or the one standards.config.json names, as for standards lint.
 *   --widths    the widths to measure and fix at. Without it, the four fixed widths and --sample (2)
 *               widths drawn from between them, seeded by --seed so a run can be repeated.
 *
 * Exit 0 when the fixed page passes every checked rule at every width measured, 1 when violations
 * remain, 2 on a usage or load error.
 */
import { exitOnConflict } from '../src/lib/env-guard.mjs'; // first: a name conflict exits 2 (src/lib/env-guard.mjs)
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { systemFromEnv, setSystem, childEnv, CONFLICT } from '../src/lib/env.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const USAGE = 'usage: standards fix <page.html | url> [--out fixed.html] [--json] [--system <tokens.json | pack | name>] [--register i|ii] [--widths 320,1280] [--sample n] [--seed n]';
const VALUE_FLAGS = ['out', 'system', 'register', 'widths', 'sample', 'seed'];

const fail = (message) => { console.error(`standards fix: ${message}`); process.exit(2); };

const targets = [];
const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { targets.push(a); continue; }
  const name = a.slice(2);
  if (VALUE_FLAGS.includes(name)) {
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) fail(`--${name} needs a value\n${USAGE}`);
    opts[name] = next; i += 1;
  } else if (name === 'json' || name === 'help') opts[name] = true;
  else fail(`unknown option --${name}\n${USAGE}`);
}
if (opts.help) { console.log(USAGE); process.exit(0); }
if (targets.length !== 1) fail(targets.length ? `one page at a time\n${USAGE}` : USAGE);
const json = !!opts.json;

/**
 * --system, resolved to what STANDARDS_SYSTEM takes: a path to an overlay, or a brand name. A Standards pack
 * is imported first, by the same path `standards system import` takes, in a child process, because the
 * tokens are read once per process and this one has not read them yet.
 */
function loadSystem(given) {
  const isPack = (j) => /token-contract/.test(String(j?.$schema ?? '')) || (j?.colour && j?.system_values);
  const asFile = resolve(given);
  let pack = null, key = null;
  if (given.endsWith('.json')) {
    if (!existsSync(asFile)) fail(`--system: no such file ${given}`);
    let parsed;
    try { parsed = JSON.parse(readFileSync(asFile, 'utf8')); } catch (e) { fail(`--system: ${given} is not JSON (${e.message})`); }
    if (!isPack(parsed)) return asFile;
    pack = asFile;
  } else if (/^[a-z0-9-]+$/i.test(given) && existsSync(`${ROOT}packs/${given}.tokens.json`)) {
    pack = `${ROOT}packs/${given}.tokens.json`; key = given;
  } else if (/^[a-z0-9-]+$/i.test(given)) {
    // A brand name: the token loader finds it, or the import below fails and says so.
    return given;
  } else {
    fail(`--system: no system named ${given}. Give a token overlay, a Standards pack tokens.json, a bundled pack (instrument) or a brand name.`);
  }
  const out = join(mkdtempSync(join(tmpdir(), 'af-fix-system-')), 'system.json');
  const env = childEnv({ STANDARDS_SYSTEM: undefined });
  const r = spawnSync(process.execPath, [`${ROOT}scripts/system.mjs`, 'import', pack, '--out', out, ...(key ? ['--key', key] : [])], { encoding: 'utf8', env });
  if (r.status !== 0 || !existsSync(out)) fail(`--system: the pack at ${given} was refused\n${(r.stdout + r.stderr).trim()}`);
  return out;
}

let systemLabel = systemFromEnv() || null;
if (opts.system) {
  setSystem(loadSystem(opts.system));
  systemLabel = opts.system.endsWith('.json') ? resolve(opts.system) : opts.system;
}

// The system is fixed from here: these modules read the tokens as they load.
let VIEWPORTS, sampledViewports, launchBrowser, DEFAULT_FILE_ROOTS, registers, fixPage;
try {
  ({ VIEWPORTS, sampledViewports, launchBrowser, DEFAULT_FILE_ROOTS } = await import('../src/lib/page-lint.mjs'));
  ({ registers } = await import('../src/lib/tokens.mjs'));
  ({ fixPage } = await import('../src/lib/fix/page.mjs'));
} catch (e) {
  fail(`could not load the system ${systemLabel ?? 'from the token file'}: ${e.message.split('\n')[0]}. Give a token overlay, a Standards pack tokens.json, a bundled pack (instrument) or a brand name.`);
}

const register = opts.register ?? null;
if (register != null && !Object.hasOwn(registers, register)) fail(`unknown register "${register}"; the system defines ${Object.keys(registers).join(', ')}`);

let viewports, seed = null, sampled = [];
if (opts.widths) {
  viewports = opts.widths.split(',').map((w) => Number(w.trim()));
  if (!viewports.length || viewports.some((w) => !Number.isInteger(w) || w < 1)) fail(`--widths takes whole pixel widths separated by commas, got "${opts.widths}"`);
} else {
  const count = opts.sample != null ? Number(opts.sample) : 2;
  seed = opts.seed != null ? Number(opts.seed) : Date.now();
  if (!Number.isInteger(count) || count < 0) fail(`--sample takes a whole number, got "${opts.sample}"`);
  if (!Number.isFinite(seed)) fail(`--seed takes a number, got "${opts.seed}"`);
  sampled = count > 0 ? sampledViewports(count, seed) : [];
  viewports = [...VIEWPORTS, ...sampled].sort((a, b) => a - b);
}

// The page, where it is read from, and where the fixed page goes.
const target = targets[0];
let html, input, baseHref, fileRoots, defaultOut;
if (/^https?:\/\//i.test(target)) {
  let res;
  try { res = await fetch(target); } catch (e) { fail(`could not fetch ${target}: ${e.message}`); }
  if (!res.ok) fail(`could not fetch ${target}: HTTP ${res.status}`);
  html = await res.text();
  input = target;
  baseHref = res.url || target;
  const name = basename(new URL(baseHref).pathname).replace(/\.html?$/i, '') || 'index';
  defaultOut = resolve(`${name}.fixed.html`);
} else {
  const path = target.startsWith('file:') ? fileURLToPath(target) : resolve(target);
  if (!existsSync(path)) fail(`no such file ${target}`);
  try { html = readFileSync(path, 'utf8'); } catch (e) { fail(`could not read ${target}: ${e.message}`); }
  input = path;
  baseHref = pathToFileURL(`${dirname(path)}/`).href;
  // What standards lint lets the page read: its own directory, the working directory, the engine's files.
  fileRoots = [dirname(path), ...DEFAULT_FILE_ROOTS()];
  defaultOut = join(dirname(path), `${basename(path).replace(/\.html?$/i, '')}.fixed.html`);
}
const output = opts.out ? resolve(opts.out) : defaultOut;

let browser;
try { browser = await launchBrowser(); } catch (e) { if (e?.code === CONFLICT) exitOnConflict(e); fail(`could not start Chromium (${e.message.split('\n')[0]}). Run npx playwright install chromium, or set STANDARDS_CHROMIUM to a Chromium executable.`); }
let fixed;
try {
  fixed = await fixPage(html, { browser, register, viewports, fileRoots, baseHref, unregistered: !systemFromEnv() && register == null ? 'universal' : 'house' });
} catch (e) {
  await browser.close();
  fail(`could not fix ${target}: ${e.message}`);
}
await browser.close();
writeFileSync(output, fixed.html);

const { report } = fixed;
const exitCode = report.passed ? 0 : 1;

if (json) {
  console.log(JSON.stringify({ input, output, system: systemLabel, seed, ...report }, null, 2));
  process.exit(exitCode);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const decls = (d) => Object.entries(d).map(([k, v]) => `${k}: ${v}`).join('; ');
const where = (p) => `${p.selector ?? '(no selector)'}${p.pseudo ?? ''}`;

console.log(`standards fix: ${input} -> ${output}`);
const systemLine = report.scope === 'universal'
  ? 'none loaded, so a page without a register is held to the universal rules only (load one with --system or standards init --pack)'
  : systemLabel ?? 'the base tokens';
console.log(`system: ${systemLine}`);
if (report.register) console.log(`register: ${report.register.toUpperCase()}${report.assumedRegister ? ', assumed' : ''}`);
console.log(`widths: ${viewports.join(', ')}px${sampled.length ? ` (${sampled.join(', ')} sampled; --seed ${seed} to repeat)` : ''}`);

console.log(`\nViolations: ${report.before.violations} before, ${report.after.violations} after.`);
console.log(report.fixed.length ? `Rules fixed (${report.fixed.length}): ${report.fixed.join(', ')}` : 'Rules fixed: none');

console.log(`\nApplied ${plural(report.applied.length, 'patch', 'patches')}${report.applied.length ? ':' : '.'}`);
for (const p of report.applied) console.log(`  ${where(p)}  { ${decls(p.declarations)} }  [${p.rules.join(', ')}]`);
console.log(`Refused ${plural(report.refused.length, 'patch', 'patches')}${report.refused.length ? ':' : '.'}`);
for (const p of report.refused) console.log(`  ${where(p)}  { ${decls(p.declarations)} }  [${p.rules.join(', ')}]: ${p.reason}`);

if (report.remaining.length) {
  console.log(`\nStill failing (${plural(report.after.violations, 'violation')} across ${plural(report.remaining.length, 'element or page check', 'elements and page checks')}):`);
  for (const v of report.remaining) {
    console.log(`  ${v.rule}  ${v.selectors.length ? v.selectors.join(', ') : '(the page)'}  at ${v.widths.join(', ')}px`);
    console.log(`    ${v.message}${v.sample ? `  [${v.sample}]` : ''}`);
    if (v.fix) console.log(`    Fix: ${v.fix}`);
  }
}

console.log(`\nNot checked: ${report.notChecked.note}`);
console.log(report.passed
  ? `\nThe fixed page passes every checked rule at ${plural(viewports.length, 'width')}.`
  : `\n${plural(report.after.violations, 'violation')} remain. These need a change to the markup or a decision the fixer does not make.`);
process.exit(exitCode);
