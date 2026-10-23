#!/usr/bin/env node
/**
 * standards audit <pages… | dir> — lint a set of pages, optionally fix them, and write one report.
 *
 *   standards audit <page.html | url | dir> [...] [--system <tokens.json | pack | name>] [--fix] [--offline]
 *             [--root dir]... [--out report.html] [--json] [--register i|ii] [--widths 320,1280]
 *             [--sample n] [--seed n]
 *
 * Every page is rendered at the widths `standards lint` uses (the four fixed widths and two sampled from
 * between them, seeded by --seed) and judged by the rules in force for it. With --fix the
 * deterministic fixer runs too, with the settings `standards fix` uses, on a copy, and the report gives
 * each finding as found and as it is on the page at its own address with the fixer's CSS added. A
 * fixer that applied nothing cured nothing. A page that, with the fixes, did not load a stylesheet,
 * script or font it loaded as found is not compared: its findings are counted as found, and none as
 * fixed or introduced. A directory is read for .html files at
 * any depth, leaving out the `<name>.fixed.html` pages `standards fix` writes and any report this command
 * wrote. A page named twice is measured once. A page that cannot be read, fetched or rendered, or
 * has nothing on it to measure, is named in the report with the reason, and is never counted clean.
 *
 * A page is measured where it is, as a visitor's browser renders it, network included. The pages
 * are other people's, so a local page reads only its own directory and below, the directories named
 * and the engine's published files; any other file it asks for is refused (confine in
 * page-lint.mjs), the working directory included unless it was named or a page named alone sits in
 * it or above it. Such a page reads the working directory, and a warning says so. --root <dir>
 * (repeatable) lets every local page read that directory too, without reading it for pages.
 * --offline refuses every request over the network as well. A page from a URL reads no local file.
 * A URL the browser is not answered with a 2xx document for is not loaded.
 *
 * Every request a page made that did not load, or was refused, is listed with the page and its
 * resource type. A page whose stylesheet, script or font did not load is measured incomplete: its
 * findings are reported, and it is never counted clean. Whether a page loaded and was measured
 * complete is judged on the page as found, never on the render with the fixes, and never on the
 * fixer's copy, which is rendered from a file with the page's address as its base and can fail
 * requests a visitor's browser makes.
 *
 * The report is one self-contained Register II page, written to --out (default standards-audit.html).
 * --json prints the same account to stdout; with --json the page is written only when --out names it.
 * The pages audited are read and never written. No model is called. Rule overrides and baselines in
 * standards.config.json are not applied: every rule listed is checked, and the report says so. A path in
 * the report is shown from the working directory, or by its name outside it. The commands that
 * repeat the run, for the set and for one page, are the one exception: they carry the targets, the
 * --root directories and the system as they were typed, with the widths, the register, --fix and
 * --offline, so they work from the same directory and measure what this run measured. A page that
 * could read a directory named above its own, or read a file in another directory named, is given
 * its own one-page command, with that directory as a --root, and that command names the page as this
 * run does.
 *
 * Exit 0 when every page loaded, was measured complete and passes every checked rule as found, 1
 * otherwise, 2 on a usage error. --fix does not change that: the fixes are not written, so a page
 * that fails on disk fails the run.
 */
import { exitOnConflict } from '../src/lib/env-guard.mjs'; // first: a name conflict exits 2 (src/lib/env-guard.mjs)
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, join, isAbsolute, sep, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const USAGE = `usage: standards audit <page.html | url | dir> [...] [--system <tokens.json | pack | name>] [--fix] [--offline] [--root dir]... [--out report.html] [--json] [--register i|ii] [--widths 320,1280] [--sample n] [--seed n]`;
const VALUE_FLAGS = ['out', 'system', 'register', 'widths', 'sample', 'seed', 'root'];
// How long a measured page stays open for its network to go quiet, so a request it makes after its
// load event is heard and listed rather than cancelled when the page closes (lintPages `settle`).
const SETTLE = 3000;

