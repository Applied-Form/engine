/**
 * Find a file that was renamed (decision 0029): `resolveFile(dir, newName, oldName)`.
 *
 *   only the new file: it is used, silently
 *   only the old file: it is used, at its own path (so a write goes back to it), with one line
 *   both:              the new file is used and the line says the old one is ignored; never merged
 *   neither:           the new path, for a caller that writes
 *
 * An explicit path a person typed is not resolved: the caller uses it as given, with no fallback.
 *
 * The line goes to stderr, once per process for a given file, and once between a command and the
 * script it runs: the process that announces a file records it in the environment the child
 * inherits.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deprecated, NOTED } from './names.mjs';

const toStderr = (line) => process.stderr.write(`${line}\n`);

const announce = (key, line, note) => {
  let seen = [];
  try { seen = JSON.parse(process.env[NOTED] ?? '[]'); } catch { /* an unreadable record means nothing was noted */ }
  if (seen.includes(key)) return;
  process.env[NOTED] = JSON.stringify([...seen, key]);
  note(line);
};

export function resolveFile(dir, newName, oldName, { note = toStderr } = {}) {
  const current = join(dir, newName);
  const old = join(dir, oldName);
  const hasCurrent = existsSync(current);
  if (!existsSync(old)) return { path: current, exists: hasCurrent, legacy: false };
  if (!hasCurrent) {
    announce(resolve(old), deprecated(oldName, newName), note);
    return { path: old, exists: true, legacy: true };
  }
  announce(`${resolve(old)} (ignored)`, `${deprecated(oldName, newName)} ${newName} exists, so ${oldName} is ignored.`, note);
  return { path: current, exists: true, legacy: false };
}
