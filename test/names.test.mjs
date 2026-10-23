import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as names from '../src/lib/names.mjs';
import { TOOLS } from '../src/lib/mcp.mjs';

// This file spells the old names on purpose. It is the one place that checks the names module against an
// independent copy of what it replaces, so deriving them from the module would make each assertion
// compare the module with itself. A search for the old names that includes test/ lists this file (and
// test/compat.test.mjs) as exempt: the stage 6 and stage 9 greps say so.

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

test('deprecated() is one line that names the old name, the new name and the removal release', () => {
  const line = names.deprecated('af', 'standards');
  assert.equal(line, 'af is deprecated: use standards. af will be removed in Standards 5.0.0.');
  assert.ok(!/[\r\n]/.test(line), 'one line: the caller writes the newline');
  assert.ok(line.includes('af') && line.includes('standards') && line.includes(names.REMOVE_IN));
  // test/af-audit.test.mjs counts lines that say "warning" on stderr, and stdout carries JSON and the
  // MCP protocol, so the text has to stay clear of that word.
  assert.doesNotMatch(line, /warning/i);
  assert.doesNotMatch(names.deprecated('AF_BRAND', 'STANDARDS_SYSTEM'), /warning/i);
});

test('the tool map covers exactly the tool names the MCP server lists', () => {
  // The server lists the map's values; the legacy profile lists its keys (test/mcp.test.mjs).
  const listed = TOOLS.map((t) => t.name).sort();
  const old = Object.keys(names.TOOL_MAP).sort();
  const current = Object.values(names.TOOL_MAP).sort();
  assert.equal(old.length, 9);
  assert.deepEqual(listed, current);
  for (const [from, to] of Object.entries(names.TOOL_MAP)) {
    assert.equal(to, from.replace(/^af_/, 'standards_'), `${from} maps to the same verb under the new prefix`);
  }
});

test('the env map names the two variables a user can set, new name to old', () => {
  assert.deepEqual(names.ENV, { STANDARDS_SYSTEM: 'AF_BRAND', STANDARDS_CHROMIUM: 'AF_CHROMIUM' });
});

test('the one internal variable the product sets for its own children is held here, and is not one a user can set', () => {
  assert.equal(names.NOTED, 'STANDARDS_NOTED');
  assert.ok(!Object.keys(names.ENV).includes(names.NOTED));
});

test('the report generator and its legacy values are distinct', () => {
  assert.equal(names.GENERATOR, 'standards audit');
  assert.deepEqual([...names.LEGACY_GENERATORS].sort(), ['af audit', 'af report']);
  assert.ok(!names.LEGACY_GENERATORS.includes(names.GENERATOR));
});

test('every renamed file and directory carries the legacy name it replaces', () => {
  assert.deepEqual(names.CONFIG, { name: 'standards.config.json', legacy: 'af.config.json' });
  assert.deepEqual(names.BASELINE, { name: 'standards-baseline.json', legacy: 'af-baseline.json' });
  assert.deepEqual(names.DIR, { name: '.standards', legacy: '.af' });
});

test('the package major is below the major the old names are removed in', () => {
  // The mechanism that makes the promise real, as for tokens (test/tooling.test.mjs): this fails at
  // 5.0.0, so the shims cannot outlive the release that said they would go.
  const major = Number(pkg.version.split('.')[0]);
  const removeMajor = Number(names.REMOVE_IN.split('.')[0]);
  assert.ok(major < removeMajor, `the old names were to be removed in ${names.REMOVE_IN} and this is ${pkg.version}`);
});
