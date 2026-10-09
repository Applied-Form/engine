import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RULES, RULE_IDS, GROUPS, SEVERITIES } from '../src/lib/rules/registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesDir = path.join(here, '..', 'src', 'lib');

/** Every `.mjs` file under src/lib whose name is `rules.mjs` or lives under `rules/`. */
function ruleSourceFiles() {
  const files = [path.join(rulesDir, 'rules.mjs')];
  const dir = path.join(rulesDir, 'rules');
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.mjs')) files.push(path.join(dir, name));
  }
  return files;
}

/** Every rule id actually emitted by the source, via add('<id>' or rule: '<id>'. */
function emittedIds() {
  const ids = new Set();
  for (const file of ruleSourceFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\badd\(\s*'([a-z0-9-]+)'/g)) ids.add(m[1]);
    for (const m of src.matchAll(/rule:\s*'([a-z0-9-]+)'/g)) ids.add(m[1]);
  }
  return ids;
}

test('every emitted rule id appears in the registry', () => {
  const emitted = emittedIds();
  const missing = [...emitted].filter((id) => !RULE_IDS.has(id));
  assert.deepEqual(missing, [], `rule ids emitted by source but missing from the registry: ${missing.join(', ')}`);
});

test('every registry id is actually emitted somewhere in the source', () => {
  const emitted = emittedIds();
  const extra = [...RULE_IDS].filter((id) => !emitted.has(id));
  assert.deepEqual(extra, [], `registry ids never emitted by any rule module: ${extra.join(', ')}`);
});

test('the registry and the source agree on the exact set of ids', () => {
  const emitted = emittedIds();
  assert.equal(RULE_IDS.size, emitted.size);
});

test('every entry has a non-empty summary and why, a valid group, and a valid severity', () => {
  const groups = new Set(GROUPS);
  const severities = new Set(SEVERITIES);
  for (const r of RULES) {
    assert.equal(typeof r.summary, 'string', `${r.id}: summary must be a string`);
    assert.ok(r.summary.trim().length > 0, `${r.id}: summary must not be empty`);
    assert.equal(typeof r.why, 'string', `${r.id}: why must be a string`);
    assert.ok(r.why.trim().length > 0, `${r.id}: why must not be empty`);
    assert.ok(groups.has(r.group), `${r.id}: group "${r.group}" is not one of ${GROUPS.join(', ')}`);
    assert.ok(severities.has(r.severity), `${r.id}: severity "${r.severity}" is not one of ${SEVERITIES.join(', ')}`);
    assert.ok(Array.isArray(r.wcag), `${r.id}: wcag must be an array`);
  }
});

test('no duplicate ids in the registry', () => {
  assert.equal(RULES.length, RULE_IDS.size);
});
