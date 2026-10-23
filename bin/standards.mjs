#!/usr/bin/env node
/**
 * standards: one command for the system.
 *
 *   standards lint <page.html|url> [...] [--register i|ii] lint pages in Chromium (four viewports, reduced motion, print)
 *   standards fix <page.html|url> [--out f]  apply the fixes Standards can make on its own, and say what is left
 *   standards baseline <page|url> [--out f]  record the current violations as the baseline, so adoption can start
 *   standards rules [--json|--wcag]           what every rule requires, and which WCAG criteria it touches
 *   standards audit <pages… | dir> [--fix]    lint (and fix) a set of pages and write one self-contained report
 *   standards report <run.json> [...]         aggregate lint runs by team, with a trend against the last report
 *   standards form <data.csv> [--out x.svg]   a generative Form from a dataset
 *   standards mark issue --key k --dataset d  freeze a mark and commit the record of what made it
 *   standards move <name> [--content f.json]  a spread scaffold from its recipe
 *   standards build                           tokens.css, components.css, mark, exports, generated pages
 *   standards site                            assemble site/
 *   standards pdf <page.html> [out.pdf]       print with the page tokens
 *   standards golden                          rewrite the golden spec snapshots
 *   standards figma-diff <export.json>        compare a Figma variables export with the token file
 *   standards brand --hue 210 --paper "#F4F7FA"  derive a brand palette that satisfies every floor, or refuse
 *   standards drift <page.html> [...]         what a site's design system actually is, and how far it has drifted
 *   standards check                           build, unit tests, page lint
 *   standards init --pack <tokens.json|instrument>  import a Standards pack and name it in standards.config.json
 *   standards init --from-site <page.html|url> [...]  propose a pack from a rendered site; written once a person confirms it
 *   standards mcp-config [--client claude-code|cursor]  the MCP server block for an agent's config
 */
import { exitOnConflict } from '../src/lib/env-guard.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { CONFIG } from '../src/lib/names.mjs';
import { resolveFile } from '../src/lib/resolve-file.mjs';
import { systemFromEnv, chromiumFromEnv, setSystem, childEnv } from '../src/lib/env.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
// Either name of a variable is read here, once, and the scripts this runs get the resolved values
// under the new names (childEnv), so a deprecation line is printed here and not again. Both names set
// to different values is a usage error: the library throws, and this reports it and exits 2.
let given;
try { given = systemFromEnv(); chromiumFromEnv(); } catch (e) { exitOnConflict(e); }
// The system `standards init` named in standards.config.json is the one every command here judges
// against, unless the caller's environment already says otherwise. A config under the old name is
// read too, with one line, which the script this runs then does not repeat (resolveFile).
const config = given === undefined ? resolveFile(process.cwd(), CONFIG.name, CONFIG.legacy) : null;
if (config?.exists) {
  try {
    const { system } = JSON.parse(readFileSync(config.path, 'utf8'));
    if (system) setSystem(resolvePath(process.cwd(), system));
  } catch { /* a malformed file is reported by the command that reads it */ }
}
// The open distribution carries the engine and not the system's identity tooling (decision 0023),
// so a command whose script is absent says so rather than failing with a module error.
const run = (script, args = []) => {
  if (!existsSync(`${ROOT}scripts/${script}`)) { console.error(`standards ${cmd}: not part of this distribution`); process.exit(2); }
  const r = spawnSync(process.execPath, [`${ROOT}scripts/${script}`, ...args], { stdio: 'inherit', cwd: process.cwd(), env: childEnv() }); process.exit(r.status ?? 1);
};
const npm = (script) => {
  const { scripts = {} } = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
  if (!scripts[script]) { console.error(`standards ${cmd}: not part of this distribution`); process.exit(2); }
  // The installed package carries the engine, not the suite: that runs from a clone of the repository.
  if (script === 'check' && !existsSync(`${ROOT}test`)) { console.error('standards check: the test suite ships with the repository, not the package; run it from a clone'); process.exit(2); }
  // npm runs in the package root, so an overlay path the caller gave relative to where they are
  // is resolved here, before the directory changes under it.
  const env = childEnv();
  if (env.STANDARDS_SYSTEM?.endsWith('.json')) env.STANDARDS_SYSTEM = resolvePath(process.cwd(), env.STANDARDS_SYSTEM);
  const r = spawnSync('npm', ['run', script], { stdio: 'inherit', cwd: ROOT, env }); process.exit(r.status ?? 1);
};

switch (cmd) {
  case 'lint': run('lint-page.mjs', rest); break;
  case 'fix': run('fix-page.mjs', rest); break;
  case 'baseline': run('lint-page.mjs', [...rest, '--baseline-write']); break;
  case 'rules': run('rules.mjs', rest); break;
  case 'report': run('report.mjs', rest); break;
  case 'audit': run('audit-pages.mjs', rest); break;
  case 'form': run('form-from-data.mjs', rest); break;
  // `standards mark issue` reads as a sentence; the subcommand is dropped before the script sees it.
  case 'mark': run('issue-mark.mjs', rest[0] === 'issue' ? rest.slice(1) : rest); break;
  case 'move': run('move.mjs', rest); break;
  case 'pdf': run('export-pdf.mjs', rest); break;
  case 'golden': run('golden.mjs', rest); break;
  case 'figma-diff': run('figma-diff.mjs', rest); break;
  case 'brand': run('brand.mjs', rest); break;
  case 'system': run('system.mjs', rest); break;
  case 'drift': run('drift.mjs', rest); break;
  case 'mcp': run('mcp.mjs', rest); break;
  case 'init': run(rest.some((a) => /^--from-(site|survey|tailwind)$/.test(a)) ? 'init-from-site.mjs' : 'init.mjs', rest); break;
  case 'mcp-config': run('mcp-config.mjs', rest); break;
  case 'build': npm('build'); break;
  case 'site': npm('build:site'); break;
  case 'check': npm('check'); break;
  default:
    console.error(`usage: standards <init|lint|fix|baseline|rules|report|audit|form|mark|move|build|site|pdf|golden|figma-diff|brand|check|system|mcp|mcp-config|drift> ...`);
    process.exit(cmd ? 2 : 0);
}
