#!/usr/bin/env node
/**
 * `standards mcp` — serve the gate to any MCP client over stdio.
 *
 *   standards mcp                          serve
 *   standards mcp --selftest               exercise the protocol without a client, and exit non-zero if it breaks
 *   standards mcp --legacy-tool-names      list the tools as af_*, for a client configured with the old names
 *
 * The last is how `af mcp` and `af-mcp` ask for the old list (bin/af.mjs, bin/af-mcp.mjs). It is an
 * argument and never an environment variable, so a process this one starts does not inherit it.
 */
import { exitOnConflict } from '../src/lib/env-guard.mjs'; // first: a name conflict anywhere below exits 2 as well
import { serve, handle, TOOLS, SERVER } from '../src/lib/mcp.mjs';
import { TOOL_MAP } from '../src/lib/names.mjs';
import { chromiumFromEnv } from '../src/lib/env.mjs';

// The browser a lint call starts is chosen from this variable, and a conflict between its two names would
// otherwise end the session on that first call, after the handshake and with requests queued behind it.
// Read here, it exits 2 with one line before the server answers anything, as `standards mcp` does.
try { chromiumFromEnv(); } catch (e) { exitOnConflict(e); }

const profile = { legacy: process.argv.includes('--legacy-tool-names') };
// The selftest calls the tools by the names its profile lists.
const named = (tool) => (profile.legacy ? Object.keys(TOOL_MAP).find((old) => TOOL_MAP[old] === tool) : tool);

if (process.argv.includes('--selftest')) {
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: named('standards_rules'), arguments: { group: 'absence' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: named('standards_contrast'), arguments: { foreground: '#1A1A1A', background: '#FFFFFF' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: named('standards_move'), arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: `${named('standards_rules').replace(/rules$/, '')}nope`, arguments: {} } },
  ];
  let bad = 0;
  for (const call of calls) {
    const r = await handle(call, profile);
    const label = call.params?.name ?? call.method;
    if (call.id === 6) {
      if (!r.error) { bad++; console.log(`✗ ${label}: an unknown tool should be an error`); }
      else console.log(`✓ ${label} refused: ${r.error.message}`);
      continue;
    }
    if (!r || r.error) { bad++; console.log(`✗ ${label}: ${r?.error?.message ?? 'no response'}`); continue; }
    const size = JSON.stringify(r.result).length;
    console.log(`✓ ${label} (${size} bytes)`);
  }
  console.log(bad ? `${bad} problem(s)` : `${SERVER.name} ${SERVER.version}: ${TOOLS.length} tools, protocol clean`);
  process.exit(bad ? 1 : 0);
}

await serve(process.stdin, process.stdout, profile);
