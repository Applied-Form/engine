#!/usr/bin/env node
// `af-mcp` is the old name of `standards mcp`, kept for one major version. It says so once, then
// serves as before.
import '../src/lib/env-guard.mjs'; // first: a name conflict exits 2 (src/lib/env-guard.mjs)
import { deprecated } from '../src/lib/names.mjs';

process.stderr.write(`${deprecated('af-mcp', 'standards mcp')}\n`);
// Its clients were configured with the old tool names, so the server lists those.
process.argv.push('--legacy-tool-names');
await import('../scripts/mcp.mjs');
