/**
 * resolveFile (decision 0029): a renamed file is found under its new name first, then under the old
 * one with one line on stderr. The rules are in src/lib/resolve-file.mjs; the commands that use it
 * are tested in test/config-files.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFile } from '../src/lib/resolve-file.mjs';
import { CONFIG, deprecated } from '../src/lib/names.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'standards-resolve-'));
const touch = (dir, name) => writeFileSync(join(dir, name), '{}\n');
const resolveWith = (dir) => {
  const notes = [];
  const found = resolveFile(dir, CONFIG.name, CONFIG.legacy, { note: (line) => notes.push(line) });
  return { found, notes };
};

test('only the new file: it is read, silently', () => {
  const dir = scratch();
  touch(dir, CONFIG.name);
  const { found, notes } = resolveWith(dir);
  assert.deepEqual(found, { path: join(dir, CONFIG.name), exists: true, legacy: false });
  assert.deepEqual(notes, []);
});

test('only the old file: it is read and written at its own path, with one line', () => {
  const dir = scratch();
  touch(dir, CONFIG.legacy);
  const { found, notes } = resolveWith(dir);
  assert.deepEqual(found, { path: join(dir, CONFIG.legacy), exists: true, legacy: true });
  assert.equal(notes.length, 1);
  assert.ok(notes[0].startsWith(deprecated(CONFIG.legacy, CONFIG.name)), notes[0]);
  assert.doesNotMatch(notes[0], /\n|warning/i);
});

test('both files: the new one is used, the old one is named as ignored, and nothing is merged', () => {
  const dir = scratch();
  touch(dir, CONFIG.name);
  touch(dir, CONFIG.legacy);
  const { found, notes } = resolveWith(dir);
  assert.deepEqual(found, { path: join(dir, CONFIG.name), exists: true, legacy: false });
  assert.equal(notes.length, 1);
  assert.ok(notes[0].startsWith(deprecated(CONFIG.legacy, CONFIG.name)), notes[0]);
  assert.ok(notes[0].includes(`${CONFIG.legacy} is ignored`), notes[0]);
});

test('neither file: the new name, for a caller that writes', () => {
  const dir = scratch();
  const { found, notes } = resolveWith(dir);
  assert.deepEqual(found, { path: join(dir, CONFIG.name), exists: false, legacy: false });
  assert.deepEqual(notes, []);
});

test('a file is announced once per process, and is still found the second time', () => {
  const dir = scratch();
  touch(dir, CONFIG.legacy);
  const first = resolveWith(dir);
  const second = resolveWith(dir);
  assert.equal(first.notes.length, 1);
  assert.deepEqual(second.notes, []);
  assert.equal(second.found.path, join(dir, CONFIG.legacy));
});
