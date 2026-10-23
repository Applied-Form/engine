/**
 * The environment variables a person can set (decision 0029): `STANDARDS_SYSTEM`, which names the
 * system a command judges against, and `STANDARDS_CHROMIUM`, which names a Chromium executable. Each
 * replaces an older name that still works for one major version (`ENV` in names.mjs holds both).
 *
 * Every read looks at the environment as it is at that moment and nothing is copied when this file is
 * imported. The tokens are read once per process, and a caller may set the variable after it has
 * imported this file and before it imports them (src/lib/system-arg.mjs, eval/builders-report.mjs); a
 * copy taken at import would miss that write and judge against the house system.
 *
 * Reading never writes to the environment. A value that is defined but empty is a value.
 */
import { ENV, deprecated } from './names.mjs';

const SYSTEM = 'STANDARDS_SYSTEM';
const CHROMIUM = 'STANDARDS_CHROMIUM';

const said = new Set();

/** The new name's value if it is defined, else the old name's (with one line, once per process). Both defined and different throws. */
function resolvePair(current, env) {
  const old = ENV[current];
  const [now, then] = [env[current], env[old]];
  if (now !== undefined && then !== undefined && now !== then) {
    throw Object.assign(new Error(`${old} and ${current} are both set, to different values. Set ${current} only: ${old} is deprecated.`), { code: CONFLICT });
  }
  if (now !== undefined) return now;
  if (then === undefined) return undefined;
  if (!said.has(old)) { said.add(old); process.stderr.write(`${deprecated(old, current)}\n`); }
  return then;
}

/**
 * A conflict is an error with this `code`. It is thrown and never acted on here, so a program that
 * imports the library can catch it and carry on. A process that is the entry point turns it into
 * `standards: <message>` and exit 2 (src/lib/env-guard.mjs).
 */
export const CONFLICT = 'STANDARDS_ENV_CONFLICT';

/** The system to judge against, or undefined when neither name is set. Both set and different: throws. */
export const systemFromEnv = (env = process.env) => resolvePair(SYSTEM, env);

/** The Chromium executable, or undefined when neither name is set. Both set and different: throws. */
export const chromiumFromEnv = (env = process.env) => resolvePair(CHROMIUM, env);

/**
 * Choose the system for this process. It goes under the new name and the old one is removed, so an
 * inherited old value can never conflict with a value this process chose (for example from `--system`).
 */
export function setSystem(value) {
  process.env[SYSTEM] = value;
  delete process.env[ENV[SYSTEM]];
}

/**
 * The environment for a child process: this one's, with both names of each pair removed and the
 * resolved values set under the new names, so the child never repeats the line for an old name.
 * `extra` is applied last; a key given as undefined is removed.
 */
export function childEnv(extra = {}) {
  const system = systemFromEnv();
  const chromium = chromiumFromEnv();
  const env = { ...process.env };
  for (const current of [SYSTEM, CHROMIUM]) { delete env[current]; delete env[ENV[current]]; }
  if (system !== undefined) env[SYSTEM] = system;
  if (chromium !== undefined) env[CHROMIUM] = chromium;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key]; else env[key] = value;
  }
  return env;
}
