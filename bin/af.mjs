#!/usr/bin/env node
/**
 * af: one command for the system.
 *
 *   af lint <page.html|url> [...] [--register i|ii] lint pages in Chromium (four viewports, reduced motion, print)
 *   af fix <page.html|url> [--out f]  apply the fixes the engine can make on its own, and say what is left
 *   af baseline <page|url> [--out f]  record the current violations as the baseline, so adoption can start
 *   af rules [--json|--wcag]           what every rule requires, and which WCAG criteria it touches
 *   af audit <pages… | dir> [--fix]    lint (and fix) a set of pages and write one self-contained report
 *   af report <run.json> [...]         aggregate lint runs by team, with a trend against the last report
 *   af form <data.csv> [--out x.svg]   a generative Form from a dataset
 *   af mark issue --key k --dataset d  freeze a mark and commit the record of what made it
 *   af move <name> [--content f.json]  a spread scaffold from its recipe
 *   af build                           tokens.css, components.css, mark, exports, generated pages
 *   af site                            assemble site/
 *   af pdf <page.html> [out.pdf]       print with the page tokens
 *   af golden                          rewrite the golden spec snapshots
 *   af figma-diff <export.json>        compare a Figma variables export with the token file
 *   af brand --hue 210 --paper "#F4F7FA"  derive a brand palette that satisfies every floor, or refuse
 *   af drift <page.html> [...]         what a site's design system actually is, and how far it has drifted
 *   af check                           build, unit tests, page lint
 *   af init --pack <tokens.json|instrument>  import a Standards pack and name it in af.config.json
 *   af init --from-site <page.html|url> [...]  propose a pack from a rendered site; written once a person confirms it
 *   af mcp-config [--client claude-code|cursor]  the MCP server block for an agent's config
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
// This is the last @appliedform/engine release. The notice goes to stderr, which --json output and the MCP
// protocol do not use; `af mcp` leaves it to the server it starts, so that command prints it once.
if (cmd !== 'mcp') console.error('@appliedform/engine is deprecated and gets no further releases: uninstall it, then install @appliedform/standards.');
// The system `af init` named in af.config.json is the one every command here judges against, unless
// AF_BRAND already says otherwise.
if (!process.env.AF_BRAND && existsSync('af.config.json')) {
  try {
    const { system } = JSON.parse(readFileSync('af.config.json', 'utf8'));
    if (system) process.env.AF_BRAND = resolvePath(process.cwd(), system);
  } catch { /* a malformed file is reported by the command that reads it */ }
}
// The open distribution carries the engine and not the system's identity tooling (decision 0023),
// so a command whose script is absent says so rather than failing with a module error.
const run = (script, args = []) => {
  if (!existsSync(`${ROOT}scripts/${script}`)) { console.error(`af ${cmd}: not part of this distribution`); process.exit(2); }
  const r = spawnSync(process.execPath, [`${ROOT}scripts/${script}`, ...args], { stdio: 'inherit', cwd: process.cwd() }); process.exit(r.status ?? 1);
};
const npm = (script) => {
  const { scripts = {} } = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
  if (!scripts[script]) { console.error(`af ${cmd}: not part of this distribution`); process.exit(2); }
  // The installed package carries the engine, not the suite: that runs from a clone of the repository.
  if (script === 'check' && !existsSync(`${ROOT}test`)) { console.error('af check: the test suite ships with the repository, not the package; run it from a clone'); process.exit(2); }
  // npm runs in the package root, so an overlay path the caller gave relative to where they are
  // is resolved here, before the directory changes under it.
  const env = { ...process.env };
  if (env.AF_BRAND?.endsWith('.json')) env.AF_BRAND = resolvePath(process.cwd(), env.AF_BRAND);
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
  // `af mark issue` reads as a sentence; the subcommand is dropped before the script sees it.
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
    console.error(`usage: af <init|lint|fix|baseline|rules|report|audit|form|mark|move|build|site|pdf|golden|figma-diff|brand|check|system|mcp|mcp-config|drift> ...`);
    process.exit(cmd ? 2 : 0);
}
