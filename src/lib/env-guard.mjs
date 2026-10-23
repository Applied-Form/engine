/**
 * For a process that is the entry point, never for a program that imports the library. The library
 * throws when the old and the new name of a variable are both set to different values (src/lib/env.mjs),
 * so that a host can catch it. A bin or a script run directly imports this file first, and a conflict
 * that nothing else caught, wherever it was read (a call, or where the tokens load), is reported as
 * `standards: <message>` on stderr and the process exits 2, as for any other usage error.
 *
 * It looks only at that error: anything else still ends the process as it would have.
 */
import { CONFLICT } from './env.mjs';

/** Report a conflict and exit 2. Any other error is rethrown. For an entry point that reads the variable itself and catches. */
export function exitOnConflict(e) {
  if (e?.code !== CONFLICT) throw e;
  console.error(`standards: ${e.message}`);
  process.exit(2);
}

process.on('uncaughtExceptionMonitor', (e) => { if (e?.code === CONFLICT) exitOnConflict(e); });
