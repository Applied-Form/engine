#!/usr/bin/env node
/**
 * Aggregate compliance across teams and targets, append to history, and print a report.
 *
 *   node scripts/report.mjs <run.json> [more.json ...]
 *
 * Each run.json is produced by `node scripts/lint-page.mjs --json` — { pages: [...] } —
 * optionally carrying `team` and `target` keys at the top level. Missing team defaults to
 * "unassigned"; missing target defaults to the file's basename.
 *
 * --json          print the summary object instead of markdown
 * --history <path> override the history file (default dist/compliance-history.json)
 * --stamp <iso>    stamp this run with a given ISO timestamp (default: now)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summarise, compare, toMarkdown } from '../src/lib/report.mjs';

// `af report --tokens <css|html ...>` — which of this system's tokens a codebase actually
// references, and which it never has.
//
// The research report scored analytics at zero and it was right: a design system with no idea
// which teams use which tokens cannot tell adoption from installation. This is the cheap half of
// that, and it is the half that matters — a token nobody references is either badly named, badly
// documented, or unnecessary, and all three are worth knowing before the next release adds more.
if (process.argv.includes('--tokens')) {
  const { readFileSync } = await import('node:fs');
  const { colors, spacingScale, fonts } = await import('../src/lib/tokens.mjs');
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('usage: af report --tokens <file ...>'); process.exit(2); }

  const names = [
    ...Object.keys(colors).map((k) => `--af-color-${k}`),
    ...spacingScale.map((_, i) => `--af-space-${String(i + 1).padStart(2, '0')}`),
    ...Object.keys(fonts).map((k) => `--af-font-${k}`),
  ];
  const counts = Object.fromEntries(names.map((n) => [n, 0]));
  let literals = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const n of names) counts[n] += (src.match(new RegExp(`var\\(${n}\\b`, 'g')) ?? []).length;
    // A hard-coded colour beside a token that means the same thing is what drift looks like.
    literals += (src.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length;
  }
  const used = Object.entries(counts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  const unused = Object.entries(counts).filter(([, c]) => c === 0).map(([n]) => n);
  console.log(`\n${files.length} file(s) · ${used.length} of ${names.length} tokens referenced · ${literals} hard-coded hex value(s)\n`);
  for (const [n, c] of used.slice(0, 20)) console.log(`  ${String(c).padStart(4)}  ${n}`);
  if (used.length > 20) console.log(`  … and ${used.length - 20} more`);
  if (unused.length) console.log(`\nNever referenced (${unused.length}): ${unused.join(', ')}`);
  if (literals) console.log(`\n${literals} hard-coded hex value(s). Every one is a token that was not reached for.`);
  process.exit(0);
}


const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function parseArgs(argv) {
  const files = [];
  let json = false;
  let history = `${ROOT}dist/compliance-history.json`;
  let stamp = new Date().toISOString();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--history') history = argv[++i];
    else if (a === '--stamp') stamp = argv[++i];
    else files.push(a);
  }
  return { files, json, history, stamp };
}

export function loadRuns(files) {
  return files.map((f) => {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    return {
      team: data.team ?? 'unassigned',
      target: data.target ?? basename(f),
      pages: data.pages ?? [],
    };
  });
}

export function loadHistory(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}

export function run({ files, json, history, stamp }) {
  if (files.length === 0) {
    throw new Error('usage: node scripts/report.mjs <run.json> [more.json ...] [--json] [--history <path>] [--stamp <iso>]');
  }
  const runs = loadRuns(files);
  const summary = summarise(runs);
  const historyEntries = loadHistory(history);
  const previousEntry = historyEntries.length ? historyEntries[historyEntries.length - 1] : null;
  const comparison = compare(summary, previousEntry ? { totals: previousEntry.totals, byRule: previousEntry.byRule ?? [], byTeam: previousEntry.byTeam } : null);

  historyEntries.push({ stamp, totals: summary.totals, byTeam: summary.byTeam, byRule: summary.byRule });
  mkdirSync(new URL('.', pathToFileURL(history)), { recursive: true });
  writeFileSync(history, JSON.stringify(historyEntries, null, 2) + '\n');

  const output = json ? JSON.stringify(summary, null, 2) : toMarkdown(summary, comparison);
  return { summary, comparison, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const { output } = run(opts);
    console.log(output);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
