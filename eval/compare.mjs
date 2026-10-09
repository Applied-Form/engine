#!/usr/bin/env node
/**
 * The gate beside instruments we did not write, on the same pages.
 *
 * Every number this repository has produced about itself came from measuring its own pages with
 * its own linter. The research brief asked for comparisons made by running, not by reading, and
 * this is that: two third-party instruments nobody here can tune, run on the same page as
 * `af lint`, with the three results printed side by side.
 *
 *   axe-core   an accessibility engine, injected into the rendered page.
 *   stylelint  a static linter over the page's own stylesheets, running the config this repository
 *              generates from its tokens (`dist/stylelint.config.cjs`) — the cheap tier the README
 *              describes, exercised here for the first time against anything.
 *
 * The questions are narrow and worth stating exactly. axe tests accessibility; the gate tests
 * conformance to a design system, of which a bounded slice is accessibility, so axe should find a
 * subset. stylelint sees the literal values an author typed and nothing the browser computed, so it
 * should catch a hex in a `<style>` block and miss a font inside a shadow root, an inherited
 * colour, a composited ground, a reflow. The thing to read is how much of a planted defect set
 * each instrument sees at all. None of them answers whether a page is well designed.
 *
 *     node eval/compare.mjs test/fixtures/violations.html test/fixtures/attacks.html
 *     node eval/compare.mjs --json page.html
 *
 * `test/compare.test.mjs` holds the fixture results so the claims quoted from them cannot rot
 * silently.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { lintPages, launchBrowser } from '../src/lib/page-lint.mjs';
import { axeScan } from './score.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The CSS a static linter can see: every `<style>` block, and every linked stylesheet that resolves
 * to a local file and was authored rather than generated. A stylesheet on another host is not
 * fetched; a static tier runs before deploy, on what is in the repository, and that is the point
 * being measured.
 *
 * Generated output under `dist/` is excluded, and the reason is itself a finding. `dist/tokens.css`
 * is where every token is *defined*, as a literal, so the first time the generated config was run
 * against a page that linked it, it reported 138 hex colours on a page the gate finds clean: the
 * token definitions, every one. The cheap tier is for the CSS a person writes against the tokens,
 * never for the file that defines them, and `build-stylelint.mjs` now says so in the config.
 */
export function authoredCss(url) {
  if (!url.startsWith('file:')) return { code: '', sources: 0 };
  const path = fileURLToPath(url);
  const html = readFileSync(path, 'utf8');
  const parts = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) parts.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (/^https?:/.test(href) || /(^|\/)dist\//.test(href)) continue;
    try { parts.push(readFileSync(resolve(dirname(path), href), 'utf8')); } catch { /* a missing sheet is nothing to lint */ }
  }
  return { code: parts.join('\n'), sources: parts.length };
}

/** stylelint with the generated config. Returns counts per rule, like the gate's. */
export async function stylelintScan(url) {
  const { default: stylelint } = await import('stylelint');
  const config = createRequire(import.meta.url)('../dist/stylelint.config.cjs');
  const { code, sources } = authoredCss(url);
  if (!sources) return { count: 0, rules: {}, sources };
  const out = await stylelint.lint({ code, config, configBasedir: ROOT });
  const rules = {};
  for (const w of out.results.flatMap((r) => r.warnings)) rules[w.rule] = (rules[w.rule] ?? 0) + 1;
  return { count: Object.values(rules).reduce((a, b) => a + b, 0), rules, sources };
}

/** All three instruments on one page. Returns the per-rule counts of each. */
export async function compare(url, browser, { viewports = [320, 1280] } = {}) {
  const [{ violations }] = await lintPages([url], { viewports, browser });
  const gate = {};
  for (const v of violations) gate[v.rule] = (gate[v.rule] ?? 0) + 1;
  const axe = await axeScan(url, browser);
  const stylelint = await stylelintScan(url);
  return {
    url,
    gate: { count: violations.length, rules: gate },
    axe: { count: axe.count, serious: axe.serious, rules: Object.fromEntries(axe.violations.map((v) => [v.id, { impact: v.impact, nodes: v.nodes }])) },
    stylelint,
  };
}

const list = (rules) => Object.entries(rules).map(([id, n]) => `${id}×${typeof n === 'number' ? n : n.nodes}`).join(', ') || '—';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const pages = args.filter((a) => !a.startsWith('--'));
  if (!pages.length) {
    console.error('usage: node eval/compare.mjs [--json] page.html [...]');
    process.exit(2);
  }
  const browser = await launchBrowser();
  const results = [];
  try {
    for (const p of pages) {
      const url = /^https?:/.test(p) ? p : pathToFileURL(resolve(p)).href;
      const r = await compare(url, browser);
      results.push(r);
      if (!json) {
        console.log(`\n${p}`);
        console.log(`  af lint    ${r.gate.count} violations, ${Object.keys(r.gate.rules).length} rules: ${list(r.gate.rules)}`);
        console.log(`  axe-core   ${r.axe.count} violations, ${Object.keys(r.axe.rules).length} rules (${r.axe.serious} serious or critical): ${list(r.axe.rules)}`);
        console.log(`  stylelint  ${r.stylelint.count} warnings, ${Object.keys(r.stylelint.rules).length} rules, over ${r.stylelint.sources} authored stylesheet(s): ${list(r.stylelint.rules)}`);
      }
    }
  } finally { await browser.close(); }
  if (json) console.log(JSON.stringify(results, null, 2));
}
