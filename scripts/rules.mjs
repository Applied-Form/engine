#!/usr/bin/env node
/**
 * List the rules `lint()` and `advise()` can emit, without reading the source.
 *
 *   node scripts/rules.mjs              readable table, grouped by group
 *   node scripts/rules.mjs --json       the registry as JSON
 *   node scripts/rules.mjs --wcag       only rules with a WCAG 2.2 mapping, grouped by SC
 */
import { pathToFileURL } from 'node:url';
import { RULES, GROUPS } from '../src/lib/rules/registry.mjs';

// `af rules --deprecated` lists what is on its way out, with the replacement and the release it
// goes in. A deprecation nobody can see is a removal with extra steps.
if (process.argv.includes('--deprecated')) {
  const { deprecations, version } = await import('../src/lib/tokens.mjs');
  const rows = deprecations();
  if (!rows.length) console.log(`Nothing is deprecated in ${version}.`);
  for (const d of rows) {
    console.log(`${d.path}\n  replaced by  ${d.replacement ?? '(none named — this is a bug in the token file)'}\n  deprecated   ${d.since ?? '?'}\n  removed in   ${d.removeIn ?? '?'}`);
  }
  process.exit(0);
}


function printTable() {
  for (const group of GROUPS) {
    const rules = RULES.filter((r) => r.group === group);
    if (!rules.length) continue;
    console.log(`\n${group}`);
    for (const r of rules) {
      console.log(`  ${r.id.padEnd(28)} ${r.severity.padEnd(9)} ${r.summary}`);
    }
  }
}

function printWcag() {
  const bySc = new Map();
  for (const r of RULES) {
    for (const sc of r.wcag) {
      if (!bySc.has(sc)) bySc.set(sc, []);
      bySc.get(sc).push(r);
    }
  }
  const scs = [...bySc.keys()].sort();
  if (!scs.length) {
    console.log('No rules carry a WCAG mapping.');
    return;
  }
  for (const sc of scs) {
    console.log(`\n${sc}`);
    for (const r of bySc.get(sc)) {
      console.log(`  ${r.id.padEnd(28)} ${r.summary}`);
    }
  }
}

export { printTable, printWcag };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = process.argv.includes('--json');
  const wcag = process.argv.includes('--wcag');

  if (json) console.log(JSON.stringify(RULES, null, 2));
  else if (wcag) printWcag();
  else printTable();
}