const fail = (message) => { console.error(`standards audit: ${message}`); process.exit(2); };

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
    if (name === 'root') (opts.root ??= []).push(next); else opts[name] = next;
    i += 1;
  } else if (['json', 'fix', 'help', 'offline'].includes(name)) opts[name] = true;
  else fail(`unknown option --${name}\n${USAGE}`);
}
if (opts.help) { console.log(USAGE); process.exit(0); }
if (!targets.length) fail(USAGE);
const isUrl = (t) => /^https?:\/\//i.test(t);
if (opts.offline && targets.some(isUrl)) fail(`--offline refuses the network, so it cannot audit a URL (${targets.find(isUrl)}). Audit a local copy, or run without --offline.`);

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const here = real(process.cwd());
const toPath = (t) => (t.startsWith('file:') ? fileURLToPath(t) : resolve(t));
// --root: a directory every local page may read besides its own, as a directory named may be, though
// it is not read for pages.
const ROOTS = (opts.root ?? []).map((typed) => {
  const path = toPath(typed);
  if (!existsSync(path) || !statSync(path).isDirectory()) fail(`--root ${typed}: no such directory`);
  return { typed, path, real: real(path) };
});
// A path in the report is shown from the working directory, or outside it by its name (a page, from
// the parent of the directory that holds it: see the pages below), so a report sent to a client does
// not carry the auditor's directories.
const under = (path, base) => {
  const rel = relative(base, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
};
const shown = (path, dir = null) => under(path, process.cwd()) ?? under(path, here) ?? (dir ? under(path, dirname(dir)) : null) ?? basename(path);
const shownDir = (path) => (relative(process.cwd(), path) === '' ? '.' : shown(path));
// A system set by standards.config.json reaches here as an absolute path (bin/standards.mjs resolves it). The
// command that repeats the run gives it from the working directory, as ../system.json for a file
// beside it, or by name when that would climb to the filesystem root.
const fromHere = (s) => {
  const rel = relative(process.cwd(), s);
  const depth = process.cwd().split(sep).filter(Boolean).length;
  if (isAbsolute(rel) || rel.split(sep).filter((x) => x === '..').length >= depth) return basename(s);
  return (rel || '.').split(sep).join('/');
};
// An error message may quote a path or a file URL; only its last part goes in the report.
const scrub = (s) => String(s).replace(/(?<=^|[\s'"(=,])(?:file:\/\/)?\/[^\s'"()<>,]*/g, (m) => m.split('/').filter(Boolean).pop() ?? '');

// The system, fixed before anything that reads the tokens is imported. It came from --system, or
// from STANDARDS_SYSTEM, which standards.config.json sets through bin/standards.mjs. The heading and the provenance show a
// path to it as every path in the report is shown; the command that repeats the run carries it as
// it was typed.
const { resolveSystem } = await import('../src/lib/system-arg.mjs');
const { systemFromEnv, setSystem, CONFLICT } = await import('../src/lib/env.mjs');
let systemGiven = systemFromEnv() || null;
if (opts.system) {
  try { setSystem(resolveSystem(opts.system).brand); } catch (e) { fail(e.message); }
  systemGiven = opts.system;
}
const isPath = (s) => isAbsolute(s) || /[\\/]/.test(s) || /\.json$/i.test(s);
const systemLabel = systemGiven && isPath(systemGiven) ? shown(resolve(systemGiven)) : systemGiven;
const systemArg = opts.system ?? (systemGiven && isAbsolute(systemGiven) ? fromHere(systemGiven) : systemGiven);

let VIEWPORTS, sampledViewports, launchBrowser, lintPages, tokens, fixPage, audit, html, loadConfig;
try {
  ({ VIEWPORTS, sampledViewports, launchBrowser, lintPages } = await import('../src/lib/page-lint.mjs'));
  tokens = await import('../src/lib/tokens.mjs');
  ({ fixPage } = await import('../src/lib/fix/page.mjs'));
  ({ loadConfig } = await import('../src/lib/policy.mjs'));
  audit = await import('../src/lib/audit.mjs');
  html = await import('../src/lib/audit-html.mjs');
} catch (e) {
  fail(`could not load the system ${systemLabel ?? 'from the token file'}: ${e.message.split('\n')[0]}. Give a token overlay, a Standards pack tokens.json, a bundled pack (instrument) or a brand name.`);
}

const register = opts.register ?? null;
if (register != null && !Object.hasOwn(tokens.registers, register)) fail(`unknown register "${register}"; the system defines ${Object.keys(tokens.registers).join(', ')}`);

let viewports, seed = null, sampled = [];
if (opts.widths) {
  viewports = opts.widths.split(',').map((w) => Number(w.trim()));
  if (!viewports.length || viewports.some((w) => !Number.isInteger(w) || w < 1)) fail(`--widths takes whole pixel widths separated by commas, got "${opts.widths}"`);
  viewports = [...new Set(viewports)].sort((a, b) => a - b);
} else {
  const count = opts.sample != null ? Number(opts.sample) : 2;
  seed = opts.seed != null ? Number(opts.seed) : Date.now();
  if (!Number.isInteger(count) || count < 0) fail(`--sample takes a whole number, got "${opts.sample}"`);
  if (!Number.isFinite(seed)) fail(`--seed takes a number, got "${opts.seed}"`);
  sampled = count > 0 ? sampledViewports(count, seed) : [];
  viewports = [...VIEWPORTS, ...sampled].sort((a, b) => a - b);
}

// Rule overrides are a team's rollout choice, not a property of the pages, so the report does not
// apply them. It records them, so a reader who runs standards lint with them can see why the two differ.
let overrides = {}, configSource = null;
try { const config = loadConfig(process.cwd()); overrides = config.rules ?? {}; configSource = config.source; } catch { /* a malformed file is standards lint's to report; nothing is applied either way */ }
if (Object.keys(overrides).length && !opts.json) process.stderr.write(`standards audit: ${basename(configSource)} sets ${Object.entries(overrides).map(([r, s]) => `${r}: ${s}`).join(', ')}; the report does not apply rule overrides, and checks every rule it lists\n`);

const output = opts.out ? resolve(opts.out) : opts.json ? null : resolve('standards-audit.html');

// The pages: URLs as given, files as given, directories read for .html at any depth. Links to
// directories and files are not followed.
const PAGE = /\.x?html?$/i;
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.isFile() && /\.html?$/i.test(e.name) && !/\.fixed\.html?$/i.test(e.name) ? [join(dir, e.name)] : []));
// A report this command wrote is not a page of the set, wherever it was written and whatever it is called.
const notReport = (f) => { try { return f !== output && !html.isReport(readFileSync(f, 'utf8')); } catch { return true; } };
const inside = (p, dir) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const dirs = [];
const found = [];
for (const t of targets) {
  if (isUrl(t)) { found.push({ url: t }); continue; }
  const path = toPath(t);
  if (existsSync(path) && statSync(path).isDirectory()) {
    const listed = walk(path).filter(notReport);
    if (!listed.length) fail(`no pages (.html) in ${t}`);
    dirs.push({ path, real: real(path), typed: t });
    // Each page as it can be typed from here: the directory as typed, and the page's path inside it.
    for (const f of listed) found.push({ path: f, typed: t.startsWith('file:') ? pathToFileURL(f).href : join(t, relative(path, f)).split(sep).join('/') });
  } else {
    found.push({ path, typed: t });
  }
}

// Each page once, by its real path, named from the working directory or, outside it, from the parent
// of the widest directory that holds it: a directory named, a --root, or else its own. The command
// that measures it alone gives with --root every directory named above its own, so that command
// names it the same way.
const inputs = [];
const named = new Set();
for (const { url, path, typed } of found) {
  if (url) { if (!named.has(url)) { named.add(url); inputs.push({ input: url, url, typed: url }); } continue; }
  const page = real(path);
  if (named.has(page)) continue;
  named.add(page);
  const holder = [...dirs, ...ROOTS].filter((d) => inside(page, d.real)).sort((a, b) => a.real.length - b.real.length)[0] ?? { path: dirname(path), real: dirname(page) };
  inputs.push({ input: shown(path, holder.path), path, page, holder, typed });
}

// What a local page may read, in place: its own directory and below (confine adds it; the fixer's
// copy of the page sits elsewhere, so it is given here too), every directory named, and the
// engine's published files (package.json "files": its stylesheets, fonts and modules), which are
// public wherever the engine is, and every --root. Not the working directory, unless it was named
// or the page sits in it.
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ENGINE = real(ROOT);
const PUBLISHED = (PKG.files ?? []).map((f) => join(ENGINE, f));
const NAMED = [...new Set([...dirs, ...ROOTS].map((d) => d.real))];

const asRun = { widths: viewports, system: systemArg, register, fix: !!opts.fix, offline: !!opts.offline };
/**
 * The command that measures one page alone as this run measured it. A local page could read every
 * directory named above its own, and every --root: each is given with --root, as typed. A directory
 * named beside its own is given only when the page asked for a file in it (`reads`, the real paths of
 * the files it requested), since only then does it measure differently without it. A page from a URL
 * reads no local file, so it needs none.
 */
const commandFor = (entry, reads = []) => {
  if (entry.url) return audit.pageCommand({ page: entry.typed, roots: [], ...asRun });
  const own = dirname(entry.page);
  const needed = (d) => !inside(d.real, own) && (inside(own, d.real) || reads.some((p) => inside(p, d.real)));
  const seen = new Set();
  const roots = [...dirs.filter(needed), ...ROOTS].filter((d) => !seen.has(d.real) && seen.add(d.real)).map((d) => d.typed);
  return audit.pageCommand({ page: entry.typed, roots, ...asRun });
};

/** A request as the report shows it: a file from the working directory or by name, an address without its query. */
const requestShown = (href, holder) => {
  try {
    const u = new URL(href);
    return u.protocol === 'file:' ? shown(fileURLToPath(u), holder?.real) : `${u.origin}${u.pathname}`;
  } catch {
    // A file URL Node will not turn into a path (an encoded slash, say) still names the auditor's
    // directories: show only its last segment.
    if (String(href).startsWith('file:')) { let p = String(href); try { p = decodeURIComponent(p); } catch { /* keep as written */ } return p.split(/[\\/]/).filter(Boolean).pop() ?? 'a local file'; }
    return String(href).slice(0, 80);
  }
};
/** What happened to it, in words. */
const whyShown = ({ url, why }) => {
  if (why === 'refused') return String(url).startsWith('file:') ? audit.REFUSED.file : audit.REFUSED.network;
  if (why === 'net::ERR_FILE_NOT_FOUND') return 'no such file';
  return why.replace(/^net::/, '').replace(/\.Inspector$/, '');
};

/** True when no width found any text, image, link, control or chart: a blank page has passed nothing. */
const nothingOn = (results) => results.length > 0 && results.every(({ spec = {} }) => Array.isArray(spec.text)
  && ![spec.text, spec.imagery, spec.links, spec.targets, spec.charts].some((xs) => xs?.length));

let browser;
try { browser = await launchBrowser(); } catch (e) { if (e?.code === CONFLICT) exitOnConflict(e); fail(`could not start Chromium (${e.message.split('\n')[0]}). Run npx playwright install chromium, or set STANDARDS_CHROMIUM to a Chromium executable.`); }
const unregistered = !systemFromEnv() && register == null ? 'universal' : 'house';

const pages = [];
const notAPage = (why) => Object.assign(new Error(why), { notAPage: true });
for (const entry of inputs) {
  const { input, url, path } = entry;
  if (!json()) process.stderr.write(`standards audit: ${input}\n`);
  // Every request that did not load, on any render of the page as found and, apart, of the page with
  // the fixes, once each; and every local file either render asked for, for the command that measures
  // the page alone.
  const failed = new Map(), failedFixed = new Map();
  const hear = (into) => (f) => { const key = `${f.type} ${f.url}`; if (!into.has(key)) into.set(key, f); };
  const rowsOf = (heard) => {
    const rows = new Map();
    for (const f of heard.values()) {
      const row = { resource: requestShown(f.url, entry.holder), type: f.type, why: whyShown(f) };
      rows.set(`${row.resource}|${row.type}|${row.why}`, row);
    }
    return [...rows.values()].sort((a, b) => a.resource.localeCompare(b.resource) || a.type.localeCompare(b.type));
  };
  const failures = () => rowsOf(failed);
  const reads = new Set();
  const onRequest = ({ url: u }) => { if (String(u).startsWith('file:')) { try { reads.add(real(fileURLToPath(u))); } catch { /* not a path */ } } };
  const alone = () => commandFor(entry, [...reads]);
  let page, href, baseHref, fileRoots, network;
  try {
    if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      page = await res.text();
      href = res.url || url;
      baseHref = href;
      // A page from the network reads no local file, and may use the network it came from.
      fileRoots = [];
      network = true;
    } else {
      if (!existsSync(path)) throw new Error('no such file');
      if (!statSync(path).isFile()) throw new Error('not a file');
      if (!PAGE.test(path)) throw notAPage(`${extname(path) ? `a ${extname(path)} file` : 'a file with no extension'}, not an HTML page`);
      page = readFileSync(entry.page, 'utf8');
      href = pathToFileURL(entry.page).href;
      baseHref = pathToFileURL(`${dirname(entry.page)}/`).href;
      fileRoots = [dirname(entry.page), ...NAMED, ...PUBLISHED];
      network = !opts.offline;
      // Its own directory holds the working directory, and nothing named holds that: the page, named
      // alone, may read every file in and below where standards audit was run.
      if (inside(here, dirname(entry.page)) && !NAMED.some((r) => inside(here, r))) {
        const sits = dirname(entry.page) === here;
        process.stderr.write(`standards audit: warning: ${input} sits ${sits ? 'in' : 'above'} the working directory and was named alone, so it may read every file in and below ${sits ? 'the working directory' : 'its own directory, the working directory included'}\n`);
      }
    }
    if (!page.trim()) throw notAPage('it is empty');
    if (!/<[a-z!]/i.test(page)) throw notAPage('it holds no HTML markup');
  } catch (e) {
    pages.push(audit.pageEntry({ input, error: `${e.notAPage ? 'not measured' : 'could not be read'}: ${scrub(e.message)}`, fixerRan: !!opts.fix, command: alone() }));
    continue;
  }
  // A link is checked where it leads (confine in page-lint.mjs): the pages are somebody else's.
  const common = { browser, register, viewports, fileRoots, network, unregistered, realpaths: true };
  let initial;
  try {
    // The page as found, at its own address, as a visitor's browser loads it. Whether it loaded, and
    // whether it was measured complete, is judged here and nowhere else, with or without --fix.
    initial = await lintPages([href], { ...common, withIds: true, requireOk: !!url, onFailed: hear(failed), onRequest, settle: SETTLE });
    if (nothingOn(initial)) throw notAPage('there is no text, image, link or control on it to measure');
  } catch (e) {
    pages.push(audit.pageEntry({ input, error: `${e.notAPage ? 'not measured' : 'could not be rendered'}: ${scrub(e.message.split('\n')[0])}`, fixerRan: !!opts.fix, failed: failures(), command: alone() }));
    continue;
  }
  let after = null, fix = null, afterError = null;
  if (opts.fix) {
    // The fixer works on a copy, rendered from a file with the page's address as its base, and gives
    // the CSS it would add. What the copy fails to load (a module script or a fetch refused across
    // origins, say) is not what a visitor sees, so it is not heard, and the copy's figures are not
    // the report's. A fixer that fails, or applies nothing, cures nothing: the page with the fixes is
    // the page as found (pageEntry).
    let css = '';
    try {
      ({ report: fix, css } = await fixPage(page, { ...common, baseHref }));
    } catch (e) {
      process.stderr.write(`standards audit: the fixer could not run on ${input} (${scrub(e.message.split('\n')[0])}); it is reported as found, with nothing fixed\n`);
      fix = { applied: [], refused: [], fixed: [] };
    }
    // The page with the fixes is the page as found, at its own address, with the fixer's CSS added,
    // and every request it fails is heard as they were on the page as found. A page that loses there
    // a stylesheet, script or font it loaded as found is not compared (pageEntry).
    if (fix.applied.length) {
      try {
        after = await lintPages([href], { ...common, withIds: true, requireOk: !!url, css, onFailed: hear(failedFixed), onRequest, settle: SETTLE });
      } catch (e) {
        afterError = scrub(e.message.split('\n')[0]);
      }
    }
  }
  // A page whose stylesheet, script or font did not load is measured incomplete (pageEntry).
  pages.push(audit.pageEntry({ input, initial, after, fix, failed: failures(), afterFailed: rowsOf(failedFixed), afterError, command: alone() }));
}
await browser.close();

function json() { return !!opts.json; }

const { quote } = audit;
// The targets, the --root directories and the system as typed, so the command works from the
// directory it was run in.
const command = ['npx @appliedform/standards@4 audit', ...targets.map(quote), ...ROOTS.flatMap((r) => ['--root', quote(r.typed)]),
  ...(systemArg ? ['--system', quote(systemArg)] : []), ...(register ? ['--register', register] : []),
  ...(opts.fix ? ['--fix'] : []), ...(opts.offline ? ['--offline'] : []), '--widths', viewports.join(',')].join(' ');
const { version: engineVersion, name: engineName } = PKG;
const report = audit.buildReport({
  pages,
  system: audit.systemOf(pages, { label: systemLabel, arg: systemArg, version: tokens.version ?? null }),
  engine: { name: engineName, version: engineVersion },
  register, widths: viewports, sampled, seed, fix: !!opts.fix, offline: !!opts.offline,
  roots: ROOTS.map((r) => r.typed), rootsShown: ROOTS.map((r) => shownDir(r.path)),
  generated: new Date().toISOString(),
  command,
  policy: { applied: false, overrides },
});

if (output) {
  // The outlined wordmark goes on the masthead where this distribution carries it; the open engine
  // does not, and its report carries the label alone. Never live text.
  let mark = null;
  const identity = join(ROOT, 'src', 'lib', 'identity.mjs');
  if (existsSync(identity) && existsSync(join(ROOT, 'assets', 'wordmark.svg'))) {
    const { wordmarkSvg } = await import(pathToFileURL(identity).href);
    mark = wordmarkSvg('report-wordmark');
  }
  let css;
  try { css = html.houseCss(); } catch (e) { fail(e.message); }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html.renderReport(report, { css, mark }));
}

