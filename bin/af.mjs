#!/usr/bin/env node
// `af` is the old name of `standards`, kept for one major version. It says so once, then runs the
// same command. A separate file, because node resolves a bin symlink and so argv[1] cannot tell the
// two names apart.
import '../src/lib/env-guard.mjs'; // first: a name conflict exits 2 (src/lib/env-guard.mjs)
import { deprecated } from '../src/lib/names.mjs';

process.stderr.write(`${deprecated('af', 'standards')}\n`);
// `af mcp` is a documented client config, and its client expects the old tool names. The server
// takes the list from an argument (never the environment); an exact match leaves `af mcp-config`
// alone.
if (process.argv[2] === 'mcp') process.argv.push('--legacy-tool-names');
await import('./standards.mjs');
