/**
 * `--system`, resolved to what AF_BRAND takes: a path to a token overlay, or a brand name. A
 * Standards pack (a pack tokens.json, or a bundled pack by key) is imported first, by the path
 * `af system import` takes, in a child process, because the tokens are read once per process and
 * the caller has not read them yet. The caller sets AF_BRAND to `brand` before it imports anything
 * that reads the tokens.
 *
 * Throws with a message a person can act on; the command decides how to exit.
 */
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ENGINE = fileURLToPath(new URL('../../', import.meta.url));
const HINT = 'Give a token overlay, a Standards pack tokens.json, a bundled pack (instrument) or a brand name.';

export function resolveSystem(given) {
  const isPack = (j) => /token-contract/.test(String(j?.$schema ?? '')) || (j?.colour && j?.system_values);
  const asFile = resolve(given);
  let pack = null, key = null;
  if (given.endsWith('.json')) {
    if (!existsSync(asFile)) throw new Error(`--system: no such file ${given}`);
    let parsed;
    try { parsed = JSON.parse(readFileSync(asFile, 'utf8')); } catch (e) { throw new Error(`--system: ${given} is not JSON (${e.message})`); }
    if (!isPack(parsed)) return { brand: asFile, label: given };
    pack = asFile;
  } else if (/^[a-z0-9-]+$/i.test(given) && existsSync(join(ENGINE, 'packs', `${given}.tokens.json`))) {
    pack = join(ENGINE, 'packs', `${given}.tokens.json`); key = given;
  } else if (/^[a-z0-9-]+$/i.test(given)) {
    // A brand name: the token loader finds it, or loading fails and the command says so.
    return { brand: given, label: given };
  } else {
    throw new Error(`--system: no system named ${given}. ${HINT}`);
  }
  const out = join(mkdtempSync(join(tmpdir(), 'af-system-')), 'system.json');
  const env = { ...process.env }; delete env.AF_BRAND;
  const r = spawnSync(process.execPath, [join(ENGINE, 'scripts', 'system.mjs'), 'import', pack, '--out', out, ...(key ? ['--key', key] : [])], { encoding: 'utf8', env });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`--system: the pack at ${given} was refused\n${(r.stdout + r.stderr).trim()}`);
  return { brand: out, label: given };
}

export const SYSTEM_HINT = HINT;