// The run passes on the pages as they are. The fixer's changes are not written, so they cannot pass it.
const a = report.aggregate;
const passed = a.notLoaded.length === 0 && a.clean.before === a.pages;
if (json()) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(passed ? 0 : 1);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
console.log(`standards audit: ${plural(a.pages, 'page')}, system ${report.system.label}, widths ${viewports.join(', ')}px${sampled.length ? ` (${sampled.join(', ')} sampled; --seed ${seed} to repeat)` : ''}`);
console.log(`Loaded ${a.loaded} of ${a.pages}.${a.notLoaded.length ? ` Not loaded, and not counted clean: ${a.notLoaded.map((p) => `${p.input} (${p.error})`).join('; ')}` : ''}`);
if (a.incomplete.length) console.log(`Measured incomplete, and not counted clean: ${a.incomplete.map((p) => `${p.input} (${p.failed.map((f) => `${f.type} ${f.resource}: ${f.why}`).join(', ')})`).join('; ')}`);
if (a.notComparable.length) console.log(`Not compared with the fixes, and counted as found: ${a.notComparable.map((p) => `${p.input} (${p.error ?? p.lost.map((f) => `${f.type} ${f.resource}: ${f.why}`).join(', ')})`).join('; ')}`);
console.log(`Clean: ${a.clean.before} as found${opts.fix ? `, ${a.clean.after} if fixed (the fixes are not written)` : ''}.`);
console.log(`Findings: ${a.findings.before} as found${opts.fix ? `, ${a.findings.after} if fixed; ${a.findings.fixed} fixable without a model (${Math.round((a.fixedWithoutModel?.share ?? 0) * 100)}%)` : ''}.`);
if (a.byRule.length) {
  console.log('\nBy rule (findings as found' + (opts.fix ? ' -> if fixed' : '') + ', pages):');
  for (const r of a.byRule) console.log(`  ${r.rule.padEnd(28)} ${String(r.findings.before).padStart(3)}${opts.fix ? ` -> ${String(r.findings.after).padStart(3)}` : ''}  on ${plural(r.pages.before, 'page')}${r.wcag.length ? `  WCAG ${r.wcag.join(', ')}` : ''}`);
}
console.log(`\nNot checked: ${report.notChecked.note}`);
if (output) console.log(`\nWrote ${under(output, process.cwd()) ?? output}`);
process.exit(passed ? 0 : 1);
